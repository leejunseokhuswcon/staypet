from __future__ import annotations

from sqlalchemy import select

from app import models
from app.providers.base import ProviderError
from app.providers.mock import MockImageGenerationProvider
from app.worker import GenerationWorker


class PermanentFailureProvider(MockImageGenerationProvider):
    def generate_candidates(self, **kwargs):
        raise ProviderError("permanent fixture failure", code="fixture_permanent", retriable=False)


def enqueue(client, headers, pet_id, key="candidate-job-retry"):
    response = client.post(
        f"/api/v1/pets/{pet_id}/candidate-generation-jobs",
        headers={**headers, "Idempotency-Key": key},
        json={"candidate_count": 3},
    )
    assert response.status_code == 202
    return response.json()


def test_job_claim_exposes_processing_state(
    client, headers, worker, session_factory, create_pet_with_sources
):
    pet, _ = create_pet_with_sources(2)
    job = enqueue(client, headers, pet["id"])
    with session_factory() as db:
        claimed = worker.claim_next(db)
        assert claimed.id == job["id"]
    response = client.get(f"/api/v1/generation-jobs/{job['id']}", headers=headers)
    assert response.json()["status"] == "processing"
    assert response.json()["attempt_count"] == 1


def test_transient_failure_requeues_then_succeeds(
    client, headers, session_factory, storage, settings, create_pet_with_sources
):
    pet, _ = create_pet_with_sources(2)
    job = enqueue(client, headers, pet["id"], "candidate-transient")
    provider = MockImageGenerationProvider(delay_ms=0, fail_first_attempt=True)
    retrying_worker = GenerationWorker(
        session_factory=session_factory, storage=storage, provider=provider, settings=settings
    )
    assert retrying_worker.run_once() is True
    first = client.get(f"/api/v1/generation-jobs/{job['id']}", headers=headers).json()
    assert first["status"] == "queued"
    assert first["attempt_count"] == 1
    assert first["error"]["retriable"] is True
    assert retrying_worker.run_once() is True
    second = client.get(f"/api/v1/generation-jobs/{job['id']}", headers=headers).json()
    assert second["status"] == "succeeded"
    assert second["attempt_count"] == 2


def test_permanent_provider_failure_is_terminal(
    client, headers, session_factory, storage, settings, create_pet_with_sources
):
    pet, _ = create_pet_with_sources(2)
    job = enqueue(client, headers, pet["id"], "candidate-permanent")
    failing_worker = GenerationWorker(
        session_factory=session_factory,
        storage=storage,
        provider=PermanentFailureProvider(delay_ms=0),
        settings=settings,
    )
    assert failing_worker.run_once() is True
    response = client.get(f"/api/v1/generation-jobs/{job['id']}", headers=headers).json()
    assert response["status"] == "failed"
    assert response["error"] == {
        "code": "fixture_permanent",
        "message": "permanent fixture failure",
        "retriable": False,
    }


def test_idempotency_is_scoped_by_job_type(client, headers, worker, create_pet_with_sources):
    pet, _ = create_pet_with_sources(2)
    job = enqueue(client, headers, pet["id"], "same-client-key")
    worker.run_once()
    candidates = client.get(f"/api/v1/pets/{pet['id']}/candidates", headers=headers).json()
    canonical = client.post(
        f"/api/v1/pets/{pet['id']}/canonical-characters",
        headers=headers,
        json={"candidate_id": candidates[0]["id"]},
    ).json()
    asset_job = client.post(
        f"/api/v1/canonical-characters/{canonical['id']}/asset-pack-generation-jobs",
        headers={**headers, "Idempotency-Key": "same-client-key"},
        json={},
    )
    assert asset_job.status_code == 202
    assert asset_job.json()["id"] != job["id"]
