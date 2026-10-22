import pytest

from app.models import RecordAnswerRequest
from app.services.progress import get_progress, record_answer


async def test_record_answer_creates_new_item(mock_db):
    item = await record_answer(
        mock_db, user_id="u1", item_id="vocab_taberu",
        item_type="vocabulary", jlpt_level="N5", correct=True,
    )

    assert item.correct == 1
    assert item.incorrect == 0
    assert item.ease_factor == 2.5
    assert item.interval_days == 1.0
    assert item.last_reviewed is not None


async def test_record_answer_upserts_existing(mock_db):
    await record_answer(mock_db, "u1", "vocab_taberu", "vocabulary", "N5", True)
    item = await record_answer(mock_db, "u1", "vocab_taberu", "vocabulary", "N5", True)

    assert item.correct == 2
    assert item.incorrect == 0
    assert item.interval_days > 1.0


async def test_record_wrong_answer_decreases_ease(mock_db):
    item = await record_answer(mock_db, "u1", "kanji_nichi", "kanji", "N5", False)

    assert item.incorrect == 1
    assert item.correct == 0
    assert item.ease_factor < 2.5
    assert item.interval_days == 1.0


async def test_get_progress_summary_breakdown(mock_db):
    await record_answer(mock_db, "u1", "vocab_taberu", "vocabulary", "N5", True)
    await record_answer(mock_db, "u1", "kanji_nichi", "kanji", "N5", False)

    summary = await get_progress(mock_db, "u1")

    assert summary.user_id == "u1"
    assert len(summary.items) == 2
    n5 = summary.level_breakdown["N5"]
    assert n5["vocabulary"] == pytest.approx(100.0)
    assert n5["kanji"] == pytest.approx(0.0)


async def test_progress_api_record_and_get(client, mock_db):
    record = RecordAnswerRequest(
        user_id="u1", item_id="vocab_taberu",
        item_type="vocabulary", jlpt_level="N5", correct=True,
    )
    post = await client.post("/api/progress/record", json=record.model_dump())
    assert post.status_code == 200

    got = await client.get("/api/progress", params={"user_id": "u1"})
    assert got.status_code == 200
    body = got.json()
    assert any(i["item_id"] == "vocab_taberu" for i in body["items"])


async def test_breakdown_aggregates_multiple_items_per_skill(mock_db):
    await record_answer(mock_db, "u1", "vocab_a", "vocabulary", "N5", True)
    await record_answer(mock_db, "u1", "vocab_b", "vocabulary", "N5", False)

    summary = await get_progress(mock_db, "u1")

    assert summary.level_breakdown["N5"]["vocabulary"] == pytest.approx(50.0)
