from fastapi import APIRouter, Depends, Query
from motor.core import AgnosticDatabase

from app.db import get_db
from app.models import ProgressItem, ProgressSummary, RecordAnswerRequest
from app.services.progress import get_progress, record_answer

router = APIRouter(prefix="/api/progress", tags=["progress"])


@router.get("", response_model=ProgressSummary)
async def read_progress(
    user_id: str = Query(..., min_length=1),
    db: AgnosticDatabase = Depends(get_db),
) -> ProgressSummary:
    return await get_progress(db, user_id)


@router.post("/record", response_model=ProgressItem)
async def record(
    body: RecordAnswerRequest,
    db: AgnosticDatabase = Depends(get_db),
) -> ProgressItem:
    return await record_answer(
        db,
        user_id=body.user_id,
        item_id=body.item_id,
        item_type=body.item_type,
        jlpt_level=body.jlpt_level,
        correct=body.correct,
    )
