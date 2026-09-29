from __future__ import annotations

import io

from PIL import Image

from app.asset_validation import validate_generated_asset, validate_manifest


def test_upload_rejects_unreadable_image(client, headers):
    pet = client.post(
        "/api/v1/pets", headers=headers, json={"name": "보리", "species": "dog"}
    ).json()
    response = client.post(
        f"/api/v1/pets/{pet['id']}/source-images",
        headers=headers,
        files={"file": ("broken.png", b"not-an-image", "image/png")},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_source_image"


def test_generated_asset_requires_alpha():
    image = Image.new("RGB", (512, 512), (120, 90, 60))
    data = io.BytesIO()
    image.save(data, "PNG")
    try:
        validate_generated_asset(data.getvalue())
    except ValueError as exc:
        assert "transparency" in str(exc)
    else:
        raise AssertionError("opaque asset should fail")


def test_manifest_detects_missing_state_duplicate_id_and_bad_anchor():
    manifest = {
        "assets": [
            {
                "asset_id": "same",
                "behavior": "idle",
                "floor_anchor": {"x": 2, "y": 0.9},
                "visual_bounds": {"x": 0, "y": 0, "width": 1, "height": 1},
            },
            {
                "asset_id": "same",
                "behavior": "walk",
                "floor_anchor": {"x": 0.5, "y": 0.9},
                "visual_bounds": {"x": 0, "y": 0, "width": 1, "height": 1},
            },
        ]
    }
    errors = validate_manifest(manifest)
    assert any("duplicate" in error for error in errors)
    assert any("missing required behaviors" in error for error in errors)
    assert any("invalid floor anchor" in error for error in errors)
