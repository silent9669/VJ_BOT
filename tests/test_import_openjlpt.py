from pathlib import Path

from scripts.import_openjlpt import build_curriculum

FIXTURES = Path(__file__).parent / "fixtures" / "openjlpt"


def test_builds_items_for_each_type():
    lessons, items = build_curriculum(FIXTURES, per_lesson=1)

    types = {item["item_type"] for item in items}
    assert types == {"vocabulary", "kanji", "grammar"}
    assert len(lessons) == len(items)
    assert len(items) == 5


def test_ids_are_deterministic_and_level_scoped():
    _, items = build_curriculum(FIXTURES, per_lesson=1)

    vocab = [item for item in items if item["item_type"] == "vocabulary"]
    assert {item["item_id"] for item in vocab} == {
        "openjlpt:N5:vocabulary:v1",
        "openjlpt:N5:vocabulary:v2",
    }
    assert all(item["level"] == "N5" for item in items)


def test_lesson_groups_follow_per_lesson_size():
    _, items = build_curriculum(FIXTURES, per_lesson=2)

    vocab = [item for item in items if item["item_type"] == "vocabulary"]
    assert [item["lesson"] for item in vocab] == [1, 1]


def test_kanji_reading_joins_onyomi_and_kunyomi():
    _, items = build_curriculum(FIXTURES, per_lesson=1)

    kanji = next(item for item in items if item["item_type"] == "kanji")
    assert kanji["display"] == "日"
    assert "ニチ" in kanji["reading"]
    assert "ひ" in kanji["reading"]


def test_missing_level_files_are_skipped():
    lessons, items = build_curriculum(FIXTURES, per_lesson=20)

    assert lessons
    assert items
