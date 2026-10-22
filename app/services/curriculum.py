from datetime import UTC, datetime

from fastapi import HTTPException
from motor.core import AgnosticDatabase

from app.models import Level, NextTopic
from app.services.profiles import effective_level, load_profile

BOOK_PRIORITY = {"grammar": 0, "vocabulary": 1, "kanji": 2}


def _as_aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _accuracy(doc: dict) -> float:
    total = doc.get("correct", 0) + doc.get("incorrect", 0)
    return doc.get("correct", 0) / total if total else 0.0


async def get_next_topic(db: AgnosticDatabase, user_id: str) -> NextTopic:
    profile = await load_profile(db, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="profile not found")

    level: Level = effective_level(profile.level)
    items = await db["curriculum_items"].find({"level": level}).to_list(None)
    if not items:
        raise HTTPException(status_code=503, detail="curriculum not seeded")

    by_id = {item["item_id"]: item for item in items}
    progress = await db["progress"].find({"user_id": user_id}).to_list(None)
    tracked = [doc for doc in progress if doc["item_id"] in by_id]
    seen_ids = {doc["item_id"] for doc in tracked}
    now = datetime.now(UTC)

    overdue = [
        doc for doc in tracked
        if doc.get("next_review") and _as_aware(doc["next_review"]) < now
    ]
    if overdue:
        chosen = min(overdue, key=lambda d: d.get("ease_factor", 2.5))
        return _to_topic(by_id[chosen["item_id"]], "overdue_review")

    unseen = [item for item in items if item["item_id"] not in seen_ids]
    if unseen:
        unseen.sort(
            key=lambda i: (
                BOOK_PRIORITY.get(i["item_type"], 99),
                i["book"],
                i["lesson"],
                i["order"],
            )
        )
        return _to_topic(unseen[0], "new_item")

    chosen = min(tracked, key=lambda d: (_accuracy(d), _as_aware(d["next_review"])))
    return _to_topic(by_id[chosen["item_id"]], "weakest_skill")


def _to_topic(item: dict, reason: str) -> NextTopic:
    return NextTopic(
        item_id=item["item_id"],
        item_type=item["item_type"],
        jlpt_level=item["level"],
        display=item["display"],
        meaning_en=item.get("meaning_en") or item.get("meaning_vi", ""),
        reason=reason,
        book=item["book"],
        lesson=item["lesson"],
        source_url=item["source_url"],
    )
