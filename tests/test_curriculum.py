from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.models import Level
from app.services.curriculum import get_next_topic
from app.services.profiles import upsert_profile
from app.services.progress import record_answer


def _item_doc(item_id: str) -> dict:
    book, lesson, item_type, order = item_id.split(":")
    level = {"minna": "N4" if int(lesson) > 25 else "N5"}.get(book, "N3")
    return {
        "item_id": item_id,
        "lesson_id": f"{book}:{lesson}",
        "book": book,
        "level": level,
        "lesson": int(lesson),
        "section": item_type,
        "item_type": item_type,
        "order": int(order),
        "display": item_id,
        "reading": "",
        "meaning_vi": "",
        "source_url": "https://example.test",
    }


async def _put_profile(db, user_id: str, level: Level) -> None:
    await upsert_profile(db, user_id, level)


async def _put_items(db, ids: list[str]) -> None:
    for item_id in ids:
        await db["curriculum_items"].insert_one(_item_doc(item_id))


async def test_missing_profile_is_404(mock_db):
    with pytest.raises(HTTPException) as exc:
        await get_next_topic(mock_db, "nobody")

    assert exc.value.status_code == 404


async def test_missing_curriculum_is_503(mock_db):
    await _put_profile(mock_db, "u1", "N3")

    with pytest.raises(HTTPException) as exc:
        await get_next_topic(mock_db, "u1")

    assert exc.value.status_code == 503


async def test_n4_ignores_n5_items(mock_db):
    await _put_profile(mock_db, "u1", "N4")
    await _put_items(mock_db, ["minna:26:vocabulary:1", "minna:1:vocabulary:1"])

    topic = await get_next_topic(mock_db, "u1")

    assert topic.item_id == "minna:26:vocabulary:1"


async def test_unseen_book_priority_then_lesson(mock_db):
    await _put_profile(mock_db, "u1", "N3")
    await _put_items(
        mock_db,
        ["soumatome:1:kanji:1", "mimikara:2:vocabulary:1", "shinkanzen:3:grammar:1"],
    )

    topic = await get_next_topic(mock_db, "u1")

    assert topic.item_id == "shinkanzen:3:grammar:1"
    assert topic.book == "shinkanzen"
    assert topic.lesson == 3


async def test_overdue_item_first(mock_db):
    await _put_profile(mock_db, "u1", "N5")
    await _put_items(mock_db, ["minna:1:grammar:1", "minna:2:grammar:1"])
    await record_answer(mock_db, "u1", "minna:1:grammar:1", "grammar", "N5", True)
    past = datetime.now(UTC) - timedelta(days=2)
    await mock_db["progress"].update_one(
        {"user_id": "u1", "item_id": "minna:1:grammar:1"},
        {"$set": {"next_review": past}},
    )

    topic = await get_next_topic(mock_db, "u1")

    assert topic.item_id == "minna:1:grammar:1"
    assert topic.reason == "overdue_review"


async def test_weakest_skill_priority(mock_db):
    await _put_profile(mock_db, "u1", "N5")
    await _put_items(mock_db, ["minna:1:grammar:1", "minna:2:grammar:1"])
    now = datetime.now(UTC)
    for item_id, correct, incorrect in (
        ("minna:1:grammar:1", 8, 2),
        ("minna:2:grammar:1", 1, 9),
    ):
        await mock_db["progress"].insert_one(
            {
                "user_id": "u1",
                "item_id": item_id,
                "item_type": "grammar",
                "jlpt_level": "N5",
                "correct": correct,
                "incorrect": incorrect,
                "last_reviewed": now,
                "next_review": now + timedelta(days=2),
                "interval_days": 2.0,
                "ease_factor": 2.5,
            }
        )

    topic = await get_next_topic(mock_db, "u1")

    assert topic.item_id == "minna:2:grammar:1"
    assert topic.reason == "weakest_skill"


async def test_level_change_keeps_progress_and_switches_items(mock_db):
    await _put_profile(mock_db, "u1", "N3")
    await _put_items(mock_db, ["shinkanzen:1:grammar:1"])
    await record_answer(mock_db, "u1", "shinkanzen:1:grammar:1", "grammar", "N3", True)

    await _put_profile(mock_db, "u1", "N5")
    await _put_items(mock_db, ["minna:1:vocabulary:1"])

    topic = await get_next_topic(mock_db, "u1")

    assert topic.item_id == "minna:1:vocabulary:1"
    assert await mock_db["progress"].count_documents({"user_id": "u1"}) == 1


async def test_unknown_progress_item_does_not_crash(mock_db):
    await _put_profile(mock_db, "u1", "N3")
    await _put_items(mock_db, ["shinkanzen:1:grammar:1"])
    past = datetime.now(UTC) - timedelta(days=2)
    await mock_db["progress"].insert_one(
        {
            "user_id": "u1",
            "item_id": "ghost:1:grammar:1",
            "item_type": "grammar",
            "jlpt_level": "N3",
            "correct": 1,
            "incorrect": 0,
            "last_reviewed": past,
            "next_review": past,
            "interval_days": 1.0,
            "ease_factor": 2.5,
        }
    )

    topic = await get_next_topic(mock_db, "u1")

    assert topic.item_id == "shinkanzen:1:grammar:1"
    assert topic.reason == "new_item"
