"""
Fill an EMPTY Aegis deployment with sample data for a demo.

    AEGIS_ADMIN_EMAIL=... AEGIS_ADMIN_PASSWORD=... \
      python -m tools.seed_demo https://aegis-eight-snowy.vercel.app --credentials-out ~/aegis-demo-accounts.txt

Everything goes through the public API, alerts as the camera (service) account,
so the guard screen, review queue, visits and analytics behave as they would
for real reads. Every alert is tagged detector "demo-seed". Creates a guard and
a service account with random passwords, written only to --credentials-out.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

VEHICLES = [
    # plate, make, model, colour, type
    ("KDA101A", "Toyota", "Corolla", "white", "sedan"),
    ("KDB202B", "Toyota", "Land Cruiser", "black", "suv"),
    ("KDC303C", "Subaru", "Forester", "silver", "suv"),
    ("KDD404D", "Mazda", "Demio", "red", "hatchback"),
    ("KDE505E", "Isuzu", "D-Max", "white", "pickup"),
    ("KDF606F", "Nissan", "Note", "blue", "hatchback"),
    ("KDG707G", "Volkswagen", "Golf", "grey", "hatchback"),
    ("KDH808H", "Mercedes-Benz", "C200", "black", "sedan"),
    ("KDJ909J", "Honda", "CR-V", "white", "suv"),
    ("KDK111K", "Toyota", "Hiace", "white", "van"),
]
VISITOR = ("KCZ555Z", "Delivery: Jumia rider")
WATCHED = ("KDH808H", "Plate reported cloned: check the car before opening")

# plate, detected type, detected colour, confidence, plate width px, direction
READS = [
    ("KDA101A", "sedan", "white", 0.97, 210, "entry"),  # clean match
    ("KDB202B", "suv", "black", 0.95, 190, "entry"),  # clean match
    ("KDC303C", "suv", "silver", 0.93, 175, "entry"),  # clean match
    ("KDA101A", "sedan", "white", 0.96, 205, "exit"),  # same car leaves: a visit
    ("KDD404D", "hatchback", "blue", 0.94, 180, "entry"),  # colour mismatch (registered red)
    ("KDE505E", "sedan", "white", 0.92, 185, "entry"),  # type mismatch (registered pickup)
    ("KCX777X", "sedan", "grey", 0.91, 170, "entry"),  # unregistered
    (VISITOR[0], "motorcycle", "red", 0.90, 160, "entry"),  # visitor with a pass
    (WATCHED[0], "sedan", "black", 0.96, 200, "entry"),  # watchlist hit on a registered car
    ("KDF6O6F", "hatchback", "blue", 0.62, 150, "entry"),  # low confidence: review
    ("KDG707G", "hatchback", "grey", 0.95, 70, "entry"),  # plate too small: review
]


class Api:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/") + "/api/v1"
        self.token: str | None = None

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(
            self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response) if response.status != 204 else {}
        except urllib.error.HTTPError as exc:
            raise SystemExit(f"{method} {path} failed: {exc.code} {exc.read().decode()[:300]}") from None

    def login(self, email: str, password: str) -> dict:
        self.token = None
        result = self.call("POST", "/auth/login", {"email": email, "password": password})
        self.token = result["access_token"]
        return result["user"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("base_url")
    parser.add_argument("--credentials-out", required=True)
    args = parser.parse_args()
    out = os.path.expanduser(args.credentials_out)
    if os.path.exists(out):
        raise SystemExit(f"{out} exists; refusing to overwrite it")

    admin = Api(args.base_url)
    admin.login(os.environ["AEGIS_ADMIN_EMAIL"], os.environ["AEGIS_ADMIN_PASSWORD"])
    if admin.call("GET", "/vehicles")["total"]:
        raise SystemExit("This deployment already has vehicles; the demo seed is for an empty one")

    site = admin.call("POST", "/sites", {"name": "Demo Estate: Main Gate", "address": "Sample data"})
    accounts = {
        "guard": ("guard@example.com", "Demo Guard"),
        "service": ("camera@example.com", "Demo Gate Camera"),
    }
    passwords = {}
    for role, (email, name) in accounts.items():
        passwords[role] = secrets.token_urlsafe(18)
        admin.call("POST", "/users", {"email": email, "full_name": name, "password": passwords[role], "role": role})
    # Written before anything else can fail, so the accounts are never orphaned.
    old_umask = os.umask(0o077)
    try:
        with open(out, "w") as f:
            f.write(f"Aegis demo accounts for {args.base_url}\n")
            for role, (email, _) in accounts.items():
                f.write(f"{role}: {email} / {passwords[role]}\n")
    finally:
        os.umask(old_umask)

    for plate, make, model, colour, kind in VEHICLES:
        admin.call("POST", "/vehicles", {"plate_number": plate, "make": make, "model": model, "color": colour,
                                         "vehicle_type": kind, "site_id": site["id"]})
    admin.call("POST", "/watchlist", {"plate_number": WATCHED[0], "reason": WATCHED[1]})
    now = datetime.now(timezone.utc)
    admin.call("POST", "/visitor-passes", {"plate_number": VISITOR[0], "visitor_name": VISITOR[1],
                                           "valid_from": (now - timedelta(minutes=5)).isoformat(),
                                           "valid_until": (now + timedelta(days=1)).isoformat()})

    camera = Api(args.base_url)
    camera.login(accounts["service"][0], passwords["service"])
    for plate, kind, colour, confidence, width, direction in READS:
        alert = camera.call("POST", "/alerts", {
            "plate_number": plate, "detected_type": kind, "detected_color": colour,
            "plate_confidence": confidence, "type_confidence": 0.9, "plate_width_px": width,
            "direction": direction, "site_id": site["id"],
            "detector_name": "demo-seed", "detector_version": "1",
        })
        print(f"{plate:8} {direction:5} -> {alert['mismatch_type']}{' (review)' if alert['requires_review'] else ''}")

    print(f"Seeded {len(VEHICLES)} vehicles and {len(READS)} alerts. Accounts written to {out}")


if __name__ == "__main__":
    main()
