from fastapi import APIRouter, Depends, Query
from motor.core import AgnosticDatabase

from app.db import get_db
from app.models import NextTopic
from app.services.curriculum import get_next_topic

router = APIRouter(prefix="/api", tags=["curriculum"])


@router.get("/next-topic", response_model=NextTopic)
async def next_topic(
    user_id: str = Query(..., min_length=1),
    db: AgnosticDatabase = Depends(get_db),
) -> NextTopic:
    return await get_next_topic(db, user_id)


@router.get("/curriculum")
async def list_curriculum(
    level: str | None = Query(None),
    db: AgnosticDatabase = Depends(get_db),
):
    query = {"level": level} if level else {}
    items = await db["curriculum_items"].find(query).to_list(200)
    res = []
    for it in items:
        res.append({
            "id": it.get("item_id"),
            "level": it.get("level"),
            "book": it.get("book", "minna"),
            "lesson": it.get("lesson", 1),
            "item_type": it.get("item_type", "grammar"),
            "display": it.get("display", ""),
            "reading": it.get("reading", ""),
            "meaning_vi": it.get("meaning_vi") or it.get("meaning_en", ""),
            "meaning_en": it.get("meaning_en", ""),
            "source_url": it.get("source_url", ""),
        })
    return res
