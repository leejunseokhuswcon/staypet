from __future__ import annotations

import base64
from types import SimpleNamespace

from app.providers.base import SourceImage
from app.providers.openai_provider import OpenAIImageGenerationProvider
from conftest import png_bytes


def test_openai_adapter_contains_current_image_api_shape(monkeypatch):
    provider = OpenAIImageGenerationProvider(
        api_key="test-key",
        model="gpt-image-2.5-sunburst",
        quality="high",
        timeout_seconds=10,
    )
    captured = {}
    encoded = base64.b64encode(png_bytes()).decode()

    def fake_edit(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            data=[SimpleNamespace(b64_json=encoded, id="image-1", revised_prompt="revised")],
            usage=SimpleNamespace(model_dump=lambda: {"input_tokens": 1, "output_tokens": 1}),
            _request_id="request-1",
        )

    monkeypatch.setattr(provider.client.images, "edit", fake_edit)
    references = [
        SourceImage("source-1", "one.png", "image/png", png_bytes(), "a" * 64),
        SourceImage("source-2", "two.png", "image/png", png_bytes(), "b" * 64),
    ]
    result = provider.generate_candidates(
        species="dog", references=references, appearance_metadata={}, count=1, attempt=1
    )
    assert len(result) == 1
    assert captured["model"] == "gpt-image-2.5-sunburst"
    assert len(captured["image"]) == 2
    assert captured["background"] == "transparent"
    assert captured["output_format"] == "png"
    assert captured["response_format"] == "b64_json"
    assert captured["input_fidelity"] == "high"
    assert result[0].metadata["provider_request_id"] == "request-1"
