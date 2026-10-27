from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_tts_empty_text():
    response = client.post("/api/tts", json={"text": "   "})
    assert response.status_code == 400

def test_tts_mock_success():
    with patch("urllib.request.urlopen") as mock_url:
        mock_resp = MagicMock()
        mock_resp.read.return_value = b'{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/wav","data":"UklGRiQAAABXQVZFZg=="}}]}}]}'
        mock_resp.__enter__.return_value = mock_resp
        mock_url.return_value = mock_resp

        response = client.post("/api/tts", json={"text": "Konnichiwa", "voice": "Aoede"})
        assert response.status_code == 200
        data = response.json()
        assert data["mimeType"] == "audio/wav"
        assert data["audioBase64"] == "UklGRiQAAABXQVZFZg=="
        assert data["voice"] == "Aoede"
