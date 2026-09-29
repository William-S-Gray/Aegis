"""
Administrative commands.

    python -m app.cli create-user --email a@b.c --name "Ada" --role admin
    python -m app.cli purge --dry-run
    python -m app.cli export-subject --plate AB12CD --out subject.json
    python -m app.cli erase-subject --plate AB12CD --confirm AB12CD

Passwords are read from AEGIS_PASSWORD or prompted for interactively; they are
never accepted as command-line arguments, which would leak them into shell
history and the process list.
"""

import argparse
import getpass
import json
import os
import sys
from pathlib import Path

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select, text

from app.core.security import hash_password
from app.database import SessionLocal
from app.models import Role, User
from app.schemas.user import MIN_PASSWORD_LENGTH
from app.services import privacy, retention


def _session():
    """
    A session without the API's per-query time limit.

    Erasure scans the audit log and purge works through a backlog; both can
    legitimately run longer than any single API request should.
    """
    db = SessionLocal()
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SET statement_timeout = 0"))
    return db


def create_user(email: str, full_name: str, role: str) -> int:
    email = email.strip().lower()
    # The same check the API applies: an address it cannot serialize would make
    # every user listing fail, and the account could never sign in.
    try:
        TypeAdapter(EmailStr).validate_python(email)
    except ValidationError as exc:
        print(f"Invalid email {email}: {exc.errors()[0]['msg']}", file=sys.stderr)
        return 1

    password = os.environ.get("AEGIS_PASSWORD")
    if not password:
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Confirm password: "):
            print("Passwords do not match.", file=sys.stderr)
            return 1

    if len(password) < MIN_PASSWORD_LENGTH:
        print(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters.", file=sys.stderr
        )
        return 1

    with _session() as db:
        if db.scalar(select(User).where(User.email == email)):
            print(f"A user with email {email} already exists.", file=sys.stderr)
            return 1

        user = User(
            email=email,
            full_name=full_name,
            hashed_password=hash_password(password),
            role=Role(role),
            is_active=True,
        )
        db.add(user)
        db.commit()
        print(f"Created {role} {email} (id={user.id})")
    return 0


def purge(dry_run: bool) -> int:
    with _session() as db:
        if dry_run:
            plan = retention.plan(db)
            print("Retention plan (nothing deleted):")
        else:
            plan = retention.purge(db)
            print("Purge complete:")

        for label, count in sorted(plan.counts.items()):
            cutoff = plan.cutoffs[label].date().isoformat()
            print(f"  {label:18} {count:>8}  (older than {cutoff})")
        print(f"  {'total':18} {plan.total:>8}")
    return 0


def export_subject(plate: str, out: str | None) -> int:
    with _session() as db:
        try:
            payload = privacy.export_by_plate(db, plate)
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 1

    text = json.dumps(payload, indent=2)
    if out:
        Path(out).write_text(text, encoding="utf-8")
        print(f"Wrote subject export for {payload['plate_number']} to {out}")
        print(f"  {payload['counts']}")
    else:
        print(text)
    return 0


def erase_subject(plate: str, confirm: str, reason: str | None) -> int:
    """
    Irreversible. Requires the plate to be repeated via --confirm so it cannot
    be triggered by a mistyped or shell-expanded argument.
    """
    from app.models import normalize_plate

    if not normalize_plate(plate):
        print(f"Refusing to erase: {plate!r} contains no letters or digits.", file=sys.stderr)
        return 1

    if normalize_plate(confirm) != normalize_plate(plate):
        print(
            "Refusing to erase: --confirm must repeat the plate exactly.",
            file=sys.stderr,
        )
        return 1

    with _session() as db:
        preview = privacy.export_by_plate(db, plate)
        if not any(preview["counts"].values()) and preview["vehicle"] is None:
            print(f"No data found for {preview['plate_number']}; nothing to erase.")
            return 0

        print(f"About to anonymise all data for {preview['plate_number']}:")
        for key, value in preview["counts"].items():
            print(f"  {key:16} {value}")

        record = privacy.erase_by_plate(db, plate, reason=reason)

    print(f"Erased. Tombstone: {record['tombstone']}")
    print("Rows were anonymised, not deleted, so the audit trail stays intact.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create-user", help="Create a user account")
    create.add_argument("--email", required=True)
    create.add_argument("--name", required=True, dest="full_name")
    create.add_argument(
        "--role", default="user", choices=[r.value for r in Role]
    )

    purge_cmd = sub.add_parser("purge", help="Delete data past its retention period")
    purge_cmd.add_argument(
        "--dry-run", action="store_true", help="Report what would be deleted"
    )

    export_cmd = sub.add_parser(
        "export-subject", help="Export everything held about one plate (SAR)"
    )
    export_cmd.add_argument("--plate", required=True)
    export_cmd.add_argument("--out", help="Write JSON here instead of stdout")

    erase_cmd = sub.add_parser(
        "erase-subject", help="Anonymise all data for one plate (right to erasure)"
    )
    erase_cmd.add_argument("--plate", required=True)
    erase_cmd.add_argument(
        "--confirm", required=True, help="Repeat the plate to confirm"
    )
    erase_cmd.add_argument("--reason", help="Recorded in the audit log")

    args = parser.parse_args()
    if args.command == "create-user":
        return create_user(args.email, args.full_name, args.role)
    if args.command == "purge":
        return purge(args.dry_run)
    if args.command == "export-subject":
        return export_subject(args.plate, args.out)
    if args.command == "erase-subject":
        return erase_subject(args.plate, args.confirm, args.reason)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
