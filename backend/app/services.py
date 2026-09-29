from __future__ import annotations

import hashlib
import json
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models
from .asset_validation import REQUIRED_BEHAVIORS, validate_source_image
from .config import Settings, get_settings
from .prompts import (
    ASSET_PROMPT_VERSION,
    CANDIDATE_PROMPT_VERSION,
    CONFIG_VERSION,
    STYLE_VERSION,
)
from .providers.base import ImageGenerationProvider
from .schemas import (
    AssetPackManifestResponse,
    CandidateResponse,
    CanonicalResponse,
    GenerationJobResponse,
    JobError,
)
from .security import ApiError
from .storage import ObjectStorage


def owned_pet(db: Session, pet_id: str, owner_id: str) -> models.Pet:
    pet = db.scalar(
        select(models.Pet).where(
            models.Pet.id == pet_id,
            models.Pet.owner_id == owner_id,
            models.Pet.deleted_at.is_(None),
        )
    )
    if not pet:
        raise ApiError(404, "pet_not_found", "Pet was not found")
    return pet


def job_response(job: models.GenerationJob) -> GenerationJobResponse:
    error = None
    if job.last_error_code:
        error = JobError(
            code=job.last_error_code,
            message=job.last_error_message or "Generation failed",
            retriable=bool(job.last_error_retriable),
        )
    return GenerationJobResponse(
        id=job.id,
        pet_id=job.pet_id,
        canonical_character_id=job.canonical_character_id,
        job_type=job.job_type,
        status=job.status,
        provider=job.provider,
        provider_model=job.provider_model,
        prompt_version=job.prompt_version,
        style_version=job.style_version,
        config_version=job.config_version,
        attempt_count=job.attempt_count,
        max_attempts=job.max_attempts,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        error=error,
    )


def create_candidate_job(
    db: Session,
    *,
    pet: models.Pet,
    idempotency_key: str,
    candidate_count: int,
    provider: ImageGenerationProvider,
) -> models.GenerationJob:
    existing = db.scalar(
        select(models.GenerationJob).where(
            models.GenerationJob.pet_id == pet.id,
            models.GenerationJob.job_type == "candidate_generation",
            models.GenerationJob.idempotency_key == idempotency_key,
        )
    )
    if existing:
        return existing
    images = list(
        db.scalars(
            select(models.PetSourceImage)
            .where(models.PetSourceImage.pet_id == pet.id, models.PetSourceImage.is_active.is_(True))
            .order_by(models.PetSourceImage.sort_order, models.PetSourceImage.created_at)
        )
    )
    if not 2 <= len(images) <= 5:
        raise ApiError(
            409,
            "source_image_count_invalid",
            "Candidate generation requires 2 to 5 active reference images for this PoC",
        )
    job = models.GenerationJob(
        pet_id=pet.id,
        job_type="candidate_generation",
        status="queued",
        provider=provider.name,
        provider_model=provider.model,
        prompt_version=CANDIDATE_PROMPT_VERSION,
        style_version=STYLE_VERSION,
        config_version=CONFIG_VERSION,
        idempotency_key=idempotency_key,
        input_snapshot={
            "source_image_ids": [item.id for item in images],
            "source_image_hashes": [item.sha256 for item in images],
            "candidate_count": candidate_count,
            "species": pet.species,
            "appearance_metadata": pet.appearance_metadata,
        },
        max_attempts=3,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def select_canonical(
    db: Session,
    storage: ObjectStorage,
    *,
    pet: models.Pet,
    candidate_id: str,
    appearance_metadata: dict,
    corrections: list[dict],
) -> models.CanonicalCharacter:
    candidate = db.scalar(
        select(models.CharacterCandidate).where(models.CharacterCandidate.id == candidate_id)
    )
    if not candidate or candidate.pet_id != pet.id:
        raise ApiError(422, "candidate_not_for_pet", "Candidate does not belong to this pet")
    job = db.get(models.GenerationJob, candidate.generation_job_id)
    if not job or job.status != "succeeded":
        raise ApiError(409, "candidate_job_not_succeeded", "Candidate generation is not complete")
    selection_fingerprint = hashlib.sha256(
        json.dumps(
            {
                "candidate_id": candidate.id,
                "appearance_metadata": appearance_metadata,
                "corrections": corrections,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    existing = db.scalar(
        select(models.CanonicalCharacter).where(
            models.CanonicalCharacter.pet_id == pet.id,
            models.CanonicalCharacter.selection_fingerprint == selection_fingerprint,
        )
    )
    if existing:
        return existing
    version = (db.scalar(select(func.max(models.CanonicalCharacter.version)).where(
        models.CanonicalCharacter.pet_id == pet.id
    )) or 0) + 1
    extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(
        candidate.media_type, "bin"
    )
    destination = f"pets/{pet.id}/canonical/v{version:04d}/canonical.{extension}"
    storage.copy(candidate.storage_path, destination, candidate.media_type)
    canonical = models.CanonicalCharacter(
        pet_id=pet.id,
        version=version,
        selected_candidate_id=candidate.id,
        selection_fingerprint=selection_fingerprint,
        source_image_ids=list(job.input_snapshot.get("source_image_ids", [])),
        species=pet.species,
        appearance_metadata={**pet.appearance_metadata, **appearance_metadata},
        style_version=job.style_version,
        provider=job.provider,
        provider_model=job.provider_model,
        prompt_version=job.prompt_version,
        config_version=job.config_version,
        correction_history=corrections,
        storage_bucket=storage.bucket,
        storage_path=destination,
    )
    db.add(canonical)
    db.commit()
    db.refresh(canonical)
    return canonical


def create_asset_job(
    db: Session,
    *,
    canonical: models.CanonicalCharacter,
    idempotency_key: str,
    behaviors: list[str] | None,
    provider: ImageGenerationProvider,
) -> models.GenerationJob:
    existing = db.scalar(
        select(models.GenerationJob).where(
            models.GenerationJob.pet_id == canonical.pet_id,
            models.GenerationJob.job_type == "asset_pack_generation",
            models.GenerationJob.idempotency_key == idempotency_key,
        )
    )
    if existing:
        if existing.canonical_character_id != canonical.id:
            raise ApiError(409, "idempotency_conflict", "Idempotency key was used for another canonical character")
        return existing
    requested = behaviors or REQUIRED_BEHAVIORS
    if sorted(set(requested)) != sorted(REQUIRED_BEHAVIORS):
        raise ApiError(422, "representative_states_required", "The PoC asset pack requires all representative states")
    job = models.GenerationJob(
        pet_id=canonical.pet_id,
        canonical_character_id=canonical.id,
        job_type="asset_pack_generation",
        status="queued",
        provider=provider.name,
        provider_model=provider.model,
        prompt_version=ASSET_PROMPT_VERSION,
        style_version=canonical.style_version,
        config_version=CONFIG_VERSION,
        idempotency_key=idempotency_key,
        input_snapshot={
            "canonical_character_id": canonical.id,
            "canonical_version": canonical.version,
            "behaviors": REQUIRED_BEHAVIORS,
            "appearance_metadata": canonical.appearance_metadata,
        },
        max_attempts=3,
    )
    db.add(job)
    db.flush()
    version = (db.scalar(select(func.max(models.CharacterAssetPack.version)).where(
        models.CharacterAssetPack.canonical_character_id == canonical.id
    )) or 0) + 1
    pack = models.CharacterAssetPack(
        canonical_character_id=canonical.id,
        generation_job_id=job.id,
        version=version,
        status="queued",
        required_states=REQUIRED_BEHAVIORS,
    )
    db.add(pack)
    db.commit()
    db.refresh(job)
    return job


def candidate_response(candidate: models.CharacterCandidate, storage: ObjectStorage) -> CandidateResponse:
    return CandidateResponse(
        id=candidate.id,
        pet_id=candidate.pet_id,
        generation_job_id=candidate.generation_job_id,
        candidate_index=candidate.candidate_index,
        image_url=storage.public_or_signed_url(candidate.storage_path),
        media_type=candidate.media_type,
        width=candidate.width,
        height=candidate.height,
        created_at=candidate.created_at,
    )


def canonical_response(canonical: models.CanonicalCharacter, storage: ObjectStorage) -> CanonicalResponse:
    return CanonicalResponse(
        id=canonical.id,
        pet_id=canonical.pet_id,
        version=canonical.version,
        selected_candidate_id=canonical.selected_candidate_id,
        source_image_ids=list(canonical.source_image_ids),
        species=canonical.species,
        appearance_metadata=canonical.appearance_metadata,
        style_version=canonical.style_version,
        provider=canonical.provider,
        provider_model=canonical.provider_model,
        prompt_version=canonical.prompt_version,
        config_version=canonical.config_version,
        correction_history=list(canonical.correction_history),
        image_url=storage.public_or_signed_url(canonical.storage_path),
        created_at=canonical.created_at,
    )


def manifest_response(
    db: Session, pack: models.CharacterAssetPack, storage: ObjectStorage
) -> AssetPackManifestResponse:
    canonical = db.get(models.CanonicalCharacter, pack.canonical_character_id)
    job = db.get(models.GenerationJob, pack.generation_job_id)
    assets = list(
        db.scalars(select(models.CharacterAsset).where(models.CharacterAsset.asset_pack_id == pack.id))
    )
    by_id = {asset.id: asset for asset in assets}
    payload = dict(pack.manifest)
    for item in payload.get("assets", []):
        row = by_id[item["asset_id"]]
        item["download_url"] = storage.public_or_signed_url(row.storage_path)
    return AssetPackManifestResponse.model_validate(payload)


def media_extension(media_type: str) -> str:
    return {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(media_type, "bin")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: dict) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, default=str).encode("utf-8")
