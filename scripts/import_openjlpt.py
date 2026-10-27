import argparse
import csv
import json
from pathlib import Path

LEVELS = ("N5", "N4", "N3", "N2", "N1")
FILES = {
    "vocabulary": "vocab-{level}.csv",
    "kanji": "kanji-{level}.csv",
    "grammar": "grammar-{level}.csv",
}
BOOKS = {
    "vocabulary": "openjlpt-vocab",
    "kanji": "openjlpt-kanji",
    "grammar": "openjlpt-grammar",
}
SOURCE_URL = "https://github.com/evanclan/OpenJLPT"


def _rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def _item(
    level: str,
    item_type: str,
    row: dict[str, str],
    index: int,
    per_lesson: int,
) -> dict:
    lesson = index // per_lesson + 1
    if item_type == "vocabulary":
        source_id = row["id"]
        display = row["word"]
        reading = row["reading"]
        meaning_en = row["meanings"]
    elif item_type == "kanji":
        source_id = row["character"]
        display = row["character"]
        reading = "; ".join(part for part in (row["onyomi"], row["kunyomi"]) if part)
        meaning_en = row["meanings"]
    else:
        source_id = row["id"]
        display = row["pattern"]
        reading = row["reading"]
        meaning_en = row["meaning"]

    return {
        "item_id": f"openjlpt:{level}:{item_type}:{source_id}",
        "lesson_id": f"openjlpt:{level}:{item_type}:{lesson}",
        "book": BOOKS[item_type],
        "level": level,
        "lesson": lesson,
        "section": item_type,
        "item_type": item_type,
        "order": index % per_lesson + 1,
        "display": display,
        "reading": reading,
        "meaning_vi": "",
        "meaning_en": meaning_en,
        "source_url": SOURCE_URL,
    }


def build_curriculum(data_dir: Path, per_lesson: int = 20) -> tuple[list[dict], list[dict]]:
    lessons: dict[str, dict] = {}
    items: list[dict] = []

    for level in LEVELS:
        for item_type, pattern in FILES.items():
            path = data_dir / pattern.format(level=level)
            if not path.exists():
                continue
            for index, row in enumerate(_rows(path)):
                item = _item(level, item_type, row, index, per_lesson)
                items.append(item)
                lessons.setdefault(
                    item["lesson_id"],
                    {
                        "lesson_id": item["lesson_id"],
                        "book": item["book"],
                        "level": level,
                        "lesson": item["lesson"],
                        "title": f"{item['book']} {level} bài {item['lesson']}",
                        "source_url": SOURCE_URL,
                    },
                )

    return list(lessons.values()), items


def main() -> None:
    parser = argparse.ArgumentParser(description="Build curriculum JSON from OpenJLPT CSVs.")
    parser.add_argument("data_dir", type=Path, help="Directory containing vocab-*.csv, kanji-*.csv, grammar-*.csv")
    parser.add_argument("--out", type=Path, default=Path("data/curriculum.json"))
    parser.add_argument("--per-lesson", type=int, default=20)
    args = parser.parse_args()

    lessons, items = build_curriculum(args.data_dir, args.per_lesson)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"lessons": lessons, "items": items}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(f"wrote {len(lessons)} lessons and {len(items)} items to {args.out}")


if __name__ == "__main__":
    main()
