from __future__ import annotations

import argparse
import logging
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, sessionmaker

from . import models
from .asset_validation import REQUIRED_BEHAVIORS, validate_generated_asset, validate_manifest
from .config import Settings, get_settings
from .database import SessionLocal, create_schema
from .prompts import STATE_GUIDANCE
from .providers import ImageGenerationProvider, ProviderError, SourceImage, build_provider
from .services import digest, json_bytes, media_extension
from .storage import ObjectStorage, StorageError, build_storage

logger = logging.getLogger(__name__)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def provider_metrics(results) -> tuple[list[dict], list[str]]:
    usage_by_key: dict[str, dict] = {}
    request_ids: list[str] = []
    for result in results:
        request_id = result.metadata.get("provider_request_id")
        usage = result.metadata.get("usage")
        if request_id and request_id not in request_ids:
            request_ids.append(request_id)
        if usage:
            key = request_id or str(usage)
            usage_by_key.setdefault(key, usage)
    return list(usage_by_key.values()), request_ids


class GenerationWorker:
    def __init__(
        self,
        *,
        session_factory: sessionmaker = SessionLocal,
        storage: ObjectStorage | None = None,
        provider: ImageGenerationProvider | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.session_factory = session_factory
        self.storage = storage or build_storage(self.settings)
        self.provider = provider or build_provider(self.settings)

    def claim_next(self, db: Session) -> models.GenerationJob | None:
        current = now_utc()
        statement = (
            select(models.GenerationJob)
            .where(
                models.GenerationJob.status == "queued",
                or_(
                    models.GenerationJob.next_attempt_at.is_(None),
                    models.GenerationJob.next_attempt_at <= current,
                ),
            )
            .order_by(models.GenerationJob.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        job = db.scalar(statement)
        if not job:
            return None
        job.status = "processing"
        job.attempt_count += 1
        job.started_at = job.started_at or current
        job.next_attempt_at = None
        job.last_error_code = None
        job.last_error_message = None
        job.last_error_retriable = None
        pack = db.scalar(
            select(models.CharacterAssetPack).where(models.CharacterAssetPack.generation_job_id == job.id)
        )
        if pack:
            pack.status = "processing"
        db.commit()
        db.refresh(job)
        return job

    def run_once(self) -> bool:
        with self.session_factory() as db:
            job = self.claim_next(db)
            if not job:
                return False
            try:
                if job.job_type == "candidate_generation":
                    self._generate_candidates(db, job)
                elif job.job_type == "asset_pack_generation":
                    self._generate_asset_pack(db, job)
                else:
                    raise ProviderError(
                        f"unknown job type: {job.job_type}", code="unknown_job_type", retriable=False
                    )
                job.status = "succeeded"
                job.completed_at = now_utc()
                db.commit()
                logger.info("generation job succeeded", extra={"job_id": job.id})
            except ProviderError as exc:
                self._record_failure(db, job, exc.code, str(exc), exc.retriable)
            except ValueError as exc:
                self._record_failure(db, job, "asset_validation_failed", str(exc), True)
            except StorageError as exc:
                self._record_failure(db, job, "storage_error", str(exc), True)
            except Exception as exc:  # a worker must preserve failure state before surfacing diagnostics
                logger.exception("unexpected generation worker failure", extra={"job_id": job.id})
                self._record_failure(db, job, "internal_generation_error", str(exc), True)
            return True

    def _record_failure(
        self,
        db: Session,
        job: models.GenerationJob,
        code: str,
        message: str,
        retriable: bool,
    ) -> None:
        job.last_error_code = code
        job.last_error_message = message[:4000]
        job.last_error_retriable = retriable
        pack = db.scalar(
            select(models.CharacterAssetPack).where(models.CharacterAssetPack.generation_job_id == job.id)
        )
        if retriable and job.attempt_count < job.max_attempts:
            job.status = "queued"
            delay = self.settings.worker_retry_base_seconds * (2 ** (job.attempt_count - 1))
            job.next_attempt_at = now_utc() + timedelta(seconds=delay)
            if pack:
                pack.status = "queued"
        else:
            job.status = "failed"
            job.completed_at = now_utc()
            if pack:
                pack.status = "failed"
                pack.validation_errors = [{"code": code, "message": message[:1000]}]
        db.commit()

    def _sources(self, db: Session, ids: list[str]) -> list[SourceImage]:
        rows = {
            row.id: row
            for row in db.scalars(select(models.PetSourceImage).where(models.PetSourceImage.id.in_(ids)))
        }
        if set(rows) != set(ids):
            raise ProviderError("source image lineage is incomplete", code="source_lineage_missing", retriable=False)
        return [
            SourceImage(
                source_image_id=row.id,
                filename=f"{row.id}.{media_extension(row.media_type)}",
                media_type=row.media_type,
                data=self.storage.get(row.storage_path),
                sha256=row.sha256,
            )
            for row in (rows[item_id] for item_id in ids)
        ]

    def _generate_candidates(self, db: Session, job: models.GenerationJob) -> None:
        pet = db.get(models.Pet, job.pet_id)
        if not pet:
            raise ProviderError("pet lineage missing", code="pet_not_found", retriable=False)
        source_ids = list(job.input_snapshot["source_image_ids"])
        references = self._sources(db, source_ids)
        prefix = f"pets/{pet.id}/candidates/{job.id}"
        self.storage.delete_prefix(prefix)
        db.execute(delete(models.CharacterCandidate).where(models.CharacterCandidate.generation_job_id == job.id))
        db.flush()
        results = self.provider.generate_candidates(
            species=pet.species,
            references=references,
            appearance_metadata=job.input_snapshot.get("appearance_metadata", {}),
            count=int(job.input_snapshot["candidate_count"]),
            attempt=job.attempt_count,
        )
        if len(results) != int(job.input_snapshot["candidate_count"]):
            raise ProviderError("provider returned the wrong candidate count", code="candidate_count_mismatch")
        candidate_ids = []
        for index, result in enumerate(results):
            inspection = validate_generated_asset(result.data, require_transparency=True)
            candidate = models.CharacterCandidate(
                id=models.new_id(),
                pet_id=pet.id,
                generation_job_id=job.id,
                candidate_index=index,
                storage_bucket=self.storage.bucket,
                storage_path="pending",
                media_type=inspection.media_type,
                width=inspection.width,
                height=inspection.height,
                sha256=digest(result.data),
                provider_asset_id=result.provider_asset_id,
                generation_metadata=result.metadata,
            )
            candidate.storage_path = f"{prefix}/{candidate.id}.png"
            self.storage.put(candidate.storage_path, result.data, inspection.media_type)
            db.add(candidate)
            candidate_ids.append(candidate.id)
        provider_usage, provider_request_ids = provider_metrics(results)
        job.output_summary = {
            "candidate_ids": candidate_ids,
            "candidate_count": len(candidate_ids),
            "provider_usage": provider_usage,
            "provider_request_ids": provider_request_ids,
        }
        db.flush()

    def _generate_asset_pack(self, db: Session, job: models.GenerationJob) -> None:
        canonical = db.get(models.CanonicalCharacter, job.canonical_character_id)
        if not canonical:
            raise ProviderError("canonical lineage missing", code="canonical_not_found", retriable=False)
        pack = db.scalar(
            select(models.CharacterAssetPack).where(models.CharacterAssetPack.generation_job_id == job.id)
        )
        if not pack:
            raise ProviderError("asset pack row missing", code="asset_pack_missing", retriable=False)
        canonical_bytes = self.storage.get(canonical.storage_path)
        canonical_source = SourceImage(
            source_image_id=canonical.id,
            filename=f"canonical-v{canonical.version}.png",
            media_type="image/png",
            data=canonical_bytes,
            sha256=digest(canonical_bytes),
        )
        prefix = f"pets/{canonical.pet_id}/assets/v{pack.version:04d}"
        self.storage.delete_prefix(prefix)
        db.execute(delete(models.CharacterAsset).where(models.CharacterAsset.asset_pack_id == pack.id))
        db.flush()
        outputs = self.provider.generate_character_assets(
            species=canonical.species,
            canonical_reference=canonical_source,
            appearance_metadata=canonical.appearance_metadata,
            behaviors=REQUIRED_BEHAVIORS,
            attempt=job.attempt_count,
        )
        if set(outputs) != set(REQUIRED_BEHAVIORS):
            raise ProviderError("provider omitted representative states", code="missing_asset_state", retriable=True)
        rows: list[models.CharacterAsset] = []
        for behavior in REQUIRED_BEHAVIORS:
            result = outputs[behavior]
            inspection = validate_generated_asset(result.data, require_transparency=True)
            orientation = STATE_GUIDANCE[behavior][0]
            asset = models.CharacterAsset(
                id=models.new_id(),
                asset_pack_id=pack.id,
                canonical_character_id=canonical.id,
                generation_job_id=job.id,
                behavior=behavior,
                orientation=orientation,
                media_type=inspection.media_type,
                storage_bucket=self.storage.bucket,
                storage_path="pending",
                width=inspection.width,
                height=inspection.height,
                has_transparency=inspection.has_transparency,
                floor_anchor={"x": 0.5, "y": 0.96},
                visual_bounds={"x": 0.04, "y": 0.04, "width": 0.92, "height": 0.92},
                sha256=digest(result.data),
                provider_asset_id=result.provider_asset_id,
                generation_metadata=result.metadata,
            )
            asset.storage_path = f"{prefix}/{behavior}-{orientation}-{asset.id}.png"
            self.storage.put(asset.storage_path, result.data, inspection.media_type)
            db.add(asset)
            rows.append(asset)
        db.flush()
        generated_at = now_utc()
        manifest = {
            "manifest_version": pack.manifest_version,
            "asset_pack_id": pack.id,
            "asset_pack_version": pack.version,
            "canonical_character_id": canonical.id,
            "canonical_version": canonical.version,
            "style_version": canonical.style_version,
            "provider": job.provider,
            "provider_model": job.provider_model,
            "prompt_version": job.prompt_version,
            "config_version": job.config_version,
            "generated_at": generated_at.isoformat(),
            "assets": [
                {
                    "asset_id": row.id,
                    "behavior": row.behavior,
                    "orientation": row.orientation,
                    "media_type": row.media_type,
                    "width": row.width,
                    "height": row.height,
                    "has_transparency": row.has_transparency,
                    "floor_anchor": row.floor_anchor,
                    "visual_bounds": row.visual_bounds,
                    "source_generation_job_id": job.id,
                    "generation_metadata": row.generation_metadata,
                    "download_url": "resolved-at-read-time",
                }
                for row in rows
            ],
        }
        errors = validate_manifest(manifest)
        if errors:
            raise ProviderError("; ".join(errors), code="manifest_invalid", retriable=False)
        manifest_path = f"{prefix}/manifest.json"
        self.storage.put(manifest_path, json_bytes(manifest), "application/json")
        pack.status = "succeeded"
        pack.manifest = manifest
        pack.storage_bucket = self.storage.bucket
        pack.manifest_storage_path = manifest_path
        pack.validation_errors = []
        pack.completed_at = generated_at
        provider_usage, provider_request_ids = provider_metrics(outputs.values())
        job.output_summary = {
            "asset_pack_id": pack.id,
            "asset_count": len(rows),
            "provider_usage": provider_usage,
            "provider_request_ids": provider_request_ids,
        }
        db.flush()


def main() -> None:
    parser = argparse.ArgumentParser(description="StayPet generation worker")
    parser.add_argument("--once", action="store_true", help="Process at most one queued job")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    if settings.auto_create_schema:
        create_schema()
    worker = GenerationWorker(settings=settings)
    if args.once:
        worker.run_once()
        return
    while True:
        worked = worker.run_once()
        if not worked:
            time.sleep(worker.settings.worker_poll_seconds)


if __name__ == "__main__":
    main()
