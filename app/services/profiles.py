from datetime import UTC, datetime

from motor.core import AgnosticDatabase

from app.models import Level, Profile, Track


def derive_track(level: Level) -> Track:
    return "minna" if level in {"beginner", "N5", "N4"} else "advanced"


def effective_level(level: Level) -> Level:
    return "N5" if level == "beginner" else level


async def load_profile(db: AgnosticDatabase, user_id: str) -> Profile | None:
    doc = await db["users"].find_one({"user_id": user_id})
    return Profile(**doc) if doc else None


async def upsert_profile(db: AgnosticDatabase, user_id: str, level: Level) -> Profile:
    profile = Profile(
        user_id=user_id,
        level=level,
        track=derive_track(level),
        updated_at=datetime.now(UTC),
    )
    await db["users"].update_one(
        {"user_id": user_id},
        {"$set": profile.model_dump()},
        upsert=True,
    )
    return profile
