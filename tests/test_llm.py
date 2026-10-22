import pytest
from fastapi import HTTPException

from app.models import ChatMessage, NextTopic
from app.services.llm import LLMClient, build_system_prompt


def _topic() -> NextTopic:
    return NextTopic(
        item_id="vocab_taberu",
        item_type="vocabulary",
        jlpt_level="N5",
        display="食べる",
        meaning_en="to eat",
        reason="new_item",
        book="minna",
        lesson=1,
        source_url="https://example.test",
    )


async def test_llm_generate_raises_503_without_key():
    client = LLMClient("")

    with pytest.raises(HTTPException) as exc:
        await client.generate([ChatMessage(role="user", content="hi")], _topic(), "N5")

    assert exc.value.status_code == 503
    assert "LLM not configured" in exc.value.detail


def test_build_system_prompt_contains_topic_level_and_weakness():
    prompt = build_system_prompt(_topic(), "N5", "particles 40%")

    assert "食べる" in prompt
    assert "N5" in prompt
    assert "particles 40%" in prompt


def test_llm_client_passes_base_url(monkeypatch):
    captured = {}

    class FakeClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("app.services.llm.genai.Client", FakeClient)

    from app.services.llm import LLMClient

    LLMClient("key", "https://proxy.example.com")

    assert captured["http_options"]["base_url"] == "https://proxy.example.com"


def test_llm_client_omits_http_options_without_base_url(monkeypatch):
    captured = {}

    class FakeClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("app.services.llm.genai.Client", FakeClient)

    from app.services.llm import LLMClient

    LLMClient("key")

    assert "http_options" not in captured


async def test_llm_client_uses_configured_model(monkeypatch):
    captured = {}

    class FakeModels:
        async def generate_content(self, **kwargs):
            captured.update(kwargs)

            class Response:
                text = "ok"

            return Response()

    class FakeClient:
        def __init__(self, **kwargs):
            self.aio = type("Aio", (), {"models": FakeModels()})()

    monkeypatch.setattr("app.services.llm.genai.Client", FakeClient)

    from app.services.llm import LLMClient

    client = LLMClient("key", model="gemini-2.5-flash")
    await client.generate([ChatMessage(role="user", content="hi")], _topic(), "N5")

    assert captured["model"] == "gemini-2.5-flash"


def test_system_prompt_defaults_to_vietnamese():
    prompt = build_system_prompt(_topic(), "N5", "")

    assert "ベトナム語" in prompt


def test_system_prompt_enforces_humanizer_rules():
    prompt = build_system_prompt(_topic(), "N5", "")

    assert "gạch ngang dài" in prompt
    assert "Markdown" in prompt
    assert "không chỉ" in prompt
    assert "Viết tự nhiên" in prompt
