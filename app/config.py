from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongo_uri: str = "mongodb://mongo:27017"
    api_key: str = ""
    base_url: str = ""
    model: str = "gemini-2.0-flash"
    db_name: str = "nihongo_sensei"
    history_context_limit: int = 20


settings = Settings()
