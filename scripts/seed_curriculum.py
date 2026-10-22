import argparse
import asyncio
import json
import sys
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

# Running this file directly puts scripts/ on sys.path, so the repo root must be added explicitly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402

LESSON_FIELDS = ("lesson_id", "book", "level", "lesson", "title", "source_url")
ITEM_FIELDS = (
    "item_id",
    "lesson_id",
    "book",
    "level",
    "lesson",
    "section",
    "item_type",
    "order",
    "display",
    "reading",
    "meaning_vi",
    "meaning_en",
    "source_url",
)


def load_payload(path: Path) -> tuple[list[dict], list[dict]]:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as error:
        raise ValueError(f"cannot read {path}: {error}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid JSON in {path}: {error}") from error
    lessons = data.get("lessons", [])
    items = data.get("items", [])

    for index, lesson in enumerate(lessons):
        missing = [field for field in LESSON_FIELDS if field not in lesson]
        if missing:
            raise ValueError(f"lesson {index} missing {', '.join(missing)}")
    for index, item in enumerate(items):
        missing = [field for field in ITEM_FIELDS if field not in item]
        if missing:
            raise ValueError(f"item {index} missing {', '.join(missing)}")

    return lessons, items


async def seed_curriculum(db, lessons: list[dict], items: list[dict]) -> None:
    for lesson in lessons:
        await db["curriculum_lessons"].update_one(
            {"lesson_id": lesson["lesson_id"]},
            {"$set": lesson},
            upsert=True,
        )
    for item in items:
        await db["curriculum_items"].update_one(
            {"item_id": item["item_id"]},
            {"$set": item},
            upsert=True,
        )


async def _run(path: Path) -> None:
    lessons, items = load_payload(path)
    client = AsyncIOMotorClient(settings.mongo_uri)
    try:
        await seed_curriculum(client[settings.db_name], lessons, items)
    finally:
        client.close()
    print(f"seeded {len(lessons)} lessons and {len(items)} items")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed crawled curriculum data into MongoDB.")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    asyncio.run(_run(args.path))


if __name__ == "__main__":
    main()
