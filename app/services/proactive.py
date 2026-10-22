from motor.core import AgnosticDatabase

from app.models import ChatMessage, NextTopic, ProgressSummary
from app.services.curriculum import get_next_topic
from app.services.progress import get_progress


def _weakness_text(summary: ProgressSummary) -> str:
    weakest: tuple[str, float] | None = None
    for level, skills in summary.level_breakdown.items():
        for skill, accuracy in skills.items():
            if weakest is None or accuracy < weakest[1]:
                weakest = (f"{level} {skill}", accuracy)

    if weakest is None:
        return "まだ学習履歴がありません"

    label, accuracy = weakest
    return f"{label}: 正答率 {accuracy}%"


async def generate_greeting(
    db: AgnosticDatabase,
    llm_client,
    user_id: str,
) -> tuple[str, NextTopic]:
    topic = await get_next_topic(db, user_id)
    summary = await get_progress(db, user_id)
    # google-genai rejects empty contents, so a first-turn greeting needs a seat message.
    opener = ChatMessage(role="user", content="始めましょう。")
    reply = await llm_client.generate([opener], topic, topic.jlpt_level, _weakness_text(summary))
    return reply, topic
