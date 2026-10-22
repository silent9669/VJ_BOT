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
