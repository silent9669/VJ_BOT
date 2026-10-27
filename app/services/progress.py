from datetime import UTC, datetime, timedelta

from motor.core import AgnosticDatabase

from app.models import ProgressItem, ProgressSummary

MIN_EASE = 1.3
INITIAL_EASE = 2.5


def _now() -> datetime:
    return datetime.now(UTC)


async def record_answer(
    db: AgnosticDatabase,
    user_id: str,
    item_id: str,
    item_type: str,
    jlpt_level: str,
    correct: bool,
) -> ProgressItem:
    collection = db["progress"]
    doc = await collection.find_one({"user_id": user_id, "item_id": item_id})

    item = ProgressItem(
        item_id=item_id,
        item_type=item_type,  # type: ignore[arg-type]
        jlpt_level=jlpt_level,  # type: ignore[arg-type]
    ) if doc is None else ProgressItem(**doc)

    now = _now()
    if correct:
        item.correct += 1
        reps = item.correct + item.incorrect
        if reps <= 1:
            item.interval_days = 1.0
        elif reps == 2:
            item.interval_days = 6.0
        else:
            item.interval_days = round(item.interval_days * item.ease_factor, 2)
        # SM-2 ease is only reduced on failure; a correct answer keeps it.
        item.ease_factor = max(MIN_EASE, item.ease_factor)
    else:
        item.incorrect += 1
        item.ease_factor = round(max(MIN_EASE, item.ease_factor - 0.2), 3)
        item.interval_days = 1.0

    item.ease_factor = max(MIN_EASE, item.ease_factor)
    item.interval_days = max(1.0, item.interval_days)
    item.last_reviewed = now
    item.next_review = now + timedelta(days=item.interval_days)

    await collection.update_one(
        {"user_id": user_id, "item_id": item_id},
        {"$set": item.model_dump()},
        upsert=True,
    )
    return item


async def get_progress(db: AgnosticDatabase, user_id: str) -> ProgressSummary:
    docs = await db["progress"].find({"user_id": user_id}).to_list(None)
    items = [ProgressItem(**d) for d in docs]

    breakdown: dict[str, dict[str, float]] = {}
    totals: dict[tuple[str, str], list[int]] = {}
    for item in items:
        key = (item.jlpt_level, item.item_type)
        counts = totals.setdefault(key, [0, 0])
        counts[0] += item.correct
        counts[1] += item.correct + item.incorrect

    for (level, skill), (correct, total) in totals.items():
        accuracy = round(100.0 * correct / total, 1) if total else 0.0
        breakdown.setdefault(level, {})[skill] = accuracy

    return ProgressSummary(user_id=user_id, items=items, level_breakdown=breakdown)
