from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import lifespan
from app.routers import chat as chat_router
from app.routers import curriculum as curriculum_router
from app.routers import profile as profile_router
from app.routers import progress as progress_router
from app.services.llm import LLMClient

app = FastAPI(title="Nihongo Sensei", lifespan=lifespan)
app.state.llm_client = LLMClient(
    settings.api_key, settings.base_url, settings.model
)
app.include_router(profile_router.router)
app.include_router(progress_router.router)
app.include_router(curriculum_router.router)
app.include_router(chat_router.router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.mount("/", StaticFiles(directory="static", html=True), name="static")
