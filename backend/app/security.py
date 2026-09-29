from __future__ import annotations

import hmac
import uuid
from dataclasses import dataclass

from fastapi import Header, Request

from .config import get_settings


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        retriable: bool = False,
        details: dict | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.retriable = retriable
        self.details = details or {}
        super().__init__(message)


@dataclass(frozen=True)
class Actor:
    owner_id: str


def get_actor(
    request: Request,
    authorization: str | None = Header(default=None),
    x_staypet_owner_id: str | None = Header(default=None),
) -> Actor:
    settings = get_settings()
    if settings.poc_api_token:
        expected = f"Bearer {settings.poc_api_token}"
        if not authorization or not hmac.compare_digest(authorization, expected):
            raise ApiError(401, "unauthorized", "A valid PoC bearer token is required")
    if not x_staypet_owner_id:
        raise ApiError(400, "owner_id_required", "X-StayPet-Owner-Id is required")
    try:
        owner_id = str(uuid.UUID(x_staypet_owner_id))
    except ValueError as exc:
        raise ApiError(400, "invalid_owner_id", "X-StayPet-Owner-Id must be a UUID") from exc
    request.state.owner_id = owner_id
    return Actor(owner_id=owner_id)
