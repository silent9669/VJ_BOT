from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from motor.core import AgnosticDatabase

from app.config import settings
from app.db import get_db
from app.models import ChatMessage, ChatRequest, ChatResponse
from app.services.curriculum import get_next_topic
from app.services.profiles import load_profile

router = APIRouter(prefix="/api", tags=["chat"])


async def save_message(
    db: AgnosticDatabase, user_id: str, role: str, content: str
) -> None:
    await db["conversations"].insert_one(
        {
            "user_id": user_id,
            "role": role,
            "content": content,
            "timestamp": datetime.now(UTC),
        }
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    request: Request,
    db: AgnosticDatabase = Depends(get_db),
) -> ChatResponse:
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=422, detail="message must not be blank")
    if await load_profile(db, body.user_id) is None:
        raise HTTPException(status_code=409, detail="profile required")

    topic = await get_next_topic(db, body.user_id)
    await save_message(db, body.user_id, "user", text)

    docs = (
        await db["conversations"]
        .find({"user_id": body.user_id})
        .sort("timestamp", 1)
        .to_list(None)
    )
    recent = docs[-settings.history_context_limit :]
    messages = [
        ChatMessage(role=doc["role"], content=doc["content"], timestamp=doc["timestamp"])
        for doc in recent
    ]

    reply = await request.app.state.llm_client.generate(
        messages, topic, topic.jlpt_level
    )
    await save_message(db, body.user_id, "bot", reply)

    return ChatResponse(reply=reply, next_topic=topic.item_id)


@router.get("/history", response_model=list[ChatMessage])
async def history(
    user_id: str = Query(..., min_length=1),
    limit: int = Query(50, ge=1, le=200),
    db: AgnosticDatabase = Depends(get_db),
) -> list[ChatMessage]:
    docs = (
        await db["conversations"]
        .find({"user_id": user_id})
        .sort("timestamp", 1)
        .to_list(None)
    )
    return [
        ChatMessage(role=doc["role"], content=doc["content"], timestamp=doc["timestamp"])
        for doc in docs[-limit:]
    ]


@router.get("/chat/greeting", response_model=ChatResponse)
async def greeting(
    request: Request,
    user_id: str = Query(..., min_length=1),
    db: AgnosticDatabase = Depends(get_db),
) -> ChatResponse:
    from app.services.proactive import generate_greeting

    if await load_profile(db, user_id) is None:
        raise HTTPException(status_code=409, detail="profile required")
    reply, topic = await generate_greeting(db, request.app.state.llm_client, user_id)
    await save_message(db, user_id, "bot", reply)
    return ChatResponse(reply=reply, next_topic=topic.item_id)
