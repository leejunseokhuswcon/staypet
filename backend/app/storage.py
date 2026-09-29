from __future__ import annotations

import mimetypes
from abc import ABC, abstractmethod
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import httpx

from .config import Settings, get_settings


class StorageError(RuntimeError):
    pass


def safe_storage_path(path: str) -> str:
    normalized = str(PurePosixPath(path))
    if normalized.startswith("/") or ".." in PurePosixPath(normalized).parts:
        raise StorageError("unsafe storage path")
    return normalized


class ObjectStorage(ABC):
    bucket: str

    @abstractmethod
    def put(self, path: str, data: bytes, content_type: str) -> None: ...

    @abstractmethod
    def get(self, path: str) -> bytes: ...

    @abstractmethod
    def delete_prefix(self, prefix: str) -> None: ...

    def copy(self, source_path: str, destination_path: str, content_type: str) -> None:
        self.put(destination_path, self.get(source_path), content_type)

    @abstractmethod
    def public_or_signed_url(self, path: str, expires_seconds: int = 900) -> str: ...


class LocalObjectStorage(ObjectStorage):
    def __init__(self, root: Path, public_base_url: str, bucket: str = "local") -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.public_base_url = public_base_url.rstrip("/")
        self.bucket = bucket

    def _target(self, path: str) -> Path:
        target = (self.root / safe_storage_path(path)).resolve()
        if self.root not in target.parents and target != self.root:
            raise StorageError("storage path escapes configured root")
        return target

    def put(self, path: str, data: bytes, content_type: str) -> None:
        target = self._target(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def get(self, path: str) -> bytes:
        target = self._target(path)
        if not target.is_file():
            raise StorageError(f"object not found: {path}")
        return target.read_bytes()

    def delete_prefix(self, prefix: str) -> None:
        target = self._target(prefix)
        if target.is_file():
            target.unlink()
            return
        if target.is_dir():
            for child in sorted(target.rglob("*"), reverse=True):
                if child.is_file() or child.is_symlink():
                    child.unlink()
                elif child.is_dir():
                    child.rmdir()
            target.rmdir()

    def public_or_signed_url(self, path: str, expires_seconds: int = 900) -> str:
        del expires_seconds
        return f"{self.public_base_url}/{quote(safe_storage_path(path), safe='/')}"

    def content_type(self, path: str) -> str:
        return mimetypes.guess_type(path)[0] or "application/octet-stream"


class SupabaseObjectStorage(ObjectStorage):
    """Server-only Supabase Storage REST adapter for a private bucket."""

    def __init__(self, url: str, service_role_key: str, bucket: str) -> None:
        self.base_url = url.rstrip("/")
        self.service_role_key = service_role_key
        self.bucket = bucket

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.service_role_key}",
            "apikey": self.service_role_key,
        }

    def put(self, path: str, data: bytes, content_type: str) -> None:
        path = safe_storage_path(path)
        response = httpx.post(
            f"{self.base_url}/storage/v1/object/{self.bucket}/{path}",
            headers={**self.headers, "Content-Type": content_type, "x-upsert": "true"},
            content=data,
            timeout=60,
        )
        if response.status_code >= 300:
            raise StorageError(f"Supabase upload failed ({response.status_code})")

    def get(self, path: str) -> bytes:
        path = safe_storage_path(path)
        response = httpx.get(
            f"{self.base_url}/storage/v1/object/authenticated/{self.bucket}/{path}",
            headers=self.headers,
            timeout=60,
        )
        if response.status_code >= 300:
            raise StorageError(f"Supabase download failed ({response.status_code})")
        return response.content

    def delete_prefix(self, prefix: str) -> None:
        prefix = safe_storage_path(prefix)
        list_response = httpx.post(
            f"{self.base_url}/storage/v1/object/list/{self.bucket}",
            headers={**self.headers, "Content-Type": "application/json"},
            json={"prefix": prefix, "limit": 1000},
            timeout=60,
        )
        if list_response.status_code >= 300:
            raise StorageError(f"Supabase list failed ({list_response.status_code})")
        paths = [f"{prefix.rstrip('/')}/{item['name']}" for item in list_response.json()]
        if not paths:
            return
        response = httpx.request(
            "DELETE",
            f"{self.base_url}/storage/v1/object/{self.bucket}",
            headers={**self.headers, "Content-Type": "application/json"},
            json={"prefixes": paths},
            timeout=60,
        )
        if response.status_code >= 300:
            raise StorageError(f"Supabase delete failed ({response.status_code})")

    def public_or_signed_url(self, path: str, expires_seconds: int = 900) -> str:
        path = safe_storage_path(path)
        response = httpx.post(
            f"{self.base_url}/storage/v1/object/sign/{self.bucket}/{path}",
            headers={**self.headers, "Content-Type": "application/json"},
            json={"expiresIn": expires_seconds},
            timeout=30,
        )
        if response.status_code >= 300:
            raise StorageError(f"Supabase signed URL failed ({response.status_code})")
        signed = response.json().get("signedURL") or response.json().get("signedUrl")
        if not signed:
            raise StorageError("Supabase signed URL response was missing signedURL")
        if signed.startswith("http"):
            return signed
        return f"{self.base_url}/storage/v1{signed}"


def build_storage(settings: Settings | None = None) -> ObjectStorage:
    settings = settings or get_settings()
    if settings.storage_backend == "local":
        return LocalObjectStorage(
            settings.local_storage_root,
            settings.public_media_base_url,
            settings.supabase_storage_bucket,
        )
    if settings.storage_backend == "supabase":
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise StorageError("Supabase storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
        return SupabaseObjectStorage(
            settings.supabase_url,
            settings.supabase_service_role_key,
            settings.supabase_storage_bucket,
        )
    raise StorageError(f"unsupported storage backend: {settings.storage_backend}")
