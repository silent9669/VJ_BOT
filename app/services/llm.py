from fastapi import HTTPException
from google import genai

from app.models import ChatMessage, NextTopic

MODEL_ID = "gemini-2.0-flash"

SYSTEM_PROMPT_TEMPLATE = """あなたは「日本語先生」です。生徒のレベルは{user_level}です。
今回のトピック: {display} ({meaning_en})
生徒の弱点: {weakness_summary}
指示: 説明とフィードバックは原則ベトナム語で行い、日本語の例文・単語・文法は日本語のまま示してください。
このトピックについて短い説明をし、理解度を確認する質問を1つ出してください。

QUY TẮC TRÌNH BÀY (bắt buộc):
- Viết tự nhiên như một giáo viên Việt Nam đang nói với học viên; xen câu ngắn và câu dài.
- Nói thẳng ý chính trước. Không mở bài bằng "Hãy cùng tìm hiểu", "Câu hỏi thật sự là", "Điều quan trọng nhất là".
- Không dùng cấu trúc "không chỉ X mà còn Y" hay "không phải X mà là Y" khi vế phủ định không thêm thông tin.
- Không thêm câu kết nhắc lại ý vừa nói. Không dùng từ hoa mỹ rỗng như crucial, pivotal, testament, landscape, delve.
- Không dùng dấu gạch ngang dài. Thay bằng dấu phẩy, dấu chấm hoặc ngoặc đơn.
- Không dùng Markdown: không in đậm bằng **, không tiêu đề #, không bảng. Trả lời văn bản thuần, mỗi ý một dòng.
- Không bịa thông tin. Nếu thiếu dữ liệu, nói rõ là chưa có.
- Giải thích tiếng Nhật bằng tiếng Việt dễ hiểu, kèm một ví dụ ngắn."""


class LLMClient:
    def __init__(self, api_key: str, base_url: str = "", model: str = MODEL_ID):
        self.available = bool(api_key)
        self.base_url = base_url
        self.model = model
        if not self.available:
            self._client = None
            return
        # A custom base URL routes requests through an OpenAI-compatible proxy or gateway.
        if base_url:
            self._client = genai.Client(api_key=api_key, http_options={"base_url": base_url})
        else:
            self._client = genai.Client(api_key=api_key)

    async def generate(
        self,
        messages: list[ChatMessage],
        topic: NextTopic,
        user_level: str,
        weakness_summary: str = "",
    ) -> str:
        if not self.available or self._client is None:
            raise HTTPException(status_code=503, detail="LLM not configured")

        system = build_system_prompt(topic, user_level, weakness_summary)
        contents = [
            {"role": "user" if m.role == "user" else "model", "parts": [{"text": m.content}]}
            for m in messages
        ]
        response = await self._client.aio.models.generate_content(
            model=self.model,
            contents=contents,
            config={"system_instruction": system},
        )
        return response.text or ""


def build_system_prompt(topic: NextTopic, user_level: str, weakness_summary: str) -> str:
    return SYSTEM_PROMPT_TEMPLATE.format(
        user_level=user_level,
        display=topic.display,
        meaning_en=topic.meaning_en,
        weakness_summary=weakness_summary or "なし",
    )
