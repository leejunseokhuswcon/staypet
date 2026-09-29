from __future__ import annotations

import base64
import io
from contextlib import ExitStack

from openai import APIConnectionError, APIStatusError, APITimeoutError, OpenAI, RateLimitError
from PIL import Image

from ..prompts import asset_prompt, candidate_prompt
from .base import GeneratedImage, ImageGenerationProvider, ProviderError, SourceImage


class OpenAIImageGenerationProvider(ImageGenerationProvider):
    """OpenAI Image API adapter.

    The adapter follows the current official Image API reference-image workflow:
    `client.images.edit(...)` with multiple image inputs and base64 image output.
    Provider objects and response shapes are intentionally contained here.
    """

    name = "openai"

    def __init__(self, *, api_key: str, model: str, quality: str, timeout_seconds: float) -> None:
        if not api_key:
            raise ProviderError("OPENAI_API_KEY is required", code="provider_not_configured", retriable=False)
        self.model = model
        self.quality = quality
        self.client = OpenAI(api_key=api_key, timeout=timeout_seconds, max_retries=0)

    @staticmethod
    def _decode(item, response) -> GeneratedImage:
        encoded = getattr(item, "b64_json", None)
        if not encoded:
            raise ProviderError("OpenAI returned no base64 image", code="empty_provider_result", retriable=True)
        data = base64.b64decode(encoded)
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            has_alpha = image.mode in {"RGBA", "LA"} or "transparency" in image.info
        usage = getattr(response, "usage", None)
        metadata = {
            "usage": usage.model_dump() if hasattr(usage, "model_dump") else None,
            "revised_prompt": getattr(item, "revised_prompt", None),
            "provider_request_id": getattr(response, "_request_id", None),
        }
        return GeneratedImage(
            data=data,
            media_type="image/png",
            width=width,
            height=height,
            has_transparency=has_alpha,
            provider_asset_id=getattr(item, "id", None),
            metadata=metadata,
        )

    @staticmethod
    def _file_list(stack: ExitStack, references: list[SourceImage]):
        files = []
        for ref in references:
            stream = io.BytesIO(ref.data)
            stream.name = ref.filename
            stack.callback(stream.close)
            files.append(stream)
        return files

    def _edit(self, *, references: list[SourceImage], prompt: str, count: int = 1) -> list[GeneratedImage]:
        try:
            with ExitStack() as stack:
                files = self._file_list(stack, references)
                response = self.client.images.edit(
                    model=self.model,
                    image=files,
                    prompt=prompt,
                    n=count,
                    size="1024x1024",
                    quality=self.quality,
                    background="transparent",
                    output_format="png",
                    response_format="b64_json",
                    input_fidelity="high",
                )
            return [self._decode(item, response) for item in response.data]
        except (RateLimitError, APITimeoutError, APIConnectionError) as exc:
            raise ProviderError(str(exc), code="provider_temporarily_unavailable", retriable=True) from exc
        except APIStatusError as exc:
            retriable = exc.status_code >= 500 or exc.status_code in {408, 409, 429}
            raise ProviderError(
                f"OpenAI Image API error ({exc.status_code})",
                code="provider_http_error",
                retriable=retriable,
            ) from exc

    def generate_candidates(
        self,
        *,
        species: str,
        references: list[SourceImage],
        appearance_metadata: dict,
        count: int,
        attempt: int,
    ) -> list[GeneratedImage]:
        del attempt
        prompt = candidate_prompt(species, appearance_metadata, 0)
        results = self._edit(references=references, prompt=prompt, count=count)
        if len(results) != count:
            raise ProviderError("candidate count mismatch", code="candidate_count_mismatch", retriable=True)
        return results

    def generate_character_assets(
        self,
        *,
        species: str,
        canonical_reference: SourceImage,
        appearance_metadata: dict,
        behaviors: list[str],
        attempt: int,
    ) -> dict[str, GeneratedImage]:
        del attempt
        outputs: dict[str, GeneratedImage] = {}
        for behavior in behaviors:
            _orientation, prompt = asset_prompt(species, behavior, appearance_metadata)
            outputs[behavior] = self._edit(
                references=[canonical_reference], prompt=prompt, count=1
            )[0]
        return outputs
