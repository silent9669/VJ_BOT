import pytest
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient


class StubLLM:
    reply = "こんにちは"

    def __init__(self):
        self.last_messages = None

    async def generate(self, messages, topic, user_level, weakness_summary=""):
        self.last_messages = list(messages)
        return self.reply


@pytest.fixture
def mock_db():
    return AsyncMongoMockClient()["nihongo_test"]


CURRICULUM_ITEMS = [
    ("minna:1:grammar:1", "minna", "N5", 1, "grammar", 1, "〜は"),
    ("minna:1:vocabulary:1", "minna", "N5", 1, "vocabulary", 1, "私"),
    ("minna:26:vocabulary:1", "minna", "N4", 26, "vocabulary", 1, "〜"),
    ("shinkanzen:1:grammar:1", "shinkanzen", "N3", 1, "grammar", 1, "〜わけだ"),
]


def _item_doc(item_id, book, level, lesson, item_type, order, display):
    return {
        "item_id": item_id,
        "lesson_id": f"{book}:{lesson}",
        "book": book,
        "level": level,
        "lesson": lesson,
        "section": item_type,
        "item_type": item_type,
        "order": order,
        "display": display,
        "reading": "",
        "meaning_vi": "",
        "source_url": "https://example.test",
    }


@pytest.fixture
async def onboard(client):
    async def _onboard(user_id, level="N5"):
        response = await client.post("/api/profile", json={"user_id": user_id, "level": level})
        assert response.status_code == 200

    return _onboard


@pytest.fixture
async def client(mock_db):
    from app.db import get_db
    from app.main import app

    for row in CURRICULUM_ITEMS:
        await mock_db["curriculum_items"].insert_one(_item_doc(*row))
    app.state.llm_client = StubLLM()
    app.dependency_overrides[get_db] = lambda: mock_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
