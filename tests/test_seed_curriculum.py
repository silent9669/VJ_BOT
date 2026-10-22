import json

import pytest

from scripts.seed_curriculum import load_payload, seed_curriculum

ITEM = {
    "item_id": "minna:1:vocabulary:1",
    "lesson_id": "minna:1",
    "book": "minna",
    "level": "N5",
    "lesson": 1,
    "section": "vocabulary",
    "item_type": "vocabulary",
    "order": 1,
    "display": "私",
    "reading": "わたし",
    "meaning_vi": "tôi",
    "meaning_en": "I",
    "source_url": "https://example.test",
}
LESSON = {
    "lesson_id": "minna:1",
    "book": "minna",
    "level": "N5",
    "lesson": 1,
    "title": "Bài 1",
    "source_url": "https://example.test",
}


def _write(tmp_path, payload):
    path = tmp_path / "curriculum.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def test_invalid_item_names_its_index(tmp_path):
    path = _write(tmp_path, {"lessons": [], "items": [{"item_id": "x"}]})

    with pytest.raises(ValueError, match="item 0"):
        load_payload(path)


def test_invalid_lesson_names_its_index(tmp_path):
    path = _write(tmp_path, {"lessons": [{"lesson_id": "x"}], "items": []})

    with pytest.raises(ValueError, match="lesson 0"):
        load_payload(path)


async def test_seed_is_idempotent(mock_db, tmp_path):
    lessons, items = load_payload(_write(tmp_path, {"lessons": [LESSON], "items": [ITEM]}))

    await seed_curriculum(mock_db, lessons, items)
    await seed_curriculum(mock_db, lessons, items)

    assert await mock_db["curriculum_items"].count_documents({}) == 1
    assert await mock_db["curriculum_lessons"].count_documents({}) == 1
