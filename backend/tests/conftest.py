from __future__ import annotations

import io
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.database import Base, make_engine
from app.main import app, get_db, get_provider, get_storage
from app.providers.mock import MockImageGenerationProvider
from app.storage import LocalObjectStorage
from app.worker import GenerationWorker


@pytest.fixture
def owner_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def headers(owner_id: str) -> dict[str, str]:
    return {"X-StayPet-Owner-Id": owner_id}


@pytest.fixture
def session_factory(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    yield factory
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def storage(tmp_path):
    return LocalObjectStorage(tmp_path / "media", "http://testserver/api/v1/media", "staypet-assets")


@pytest.fixture
def provider():
    return MockImageGenerationProvider(delay_ms=0)


@pytest.fixture
def settings(tmp_path):
    return Settings(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        local_storage_root=tmp_path / "media",
        generation_provider="mock",
        mock_generation_delay_ms=0,
        worker_retry_base_seconds=0,
        poc_api_token=None,
    )


@pytest.fixture
def client(session_factory, storage, provider):
    def override_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_provider] = lambda: provider
    app.state.skip_schema_creation = True
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    app.state.skip_schema_creation = False


@pytest.fixture
def worker(session_factory, storage, provider, settings):
    return GenerationWorker(
        session_factory=session_factory,
        storage=storage,
        provider=provider,
        settings=settings,
    )


def png_bytes(color=(180, 140, 90, 255), size=(320, 320)) -> bytes:
    image = Image.new("RGBA", size, color)
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


@pytest.fixture
def create_pet_with_sources(client, headers):
    def _create(count: int = 2):
        pet_response = client.post(
            "/api/v1/pets",
            headers=headers,
            json={"name": "보리", "species": "dog", "appearance_metadata": {"coat": "cream"}},
        )
        assert pet_response.status_code == 201
        pet = pet_response.json()
        sources = []
        for index in range(count):
            response = client.post(
                f"/api/v1/pets/{pet['id']}/source-images",
                headers=headers,
                files={"file": (f"reference-{index}.png", png_bytes((180 + index, 140, 90, 255)), "image/png")},
                data={"sort_order": index},
            )
            assert response.status_code == 201
            sources.append(response.json())
        return pet, sources

    return _create
