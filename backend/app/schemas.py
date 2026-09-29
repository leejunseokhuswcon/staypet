from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    species: Literal["dog", "cat"]
    appearance_metadata: dict = Field(default_factory=dict)


class PetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    species: str
    appearance_metadata: dict
    created_at: datetime


class SourceImageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    pet_id: str
    media_type: str
    byte_size: int
    sha256: str
    width: int
    height: int
    sort_order: int
    created_at: datetime


class CandidateJobCreate(BaseModel):
    candidate_count: int = Field(default=3, ge=2, le=3)


class AssetJobCreate(BaseModel):
    behaviors: list[Literal["idle", "walk", "sleep", "eat", "play", "pet_positive"]] | None = None


class JobError(BaseModel):
    code: str
    message: str
    retriable: bool


class GenerationJobResponse(BaseModel):
    id: str
    pet_id: str
    canonical_character_id: str | None
    job_type: str
    status: Literal["queued", "processing", "succeeded", "failed"]
    provider: str
    provider_model: str
    prompt_version: str
    style_version: str
    config_version: str
    attempt_count: int
    max_attempts: int
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    error: JobError | None = None


class CandidateResponse(BaseModel):
    id: str
    pet_id: str
    generation_job_id: str
    candidate_index: int
    image_url: str
    media_type: str
    width: int
    height: int
    created_at: datetime


class CanonicalSelectionCreate(BaseModel):
    candidate_id: str
    appearance_metadata: dict = Field(default_factory=dict)
    corrections: list[dict] = Field(default_factory=list)


class CanonicalResponse(BaseModel):
    id: str
    pet_id: str
    version: int
    selected_candidate_id: str
    source_image_ids: list[str]
    species: str
    appearance_metadata: dict
    style_version: str
    provider: str
    provider_model: str
    prompt_version: str
    config_version: str
    correction_history: list[dict]
    image_url: str
    created_at: datetime


class AssetManifestItem(BaseModel):
    asset_id: str
    behavior: str
    orientation: str
    media_type: str
    width: int
    height: int
    has_transparency: bool
    floor_anchor: dict
    visual_bounds: dict
    source_generation_job_id: str
    generation_metadata: dict
    download_url: str


class AssetPackManifestResponse(BaseModel):
    manifest_version: str
    asset_pack_id: str
    asset_pack_version: int
    canonical_character_id: str
    canonical_version: int
    style_version: str
    provider: str
    provider_model: str
    prompt_version: str
    config_version: str
    generated_at: datetime
    assets: list[AssetManifestItem]


class ErrorBody(BaseModel):
    code: str
    message: str
    retriable: bool = False
    details: dict = Field(default_factory=dict)
    request_id: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody
