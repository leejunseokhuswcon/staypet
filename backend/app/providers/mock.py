from __future__ import annotations

import hashlib
import io
import time

from PIL import Image, ImageDraw

from .base import GeneratedImage, ImageGenerationProvider, ProviderError, SourceImage


class MockImageGenerationProvider(ImageGenerationProvider):
    name = "mock"
    model = "mock-stylized-real-v1"

    def __init__(self, delay_ms: int = 50, fail_first_attempt: bool = False) -> None:
        self.delay_ms = delay_ms
        self.fail_first_attempt = fail_first_attempt

    def _maybe_fail(self, attempt: int) -> None:
        if self.fail_first_attempt and attempt == 1:
            raise ProviderError("configured mock transient failure", code="mock_transient", retriable=True)
        if self.delay_ms:
            time.sleep(self.delay_ms / 1000)

    @staticmethod
    def _render(seed: str, label: str, pose: int) -> GeneratedImage:
        digest = hashlib.sha256(seed.encode()).digest()
        coat = (160 + digest[0] % 70, 120 + digest[1] % 70, 75 + digest[2] % 80, 255)
        accent = (max(0, coat[0] - 45), max(0, coat[1] - 45), max(0, coat[2] - 45), 255)
        image = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        body_box = (120 + pose * 2, 210, 390, 385)
        draw.ellipse(body_box, fill=coat)
        draw.ellipse((75, 135 + pose, 245, 315 + pose), fill=coat)
        draw.polygon([(95, 155), (115, 75), (155, 155)], fill=accent)
        draw.polygon([(175, 150), (215, 80), (230, 175)], fill=accent)
        draw.ellipse((105, 195, 128, 220), fill=(30, 24, 20, 255))
        draw.ellipse((178, 192, 201, 217), fill=(30, 24, 20, 255))
        draw.ellipse((61, 230, 105, 263), fill=(20, 16, 14, 255))
        draw.rounded_rectangle((135, 355, 175, 455), radius=18, fill=accent)
        draw.rounded_rectangle((305, 350, 345, 455), radius=18, fill=accent)
        draw.text((18, 476), label[:60], fill=(80, 70, 60, 180))
        out = io.BytesIO()
        image.save(out, format="PNG")
        return GeneratedImage(
            data=out.getvalue(),
            media_type="image/png",
            width=512,
            height=512,
            has_transparency=True,
            provider_asset_id=f"mock-{hashlib.sha1(seed.encode()).hexdigest()[:16]}",
            metadata={"mock": True, "label": label},
        )

    def generate_candidates(
        self,
        *,
        species: str,
        references: list[SourceImage],
        appearance_metadata: dict,
        count: int,
        attempt: int,
    ) -> list[GeneratedImage]:
        self._maybe_fail(attempt)
        identity = "|".join(sorted(item.sha256 for item in references))
        return [
            self._render(f"{identity}:{species}:candidate:{index}", f"candidate {index + 1}", index)
            for index in range(count)
        ]

    def generate_character_assets(
        self,
        *,
        species: str,
        canonical_reference: SourceImage,
        appearance_metadata: dict,
        behaviors: list[str],
        attempt: int,
    ) -> dict[str, GeneratedImage]:
        self._maybe_fail(attempt)
        return {
            behavior: self._render(
                f"{canonical_reference.sha256}:{species}:asset:{behavior}", behavior, index
            )
            for index, behavior in enumerate(behaviors)
        }
