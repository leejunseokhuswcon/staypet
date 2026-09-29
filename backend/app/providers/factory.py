from __future__ import annotations

from ..config import Settings, get_settings
from .base import ImageGenerationProvider, ProviderError
from .mock import MockImageGenerationProvider
from .openai_provider import OpenAIImageGenerationProvider


def build_provider(settings: Settings | None = None) -> ImageGenerationProvider:
    settings = settings or get_settings()
    if settings.generation_provider == "mock":
        return MockImageGenerationProvider(
            delay_ms=settings.mock_generation_delay_ms,
            fail_first_attempt=settings.mock_fail_first_attempt,
        )
    if settings.generation_provider == "openai":
        return OpenAIImageGenerationProvider(
            api_key=settings.openai_api_key or "",
            model=settings.openai_image_model,
            quality=settings.openai_image_quality,
            timeout_seconds=settings.openai_timeout_seconds,
        )
    raise ProviderError(
        f"unsupported GENERATION_PROVIDER: {settings.generation_provider}",
        code="provider_not_configured",
        retriable=False,
    )
