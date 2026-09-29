from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class Pet(Base, TimestampMixin):
    __tablename__ = "pets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    species: Mapped[str] = mapped_column(String(16), nullable=False)
    appearance_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    source_images = relationship("PetSourceImage", back_populates="pet", cascade="all, delete-orphan")


class PetSourceImage(Base, TimestampMixin):
    __tablename__ = "pet_source_images"
    __table_args__ = (UniqueConstraint("pet_id", "sha256", name="uq_pet_source_sha256"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    pet_id: Mapped[str] = mapped_column(ForeignKey("pets.id", ondelete="CASCADE"), nullable=False, index=True)
    storage_bucket: Mapped[str] = mapped_column(String(120), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    media_type: Mapped[str] = mapped_column(String(80), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    pet = relationship("Pet", back_populates="source_images")


class GenerationJob(Base, TimestampMixin):
    __tablename__ = "generation_jobs"
    __table_args__ = (
        UniqueConstraint("pet_id", "job_type", "idempotency_key", name="uq_generation_job_idempotency"),
        Index("ix_generation_jobs_claim", "status", "next_attempt_at", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    pet_id: Mapped[str] = mapped_column(ForeignKey("pets.id", ondelete="CASCADE"), nullable=False, index=True)
    canonical_character_id: Mapped[str | None] = mapped_column(
        ForeignKey(
            "canonical_characters.id",
            ondelete="CASCADE",
            name="generation_jobs_canonical_character_fk",
            use_alter=True,
        ),
        index=True,
    )
    job_type: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_model: Mapped[str] = mapped_column(String(120), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(80), nullable=False)
    style_version: Mapped[str] = mapped_column(String(80), nullable=False)
    config_version: Mapped[str] = mapped_column(String(80), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    input_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    output_summary: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_code: Mapped[str | None] = mapped_column(String(120))
    last_error_message: Mapped[str | None] = mapped_column(Text)
    last_error_retriable: Mapped[bool | None] = mapped_column(Boolean)


class CharacterCandidate(Base, TimestampMixin):
    __tablename__ = "character_candidates"
    __table_args__ = (
        UniqueConstraint("generation_job_id", "candidate_index", name="uq_candidate_job_index"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    pet_id: Mapped[str] = mapped_column(ForeignKey("pets.id", ondelete="CASCADE"), nullable=False, index=True)
    generation_job_id: Mapped[str] = mapped_column(
        ForeignKey("generation_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    candidate_index: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_bucket: Mapped[str] = mapped_column(String(120), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    media_type: Mapped[str] = mapped_column(String(80), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_asset_id: Mapped[str | None] = mapped_column(String(255))
    generation_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class CanonicalCharacter(Base, TimestampMixin):
    __tablename__ = "canonical_characters"
    __table_args__ = (
        UniqueConstraint("pet_id", "version", name="uq_canonical_pet_version"),
        UniqueConstraint("pet_id", "selection_fingerprint", name="uq_canonical_pet_fingerprint"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    pet_id: Mapped[str] = mapped_column(ForeignKey("pets.id", ondelete="CASCADE"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    selected_candidate_id: Mapped[str] = mapped_column(
        ForeignKey("character_candidates.id", ondelete="RESTRICT"), nullable=False
    )
    selection_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    source_image_ids: Mapped[list] = mapped_column(JSON, nullable=False)
    species: Mapped[str] = mapped_column(String(16), nullable=False)
    appearance_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    style_version: Mapped[str] = mapped_column(String(80), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_model: Mapped[str] = mapped_column(String(120), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(80), nullable=False)
    config_version: Mapped[str] = mapped_column(String(80), nullable=False)
    correction_history: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    storage_bucket: Mapped[str] = mapped_column(String(120), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)


class CharacterAssetPack(Base, TimestampMixin):
    __tablename__ = "character_asset_packs"
    __table_args__ = (UniqueConstraint("canonical_character_id", "version", name="uq_pack_canonical_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    canonical_character_id: Mapped[str] = mapped_column(
        ForeignKey("canonical_characters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    generation_job_id: Mapped[str] = mapped_column(
        ForeignKey("generation_jobs.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False)
    manifest_version: Mapped[str] = mapped_column(String(40), default="1.0", nullable=False)
    required_states: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    manifest: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    storage_bucket: Mapped[str | None] = mapped_column(String(120))
    manifest_storage_path: Mapped[str | None] = mapped_column(String(512), unique=True)
    validation_errors: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CharacterAsset(Base, TimestampMixin):
    __tablename__ = "character_assets"
    __table_args__ = (
        UniqueConstraint("asset_pack_id", "behavior", "orientation", name="uq_asset_pack_state_view"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    asset_pack_id: Mapped[str] = mapped_column(
        ForeignKey("character_asset_packs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    canonical_character_id: Mapped[str] = mapped_column(
        ForeignKey("canonical_characters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    generation_job_id: Mapped[str] = mapped_column(
        ForeignKey("generation_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    behavior: Mapped[str] = mapped_column(String(40), nullable=False)
    orientation: Mapped[str] = mapped_column(String(40), nullable=False)
    media_type: Mapped[str] = mapped_column(String(80), nullable=False)
    storage_bucket: Mapped[str] = mapped_column(String(120), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    has_transparency: Mapped[bool] = mapped_column(Boolean, nullable=False)
    floor_anchor: Mapped[dict] = mapped_column(JSON, nullable=False)
    visual_bounds: Mapped[dict] = mapped_column(JSON, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_asset_id: Mapped[str | None] = mapped_column(String(255))
    generation_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
