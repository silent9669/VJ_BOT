from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

JlptLevel = Literal["N5", "N4", "N3", "N2", "N1"]
ItemType = Literal["grammar", "kanji", "vocabulary"]


class ProgressItem(BaseModel):
    item_id: str
    item_type: ItemType
    jlpt_level: JlptLevel
    correct: int = 0
    incorrect: int = 0
    last_reviewed: datetime | None = None
    next_review: datetime = Field(default_factory=datetime.now)
    interval_days: float = 1.0
    ease_factor: float = 2.5


class ProgressSummary(BaseModel):
    user_id: str
    items: list[ProgressItem]
    level_breakdown: dict[str, dict[str, float]]


class RecordAnswerRequest(BaseModel):
    user_id: str
    item_id: str
    item_type: ItemType
    jlpt_level: JlptLevel
    correct: bool


class NextTopic(BaseModel):
    item_id: str
    item_type: ItemType
    jlpt_level: JlptLevel
    display: str
    meaning_en: str
    reason: str
    book: str
    lesson: int
    source_url: str


class ChatMessage(BaseModel):
    role: Literal["user", "bot"]
    content: str
    timestamp: datetime = Field(default_factory=datetime.now)


class ChatRequest(BaseModel):
    user_id: str
    message: str


class ChatResponse(BaseModel):
    reply: str
    next_topic: str | None = None

Level = Literal["beginner", "N5", "N4", "N3", "N2", "N1"]
Track = Literal["minna", "advanced"]


class Profile(BaseModel):
    user_id: str
    level: Level
    track: Track
    updated_at: datetime


class ProfileRequest(BaseModel):
    user_id: str
    level: Level
