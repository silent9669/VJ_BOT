from contextlib import asynccontextmanager

from fastapi import Request
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import settings


@asynccontextmanager
async def lifespan(app):
    client = AsyncIOMotorClient(settings.mongo_uri)
    db = client[settings.db_name]
    app.state.mongo_client = client
    app.state.db = db
    yield
    client.close()


def get_db(request: Request) -> AsyncIOMotorDatabase:
    return request.app.state.db
