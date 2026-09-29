from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: str = "development"
    auto_create_schema: bool = False
    database_url: str = "sqlite:///./var/staypet.db"
    storage_backend: str = "local"
    local_storage_root: Path = Path("./var/media")
    public_media_base_url: str = "http://127.0.0.1:8000/api/v1/media"
    cors_origins: str = "http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:8000"
    generation_provider: str = "mock"
    worker_poll_seconds: float = Field(default=1.0, ge=0.05)
    worker_retry_base_seconds: float = Field(default=2.0, ge=0)
    poc_api_token: str | None = None

    supabase_url: str | None = None
    supabase_service_role_key: str | None = None
    supabase_storage_bucket: str = "staypet-assets"

    openai_api_key: str | None = None
    openai_image_model: str = "gpt-image-2.5-sunburst"
    openai_image_quality: str = "high"
    openai_timeout_seconds: float = Field(default=180, ge=1)

    mock_generation_delay_ms: int = Field(default=50, ge=0)
    mock_fail_first_attempt: bool = False

    @property
    def allowed_cors_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def normalized_database_url(self) -> str:
        value = self.database_url
        if value.startswith("postgres://"):
            value = "postgresql+psycopg://" + value.removeprefix("postgres://")
        elif value.startswith("postgresql://") and "+psycopg" not in value:
            value = "postgresql+psycopg://" + value.removeprefix("postgresql://")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
