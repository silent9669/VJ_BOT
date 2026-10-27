import urllib.request
import json
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.config import settings

router = APIRouter(prefix="/api/tts", tags=["tts"])

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "Aoede"

@router.post("")
async def generate_tts(req: TTSRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text required")

    api_key = settings.api_key or settings.api_key
    voice_name = req.voice if req.voice in ["Aoede", "Puck", "Charon", "Kore", "Fenrir"] else "Aoede"
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": req.text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": voice_name
                    }
                }
            }
        }
    }

    try:
        req_obj = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key}
        )
        with urllib.request.urlopen(req_obj, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            part = data["candidates"][0]["content"]["parts"][0]
            inline = part.get("inlineData", {})
            return {
                "mimeType": inline.get("mimeType", "audio/wav"),
                "audioBase64": inline.get("data", ""),
                "voice": voice_name
            }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"TTS generation error: {str(exc)}")
