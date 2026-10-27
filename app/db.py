from contextlib import asynccontextmanager
import logging

from fastapi import Request
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import settings

logger = logging.getLogger("nihongo_sensei.db")

DEFAULT_ITEMS = [
    # N5
    {"item_id": "minna:1:grammar:1", "lesson_id": "minna:1", "book": "minna", "level": "N5", "lesson": 1, "section": "grammar", "item_type": "grammar", "order": 1, "display": "〜は", "reading": "は", "meaning_vi": "Trợ từ chủ ngữ: AはBです (A là B)", "meaning_en": "topic marker", "source_url": "https://example.test"},
    {"item_id": "minna:1:grammar:2", "lesson_id": "minna:1", "book": "minna", "level": "N5", "lesson": 1, "section": "grammar", "item_type": "grammar", "order": 2, "display": "〜も", "reading": "も", "meaning_vi": "Trợ từ cũng: AもBです (A cũng là B)", "meaning_en": "also / too", "source_url": "https://example.test"},
    {"item_id": "minna:1:grammar:3", "lesson_id": "minna:1", "book": "minna", "level": "N5", "lesson": 1, "section": "grammar", "item_type": "grammar", "order": 3, "display": "〜の", "reading": "の", "meaning_vi": "Trợ từ sở hữu: N1のN2 (N2 của N1)", "meaning_en": "possessive particle", "source_url": "https://example.test"},
    {"item_id": "minna:1:vocabulary:1", "lesson_id": "minna:1", "book": "minna", "level": "N5", "lesson": 1, "section": "vocabulary", "item_type": "vocabulary", "order": 1, "display": "私", "reading": "わたし", "meaning_vi": "Tôi", "meaning_en": "I / me", "source_url": "https://example.test"},
    {"item_id": "minna:1:vocabulary:2", "lesson_id": "minna:1", "book": "minna", "level": "N5", "lesson": 1, "section": "vocabulary", "item_type": "vocabulary", "order": 2, "display": "学生", "reading": "がくせい", "meaning_vi": "Học sinh, sinh viên", "meaning_en": "student", "source_url": "https://example.test"},
    {"item_id": "minna:1:kanji:1", "lesson_id": "minna:1", "book": "minna", "level": "N5", "lesson": 1, "section": "kanji", "item_type": "kanji", "order": 1, "display": "日", "reading": "ニチ; ひ", "meaning_vi": "Ngày, mặt trời", "meaning_en": "sun / day", "source_url": "https://example.test"},
    {"item_id": "minna:1:kanji:2", "lesson_id": "minna:1", "book": "minna", "level": "N5", "lesson": 1, "section": "kanji", "item_type": "kanji", "order": 2, "display": "本", "reading": "ホン; もと", "meaning_vi": "Sách, gốc rễ, Nhật Bản", "meaning_en": "book / origin", "source_url": "https://example.test"},
    # N4
    {"item_id": "minna:26:grammar:1", "lesson_id": "minna:26", "book": "minna", "level": "N4", "lesson": 26, "section": "grammar", "item_type": "grammar", "order": 1, "display": "〜んです", "reading": "んです", "meaning_vi": "Nhấn mạnh, giải thích lý do", "meaning_en": "explanatory mode", "source_url": "https://example.test"},
    {"item_id": "minna:26:vocabulary:1", "lesson_id": "minna:26", "book": "minna", "level": "N4", "lesson": 26, "section": "vocabulary", "item_type": "vocabulary", "order": 1, "display": "案内します", "reading": "あんないします", "meaning_vi": "Hướng dẫn, dẫn đường", "meaning_en": "to guide / show around", "source_url": "https://example.test"},
    {"item_id": "minna:26:kanji:1", "lesson_id": "minna:26", "book": "minna", "level": "N4", "lesson": 26, "section": "kanji", "item_type": "kanji", "order": 1, "display": "会", "reading": "カイ; あ.う", "meaning_vi": "Gặp gỡ", "meaning_en": "meet / association", "source_url": "https://example.test"},
    # N3
    {"item_id": "shinkanzen:1:grammar:1", "lesson_id": "shinkanzen:1", "book": "shinkanzen", "level": "N3", "lesson": 1, "section": "grammar", "item_type": "grammar", "order": 1, "display": "〜わけだ", "reading": "わけだ", "meaning_vi": "Thảo nào, thành ra là như vậy", "meaning_en": "naturally / no wonder", "source_url": "https://example.test"},
    {"item_id": "shinkanzen:1:vocabulary:1", "lesson_id": "shinkanzen:1", "book": "shinkanzen", "level": "N3", "lesson": 1, "section": "vocabulary", "item_type": "vocabulary", "order": 1, "display": "状況", "reading": "じょうきょう", "meaning_vi": "Tình hình, trạng thái", "meaning_en": "situation", "source_url": "https://example.test"},
    {"item_id": "shinkanzen:1:kanji:1", "lesson_id": "shinkanzen:1", "book": "shinkanzen", "level": "N3", "lesson": 1, "section": "kanji", "item_type": "kanji", "order": 1, "display": "政", "reading": "セイ; まつりごと", "meaning_vi": "Chính trị", "meaning_en": "politics / government", "source_url": "https://example.test"},
    # N2
    {"item_id": "shinkanzen:1:grammar:n2_1", "lesson_id": "shinkanzen:n2_1", "book": "shinkanzen", "level": "N2", "lesson": 1, "section": "grammar", "item_type": "grammar", "order": 1, "display": "〜にわたって", "reading": "にわたって", "meaning_vi": "Suốt, trải rộng trên", "meaning_en": "throughout / across", "source_url": "https://example.test"},
    {"item_id": "shinkanzen:1:vocabulary:n2_1", "lesson_id": "shinkanzen:n2_1", "book": "shinkanzen", "level": "N2", "lesson": 1, "section": "vocabulary", "item_type": "vocabulary", "order": 1, "display": "傾向", "reading": "けいこう", "meaning_vi": "Khuynh hướng, xu hướng", "meaning_en": "tendency / trend", "source_url": "https://example.test"},
    # N1
    {"item_id": "shinkanzen:1:grammar:n1_1", "lesson_id": "shinkanzen:n1_1", "book": "shinkanzen", "level": "N1", "lesson": 1, "section": "grammar", "item_type": "grammar", "order": 1, "display": "〜極まりない", "reading": "きわまりない", "meaning_vi": "Vô cùng, hết sức", "meaning_en": "extremely / without limits", "source_url": "https://example.test"},
    {"item_id": "shinkanzen:1:vocabulary:n1_1", "lesson_id": "shinkanzen:n1_1", "book": "shinkanzen", "level": "N1", "lesson": 1, "section": "vocabulary", "item_type": "vocabulary", "order": 1, "display": "妥協", "reading": "だきょう", "meaning_vi": "Thỏa hiệp", "meaning_en": "compromise", "source_url": "https://example.test"},
]

DEFAULT_LESSONS = [
    {"lesson_id": "minna:1", "book": "minna", "level": "N5", "lesson": 1, "title": "Minna no Nihongo Bài 1", "source_url": "https://example.test"},
    {"lesson_id": "minna:26", "book": "minna", "level": "N4", "lesson": 26, "title": "Minna no Nihongo Bài 26", "source_url": "https://example.test"},
    {"lesson_id": "shinkanzen:1", "book": "shinkanzen", "level": "N3", "lesson": 1, "title": "Shinkanzen Master N3 Bài 1", "source_url": "https://example.test"},
    {"lesson_id": "shinkanzen:n2_1", "book": "shinkanzen", "level": "N2", "lesson": 1, "title": "Shinkanzen Master N2 Bài 1", "source_url": "https://example.test"},
    {"lesson_id": "shinkanzen:n1_1", "book": "shinkanzen", "level": "N1", "lesson": 1, "title": "Shinkanzen Master N1 Bài 1", "source_url": "https://example.test"},
]


async def seed_default_curriculum(db) -> None:
    for lesson in DEFAULT_LESSONS:
        await db["curriculum_lessons"].update_one(
            {"lesson_id": lesson["lesson_id"]},
            {"$set": lesson},
            upsert=True,
        )
    for item in DEFAULT_ITEMS:
        await db["curriculum_items"].update_one(
            {"item_id": item["item_id"]},
            {"$set": item},
            upsert=True,
        )


@asynccontextmanager
async def lifespan(app):
    client = None
    try:
        real_client = AsyncIOMotorClient(settings.mongo_uri, serverSelectionTimeoutMS=1500)
        await real_client.admin.command("ping")
        client = real_client
        db = client[settings.db_name]
        logger.info("Connected to MongoDB at %s", settings.mongo_uri)
    except Exception as exc:
        logger.warning("MongoDB unavailable (%s), falling back to AsyncMongoMockClient", exc)
        from mongomock_motor import AsyncMongoMockClient

        client = AsyncMongoMockClient()
        db = client[settings.db_name]

    if await db["curriculum_items"].count_documents({}) == 0:
        await seed_default_curriculum(db)

    app.state.mongo_client = client
    app.state.db = db
    yield
    client.close()


def get_db(request: Request) -> AsyncIOMotorDatabase:
    return request.app.state.db
