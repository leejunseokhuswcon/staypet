from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class ProviderError(RuntimeError):
    def __init__(self, message: str, *, code: str = "provider_error", retriable: bool = True) -> None:
        super().__init__(message)
        self.code = code
        self.retriable = retriable


@dataclass(frozen=True)
class SourceImage:
    source_image_id: str
    filename: str
    media_type: str
    data: bytes
    sha256: str


@dataclass(frozen=True)
class GeneratedImage:
    data: bytes
    media_type: str
    width: int
    height: int
    has_transparency: bool
    provider_asset_id: str | None = None
    metadata: dict = field(default_factory=dict)


class ImageGenerationProvider(ABC):
    name: str
    model: str

    @abstractmethod
    def generate_candidates(
        self,
        *,
        species: str,
        references: list[SourceImage],
        appearance_metadata: dict,
        count: int,
        attempt: int,
    ) -> list[GeneratedImage]: ...

    @abstractmethod
    def generate_character_assets(
        self,
        *,
        species: str,
        canonical_reference: SourceImage,
        appearance_metadata: dict,
        behaviors: list[str],
        attempt: int,
    ) -> dict[str, GeneratedImage]: ...
