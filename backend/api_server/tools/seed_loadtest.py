"""
Seed a realistic data volume for performance testing.

    python -m tools.seed_loadtest --alerts 100000 --vehicles 5000

Defaults approximate one year at a moderately busy site: a few gates, a few
hundred detections a day, and an audit entry for every read and write.

Writes with executemany batches rather than the ORM: the point is to get to a
realistic table size quickly, not to exercise the model layer.
"""

from __future__ import annotations

import argparse
import random
import time
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import insert

from app.database import SessionLocal
from app.models import AccessLog, Alert, AuditLog, Vehicle

BATCH = 5000

MISMATCHES = ["none", "type", "color", "unregistered"]
STATUSES = ["open", "in_progress", "closed"]
FEEDBACK = ["pending", "false_alarm", "investigated", "escalated"]
COLORS = ["white", "grey", "black", "blue", "red", "silver"]
TYPES = ["sedan", "suv", "van", "hatchback"]
ACTIONS = ["approve", "deny", "entry", "exit"]
AUDIT_ACTIONS = [
    "alert.list",
    "vehicle.list",
    "access_log.list",
    "auth.login.succeeded",
    "alert.created",
]


def plate(i: int) -> str:
    return f"LT{i:06d}"


def seed(alerts: int, vehicles: int, days: int) -> None:
    rng = random.Random(1234)
    now = datetime.now(timezone.utc)
    started = time.perf_counter()

    with SessionLocal() as db:
        print(f"Seeding {vehicles} vehicles...")
        rows = [
            {
                "id": uuid.uuid4(),
                "plate_number": plate(i),
                "plate_display": plate(i),
                "make": rng.choice(["Toyota", "Ford", "VW", "BMW"]),
                "model": "Model",
                "color": rng.choice(COLORS),
                "vehicle_type": rng.choice(TYPES),
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            }
            for i in range(vehicles)
        ]
        for start in range(0, len(rows), BATCH):
            db.execute(insert(Vehicle), rows[start : start + BATCH])
            db.commit()

        print(f"Seeding {alerts} alerts...")
        for start in range(0, alerts, BATCH):
            chunk = []
            for i in range(start, min(start + BATCH, alerts)):
                created = now - timedelta(
                    seconds=rng.randint(0, days * 86400)
                )
                mismatch = rng.choice(MISMATCHES)
                needs_review = rng.random() < 0.18
                chunk.append(
                    {
                        "id": uuid.uuid4(),
                        "plate_number": plate(rng.randrange(vehicles)),
                        "detected_type": rng.choice(TYPES),
                        "detected_color": rng.choice(COLORS),
                        "plate_confidence": round(rng.uniform(0.5, 0.99), 3),
                        "type_confidence": round(rng.uniform(0.5, 0.99), 3),
                        "mismatch_type": mismatch,
                        "status": rng.choice(STATUSES),
                        "feedback_status": rng.choice(FEEDBACK),
                        "requires_review": needs_review,
                        "created_at": created,
                        "resolved_at": created + timedelta(minutes=rng.randint(1, 240))
                        if rng.random() < 0.5
                        else None,
                        "detector_name": "yolo",
                        "detector_version": rng.choice(["plates-v2.pt", "plates-v3.pt"]),
                    }
                )
            db.execute(insert(Alert), chunk)
            db.commit()
            print(f"  alerts: {min(start + BATCH, alerts)}/{alerts}", end="\r")
        print()

        access = alerts // 2
        print(f"Seeding {access} access logs...")
        for start in range(0, access, BATCH):
            chunk = [
                {
                    "id": uuid.uuid4(),
                    "plate_number": plate(rng.randrange(vehicles)),
                    "action": rng.choice(ACTIONS),
                    "timestamp": now - timedelta(seconds=rng.randint(0, days * 86400)),
                    "recorded_at": now,
                    "details": {"source": "gate-1"},
                }
                for _ in range(start, min(start + BATCH, access))
            ]
            db.execute(insert(AccessLog), chunk)
            db.commit()

        audits = alerts * 2
        print(f"Seeding {audits} audit entries...")
        for start in range(0, audits, BATCH):
            chunk = [
                {
                    "id": uuid.uuid4(),
                    "action": rng.choice(AUDIT_ACTIONS),
                    "actor_email": f"guard{rng.randint(1, 20)}@aegis.example",
                    "resource_type": "alert",
                    "ip_address": f"10.0.{rng.randint(0, 255)}.{rng.randint(1, 254)}",
                    "details": {"plate_number": plate(rng.randrange(vehicles))},
                    "created_at": now - timedelta(seconds=rng.randint(0, days * 86400)),
                }
                for _ in range(start, min(start + BATCH, audits))
            ]
            db.execute(insert(AuditLog), chunk)
            db.commit()
            print(f"  audit: {min(start + BATCH, audits)}/{audits}", end="\r")
        print()

    print(f"Done in {time.perf_counter() - started:.1f}s")


def main() -> int:
    parser = argparse.ArgumentParser(prog="tools.seed_loadtest")
    parser.add_argument("--alerts", type=int, default=100_000)
    parser.add_argument("--vehicles", type=int, default=5_000)
    parser.add_argument("--days", type=int, default=365)
    args = parser.parse_args()
    seed(args.alerts, args.vehicles, args.days)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
