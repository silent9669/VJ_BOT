from fastapi import APIRouter, Depends, HTTPException, Query
from motor.core import AgnosticDatabase

from app.db import get_db
from app.models import Profile, ProfileRequest
from app.services.profiles import load_profile, upsert_profile

router = APIRouter(prefix="/api", tags=["profile"])


@router.get("/profile", response_model=Profile)
async def read_profile(
    user_id: str = Query(..., min_length=1),
    db: AgnosticDatabase = Depends(get_db),
) -> Profile:
    profile = await load_profile(db, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="profile not found")
    return profile


@router.post("/profile", response_model=Profile)
async def write_profile(
    body: ProfileRequest,
    db: AgnosticDatabase = Depends(get_db),
) -> Profile:
    return await upsert_profile(db, body.user_id, body.level)
