async def test_chat_returns_reply(client, onboard):
    await onboard("u1")
    response = await client.post("/api/chat", json={"user_id": "u1", "message": "hello"})

    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "こんにちは"
    assert body["next_topic"]


async def test_chat_rejects_empty_message(client):
    response = await client.post("/api/chat", json={"user_id": "u1", "message": "   "})

    assert response.status_code == 422


async def test_history_returns_saved_messages(client, onboard):
    await onboard("u1")
    await client.post("/api/chat", json={"user_id": "u1", "message": "first"})
    await client.post("/api/chat", json={"user_id": "u1", "message": "second"})

    response = await client.get("/api/history", params={"user_id": "u1"})

    assert response.status_code == 200
    messages = response.json()
    assert [m["role"] for m in messages] == ["user", "bot", "user", "bot"]
    assert messages[0]["content"] == "first"
    assert messages[2]["content"] == "second"


async def test_history_truncation_respects_limit(client, mock_db, onboard):
    await onboard("u2")
    from datetime import UTC, datetime, timedelta

    from app.config import settings
    from app.main import app

    captured = {}

    class Capture:
        async def generate(self, messages, topic, user_level):
            captured["count"] = len(messages)
            return "ok"

    app.state.llm_client = Capture()
    base = datetime.now(UTC)
    for index in range(30):
        await mock_db["conversations"].insert_one(
            {
                "user_id": "u2",
                "role": "user",
                "content": f"m{index}",
                "timestamp": base + timedelta(seconds=index),
            }
        )

    response = await client.post("/api/chat", json={"user_id": "u2", "message": "last"})

    assert response.status_code == 200
    assert captured["count"] <= settings.history_context_limit


async def test_greeting_introduces_next_topic(client, mock_db, onboard):
    await onboard("u3")
    response = await client.get("/api/chat/greeting", params={"user_id": "u3"})

    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "こんにちは"
    assert body["next_topic"] == "minna:1:grammar:1"


async def test_greeting_sends_non_empty_llm_messages(client, onboard):
    await onboard("u4")
    from app.main import app

    await client.get("/api/chat/greeting", params={"user_id": "u4"})

    assert app.state.llm_client.last_messages


async def test_chat_requires_profile(client):
    response = await client.post("/api/chat", json={"user_id": "nobody", "message": "hi"})

    assert response.status_code == 409
    assert response.json()["detail"] == "profile required"


async def test_greeting_requires_profile(client):
    response = await client.get("/api/chat/greeting", params={"user_id": "nobody"})

    assert response.status_code == 409
    assert response.json()["detail"] == "profile required"
