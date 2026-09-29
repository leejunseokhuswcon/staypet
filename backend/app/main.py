from __future__ import annotations

import hashlib
import mimetypes
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models
from .asset_validation import validate_source_image
from .config import get_settings
from .database import create_schema, get_db
from .providers import ImageGenerationProvider, ProviderError, build_provider
from .schemas import (
    AssetJobCreate,
    AssetPackManifestResponse,
    CandidateJobCreate,
    CandidateResponse,
    CanonicalResponse,
    CanonicalSelectionCreate,
    ErrorResponse,
    GenerationJobResponse,
    PetCreate,
    PetResponse,
    SourceImageResponse,
)
from .security import Actor, ApiError, get_actor
from .services import (
    candidate_response,
    canonical_response,
    create_asset_job,
    create_candidate_job,
    job_response,
    manifest_response,
    media_extension,
    owned_pet,
    select_canonical,
)
from .storage import LocalObjectStorage, ObjectStorage, StorageError, build_storage, safe_storage_path


@asynccontextmanager
async def lifespan(app: FastAPI):
    if get_settings().auto_create_schema and not getattr(app.state, "skip_schema_creation", False):
        create_schema()
    yield


app = FastAPI(
    title="StayPet Backend",
    version="0.1.0",
    description="Backend foundation and identity-preserving character generation PoC",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-StayPet-Owner-Id", "X-Request-Id"],
    expose_headers=["X-Request-Id"],
)


def get_storage() -> ObjectStorage:
    return build_storage()


def get_provider() -> ImageGenerationProvider:
    return build_provider()


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request.state.request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-Id"] = request.state.request_id
    return response


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "retriable": exc.retriable,
                "details": exc.details,
                "request_id": getattr(request.state, "request_id", None),
            }
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "request_validation_failed",
                "message": "Request validation failed",
                "retriable": False,
                "details": {"errors": jsonable_encoder(exc.errors())},
                "request_id": getattr(request.state, "request_id", None),
            }
        },
    )


@app.exception_handler(ProviderError)
async def provider_configuration_error_handler(request: Request, exc: ProviderError):
    return JSONResponse(
        status_code=503,
        content={
            "error": {
                "code": exc.code,
                "message": str(exc),
                "retriable": exc.retriable,
                "details": {},
                "request_id": getattr(request.state, "request_id", None),
            }
        },
    )


@app.exception_handler(StorageError)
async def storage_error_handler(request: Request, exc: StorageError):
    return JSONResponse(
        status_code=503,
        content={
            "error": {
                "code": "storage_unavailable",
                "message": str(exc),
                "retriable": True,
                "details": {},
                "request_id": getattr(request.state, "request_id", None),
            }
        },
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/v1/pets", response_model=PetResponse, status_code=201)
def create_pet(payload: PetCreate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    pet = models.Pet(
        owner_id=actor.owner_id,
        name=payload.name.strip(),
        species=payload.species,
        appearance_metadata=payload.appearance_metadata,
    )
    db.add(pet)
    db.commit()
    db.refresh(pet)
    return pet


@app.post(
    "/api/v1/pets/{pet_id}/source-images",
    response_model=SourceImageResponse,
    status_code=201,
)
async def upload_source_image(
    pet_id: str,
    file: UploadFile = File(...),
    sort_order: int = Form(default=0),
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    pet = owned_pet(db, pet_id, actor.owner_id)
    active_count = db.scalar(
        select(func.count(models.PetSourceImage.id)).where(
            models.PetSourceImage.pet_id == pet.id,
            models.PetSourceImage.is_active.is_(True),
        )
    ) or 0
    data = await file.read()
    media_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    try:
        inspection = validate_source_image(data, media_type)
    except ValueError as exc:
        raise ApiError(422, "invalid_source_image", str(exc)) from exc
    sha256 = hashlib.sha256(data).hexdigest()
    duplicate = db.scalar(
        select(models.PetSourceImage).where(
            models.PetSourceImage.pet_id == pet.id,
            models.PetSourceImage.sha256 == sha256,
        )
    )
    if duplicate:
        return duplicate
    if active_count >= 5:
        raise ApiError(409, "source_image_limit_reached", "The PoC supports at most 5 active images")
    source = models.PetSourceImage(
        id=models.new_id(),
        pet_id=pet.id,
        storage_bucket=storage.bucket,
        storage_path="pending",
        media_type=inspection.media_type,
        byte_size=len(data),
        sha256=sha256,
        width=inspection.width,
        height=inspection.height,
        sort_order=sort_order,
    )
    source.storage_path = f"pets/{pet.id}/source/{source.id}.{media_extension(inspection.media_type)}"
    storage.put(source.storage_path, data, inspection.media_type)
    db.add(source)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "source_image_conflict", "Source image could not be registered")
    db.refresh(source)
    return source


@app.get("/api/v1/pets/{pet_id}/source-images", response_model=list[SourceImageResponse])
def list_source_images(pet_id: str, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    pet = owned_pet(db, pet_id, actor.owner_id)
    return list(
        db.scalars(
            select(models.PetSourceImage)
            .where(models.PetSourceImage.pet_id == pet.id, models.PetSourceImage.is_active.is_(True))
            .order_by(models.PetSourceImage.sort_order, models.PetSourceImage.created_at)
        )
    )


@app.post(
    "/api/v1/pets/{pet_id}/candidate-generation-jobs",
    response_model=GenerationJobResponse,
    status_code=202,
)
def enqueue_candidates(
    pet_id: str,
    payload: CandidateJobCreate,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=8, max_length=160),
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
    provider: ImageGenerationProvider = Depends(get_provider),
):
    pet = owned_pet(db, pet_id, actor.owner_id)
    return job_response(
        create_candidate_job(
            db,
            pet=pet,
            idempotency_key=idempotency_key,
            candidate_count=payload.candidate_count,
            provider=provider,
        )
    )


@app.get("/api/v1/generation-jobs/{job_id}", response_model=GenerationJobResponse)
def get_job(job_id: str, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    job = db.get(models.GenerationJob, job_id)
    if not job:
        raise ApiError(404, "generation_job_not_found", "Generation job was not found")
    owned_pet(db, job.pet_id, actor.owner_id)
    return job_response(job)


@app.get("/api/v1/pets/{pet_id}/candidates", response_model=list[CandidateResponse])
def list_candidates(
    pet_id: str,
    generation_job_id: str | None = None,
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    pet = owned_pet(db, pet_id, actor.owner_id)
    query = select(models.CharacterCandidate).where(models.CharacterCandidate.pet_id == pet.id)
    if generation_job_id:
        query = query.where(models.CharacterCandidate.generation_job_id == generation_job_id)
    rows = list(db.scalars(query.order_by(models.CharacterCandidate.created_at, models.CharacterCandidate.candidate_index)))
    return [candidate_response(row, storage) for row in rows]


@app.post(
    "/api/v1/pets/{pet_id}/canonical-characters",
    response_model=CanonicalResponse,
    status_code=201,
)
def choose_canonical(
    pet_id: str,
    payload: CanonicalSelectionCreate,
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    pet = owned_pet(db, pet_id, actor.owner_id)
    canonical = select_canonical(
        db,
        storage,
        pet=pet,
        candidate_id=payload.candidate_id,
        appearance_metadata=payload.appearance_metadata,
        corrections=payload.corrections,
    )
    return canonical_response(canonical, storage)


@app.get("/api/v1/pets/{pet_id}/canonical-character", response_model=CanonicalResponse)
def get_canonical(
    pet_id: str,
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    pet = owned_pet(db, pet_id, actor.owner_id)
    canonical = db.scalar(
        select(models.CanonicalCharacter)
        .where(models.CanonicalCharacter.pet_id == pet.id)
        .order_by(models.CanonicalCharacter.version.desc())
    )
    if not canonical:
        raise ApiError(404, "canonical_character_not_found", "Canonical character was not found")
    return canonical_response(canonical, storage)


@app.post(
    "/api/v1/canonical-characters/{canonical_id}/asset-pack-generation-jobs",
    response_model=GenerationJobResponse,
    status_code=202,
)
def enqueue_asset_pack(
    canonical_id: str,
    payload: AssetJobCreate,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=8, max_length=160),
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
    provider: ImageGenerationProvider = Depends(get_provider),
):
    canonical = db.get(models.CanonicalCharacter, canonical_id)
    if not canonical:
        raise ApiError(404, "canonical_character_not_found", "Canonical character was not found")
    owned_pet(db, canonical.pet_id, actor.owner_id)
    return job_response(
        create_asset_job(
            db,
            canonical=canonical,
            idempotency_key=idempotency_key,
            behaviors=payload.behaviors,
            provider=provider,
        )
    )


@app.get(
    "/api/v1/canonical-characters/{canonical_id}/asset-pack",
    response_model=AssetPackManifestResponse,
)
def get_asset_pack(
    canonical_id: str,
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    canonical = db.get(models.CanonicalCharacter, canonical_id)
    if not canonical:
        raise ApiError(404, "canonical_character_not_found", "Canonical character was not found")
    owned_pet(db, canonical.pet_id, actor.owner_id)
    pack = db.scalar(
        select(models.CharacterAssetPack)
        .where(
            models.CharacterAssetPack.canonical_character_id == canonical.id,
            models.CharacterAssetPack.status == "succeeded",
        )
        .order_by(models.CharacterAssetPack.version.desc())
    )
    if not pack:
        raise ApiError(404, "asset_pack_not_ready", "No completed Character Asset Pack is available", retriable=True)
    return manifest_response(db, pack, storage)


@app.get("/api/v1/media/{path:path}")
def local_media(path: str, storage: ObjectStorage = Depends(get_storage)):
    if not isinstance(storage, LocalObjectStorage):
        raise ApiError(404, "media_not_found", "Media is delivered by signed storage URL")
    target = storage._target(safe_storage_path(path))
    if not target.is_file():
        raise ApiError(404, "media_not_found", "Media was not found")
    return FileResponse(target, media_type=storage.content_type(path), filename=Path(path).name)
