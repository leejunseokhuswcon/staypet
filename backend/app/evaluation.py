from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from sqlalchemy import select

from . import models
from .database import SessionLocal


FIELDS = [
    "pet_id",
    "job_id",
    "job_type",
    "provider",
    "provider_model",
    "status",
    "attempt_count",
    "latency_seconds",
    "candidate_count",
    "asset_count",
    "error_code",
    "provider_request_count",
    "provider_usage_json",
    "candidate_acceptable",
    "identity_consistency_score",
    "catastrophic_feature_change",
    "human_notes",
    "provider_cost_usd",
]


def export_rows() -> list[dict]:
    with SessionLocal() as db:
        jobs = list(db.scalars(select(models.GenerationJob).order_by(models.GenerationJob.created_at)))
        rows = []
        for job in jobs:
            latency = None
            if job.started_at and job.completed_at:
                latency = (job.completed_at - job.started_at).total_seconds()
            summary = job.output_summary or {}
            rows.append(
                {
                    "pet_id": job.pet_id,
                    "job_id": job.id,
                    "job_type": job.job_type,
                    "provider": job.provider,
                    "provider_model": job.provider_model,
                    "status": job.status,
                    "attempt_count": job.attempt_count,
                    "latency_seconds": latency,
                    "candidate_count": summary.get("candidate_count"),
                    "asset_count": summary.get("asset_count"),
                    "error_code": job.last_error_code,
                    "provider_request_count": len(summary.get("provider_request_ids", [])),
                    "provider_usage_json": json.dumps(summary.get("provider_usage", []), ensure_ascii=False),
                    "candidate_acceptable": "",
                    "identity_consistency_score": "",
                    "catastrophic_feature_change": "",
                    "human_notes": "",
                    "provider_cost_usd": summary.get("estimated_cost_usd", ""),
                }
            )
        return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Export StayPet identity PoC evaluation rows")
    parser.add_argument("--format", choices=["csv", "json"], default="csv")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = export_rows()
    if args.format == "json":
        path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(rows)


if __name__ == "__main__":
    main()
