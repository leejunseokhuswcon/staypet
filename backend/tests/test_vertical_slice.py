from __future__ import annotations

import uuid

from sqlalchemy import select

from app import models
from app.asset_validation import REQUIRED_BEHAVIORS


def test_complete_mock_vertical_slice(
    client, headers, worker, session_factory, create_pet_with_sources
):
    pet, sources = create_pet_with_sources(2)
    create_job = client.post(
        f"/api/v1/pets/{pet['id']}/candidate-generation-jobs",
        headers={**headers, "Idempotency-Key": "candidate-run-0001"},
        json={"candidate_count": 3},
    )
    assert create_job.status_code == 202
    job = create_job.json()
    assert job["status"] == "queued"

    same_job = client.post(
        f"/api/v1/pets/{pet['id']}/candidate-generation-jobs",
        headers={**headers, "Idempotency-Key": "candidate-run-0001"},
        json={"candidate_count": 3},
    )
    assert same_job.status_code == 202
    assert same_job.json()["id"] == job["id"]

    assert worker.run_once() is True
    polled = client.get(f"/api/v1/generation-jobs/{job['id']}", headers=headers)
    assert polled.status_code == 200
    assert polled.json()["status"] == "succeeded"
    candidates_response = client.get(
        f"/api/v1/pets/{pet['id']}/candidates?generation_job_id={job['id']}", headers=headers
    )
    assert candidates_response.status_code == 200
    candidates = candidates_response.json()
    assert len(candidates) == 3

    invalid = client.post(
        f"/api/v1/pets/{pet['id']}/canonical-characters",
        headers=headers,
        json={"candidate_id": str(uuid.uuid4())},
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "candidate_not_for_pet"

    canonical_response = client.post(
        f"/api/v1/pets/{pet['id']}/canonical-characters",
        headers=headers,
        json={
            "candidate_id": candidates[0]["id"],
            "appearance_metadata": {"ear_color": "light gold"},
            "corrections": [{"field": "ear_color", "from": "gold", "to": "light gold"}],
        },
    )
    assert canonical_response.status_code == 201
    canonical = canonical_response.json()
    assert canonical["version"] == 1
    assert canonical["source_image_ids"] == [item["id"] for item in sources]

    repeated = client.post(
        f"/api/v1/pets/{pet['id']}/canonical-characters",
        headers=headers,
        json={
            "candidate_id": candidates[0]["id"],
            "appearance_metadata": {"ear_color": "light gold"},
            "corrections": [{"field": "ear_color", "from": "gold", "to": "light gold"}],
        },
    )
    assert repeated.status_code == 201
    assert repeated.json()["id"] == canonical["id"]

    revised = client.post(
        f"/api/v1/pets/{pet['id']}/canonical-characters",
        headers=headers,
        json={
            "candidate_id": candidates[0]["id"],
            "appearance_metadata": {"ear_color": "cream"},
            "corrections": [{"field": "ear_color", "from": "gold", "to": "cream"}],
        },
    )
    assert revised.status_code == 201
    assert revised.json()["version"] == 2
    assert revised.json()["id"] != canonical["id"]

    retrieved = client.get(f"/api/v1/pets/{pet['id']}/canonical-character", headers=headers)
    assert retrieved.status_code == 200
    assert retrieved.json()["id"] == revised.json()["id"]

    pack_job_response = client.post(
        f"/api/v1/canonical-characters/{canonical['id']}/asset-pack-generation-jobs",
        headers={**headers, "Idempotency-Key": "asset-pack-run-0001"},
        json={},
    )
    assert pack_job_response.status_code == 202
    pack_job = pack_job_response.json()
    assert pack_job["status"] == "queued"
    assert worker.run_once() is True
    assert client.get(f"/api/v1/generation-jobs/{pack_job['id']}", headers=headers).json()["status"] == "succeeded"

    manifest_response = client.get(
        f"/api/v1/canonical-characters/{canonical['id']}/asset-pack", headers=headers
    )
    assert manifest_response.status_code == 200
    manifest = manifest_response.json()
    assert {item["behavior"] for item in manifest["assets"]} == set(REQUIRED_BEHAVIORS)
    assert len(manifest["assets"]) == 6
    assert all(item["download_url"].startswith("http://testserver/") for item in manifest["assets"])
    assert all(item["has_transparency"] for item in manifest["assets"])

    with session_factory() as db:
        candidate_rows = list(db.scalars(select(models.CharacterCandidate)))
        canonical_row = db.get(models.CanonicalCharacter, canonical["id"])
        asset_rows = list(db.scalars(select(models.CharacterAsset)))
        assert all(row.generation_job_id == job["id"] for row in candidate_rows)
        assert canonical_row.selected_candidate_id == candidates[0]["id"]
        assert all(row.canonical_character_id == canonical["id"] for row in asset_rows)
        assert all(row.generation_job_id == pack_job["id"] for row in asset_rows)


def test_candidate_job_requires_two_to_five_images(client, headers, create_pet_with_sources):
    pet, _ = create_pet_with_sources(1)
    response = client.post(
        f"/api/v1/pets/{pet['id']}/candidate-generation-jobs",
        headers={**headers, "Idempotency-Key": "candidate-too-few"},
        json={"candidate_count": 3},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "source_image_count_invalid"


def test_cross_owner_and_invalid_job_are_hidden(client, headers, create_pet_with_sources):
    pet, _ = create_pet_with_sources(2)
    other_headers = {"X-StayPet-Owner-Id": str(uuid.uuid4())}
    response = client.get(f"/api/v1/pets/{pet['id']}/candidates", headers=other_headers)
    assert response.status_code == 404
    missing = client.get(f"/api/v1/generation-jobs/{uuid.uuid4()}", headers=headers)
    assert missing.status_code == 404
