from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, UnidentifiedImageError

REQUIRED_BEHAVIORS = ["idle", "walk", "sleep", "eat", "play", "pet_positive"]


@dataclass(frozen=True)
class ImageInspection:
    width: int
    height: int
    media_type: str
    has_transparency: bool


def inspect_image(data: bytes) -> ImageInspection:
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            fmt = (image.format or "PNG").upper()
            has_transparency = image.mode in {"RGBA", "LA"} or "transparency" in image.info
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("unreadable image") from exc
    media_type = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(
        fmt, "application/octet-stream"
    )
    return ImageInspection(width, height, media_type, has_transparency)


def validate_source_image(data: bytes, declared_media_type: str) -> ImageInspection:
    inspection = inspect_image(data)
    if inspection.media_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise ValueError("unsupported image format")
    if declared_media_type not in {"image/png", "image/jpeg", "image/jpg", "image/webp"}:
        raise ValueError("unsupported content type")
    if len(data) > 20 * 1024 * 1024:
        raise ValueError("image exceeds 20 MB")
    if inspection.width < 128 or inspection.height < 128:
        raise ValueError("image dimensions are too small")
    return inspection


def validate_generated_asset(data: bytes, *, require_transparency: bool = True) -> ImageInspection:
    inspection = inspect_image(data)
    if not (256 <= inspection.width <= 4096 and 256 <= inspection.height <= 4096):
        raise ValueError("generated asset dimensions are outside 256..4096")
    if require_transparency and not inspection.has_transparency:
        raise ValueError("generated asset must include transparency")
    return inspection


def validate_manifest(manifest: dict) -> list[str]:
    errors: list[str] = []
    assets = manifest.get("assets") or []
    ids = [asset.get("asset_id") for asset in assets]
    if len(ids) != len(set(ids)):
        errors.append("duplicate asset_id")
    behaviors = {asset.get("behavior") for asset in assets}
    missing = sorted(set(REQUIRED_BEHAVIORS) - behaviors)
    if missing:
        errors.append(f"missing required behaviors: {', '.join(missing)}")
    for asset in assets:
        anchor = asset.get("floor_anchor") or {}
        if not (0 <= anchor.get("x", -1) <= 1 and 0 <= anchor.get("y", -1) <= 1):
            errors.append(f"invalid floor anchor: {asset.get('asset_id')}")
        bounds = asset.get("visual_bounds") or {}
        if not all(0 <= bounds.get(key, -1) <= 1 for key in ("x", "y", "width", "height")):
            errors.append(f"invalid visual bounds: {asset.get('asset_id')}")
    return errors
