"""
Make a demo deployment look lived-in, and bring the gate screen to life.

    python -m tools.demo_activity wake     https://aegis-eight-snowy.vercel.app
    python -m tools.demo_activity history  https://aegis-eight-snowy.vercel.app --accounts ~/aegis-demo-accounts.txt
    python -m tools.demo_activity arrivals https://aegis-eight-snowy.vercel.app --accounts ~/aegis-demo-accounts.txt

wake      Wakes a free-plan server that slept (about a minute); run it a few
          minutes before presenting.
history   A shift's worth of activity on the seeded alerts (tools.seed_demo):
          the guard's decisions, verdicts, notes and an assignment, and a
          resident's visitor pass. Reads awaiting plate review are left for
          the demo. Run once; refuses if decisions exist.
arrivals  Cars arriving at the gate while you present, one every --every
          seconds, covering every verdict. Ctrl+C stops it.

Everything goes through the public API as the demo accounts (the file
tools.seed_demo writes, plus a "user (resident):" line), tagged detector
"demo-seed", so it is sample data exactly like the seed.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

# What a careful guard does with each kind of read: (decision, verdict, note).
# Verdict None leaves a clean read without one: it was never an alarm.
HANDLING = {
    "none": ("approve", None, None),
    "visitor": ("approve", None, "Visitor matched the pass; let in."),
    "color": ("approve", "false_alarm", "Checked the car: resprayed, owner confirmed. Register needs updating."),
    "type": ("approve", "false_alarm", "Same car; the camera took the pickup's canopy for a saloon."),
    "unregistered": ("deny", "investigated", "Not expected by any resident. Driver turned around."),
    "watchlist": ("deny", "escalated", "Plate on the watchlist. Barrier kept down, supervisor and police called."),
}

# A car per verdict, in an order that tells a story at the gate.
ARRIVALS = [
    ("KDB202B", "suv", "black", 0.96, "a resident, matching the register"),
    ("KCZ555Z", "motorcycle", "red", 0.93, "a delivery rider with a visitor pass"),
    ("KDD404D", "hatchback", "blue", 0.94, "a registered plate on a car of the wrong colour"),
    ("KCY318K", "sedan", "white", 0.92, "a plate nobody registered"),
    ("KDH808H", "sedan", "black", 0.97, "a plate on the watchlist"),
    ("KDJ909J", "suv", "white", 0.95, "another resident"),
]


class Api:
    def __init__(self, base: str) -> None:
        self.root = base.rstrip("/")
        self.base = self.root + "/api/v1"
        self.token: str | None = None

    def call(self, method: str, path: str, body: dict | None = None) -> dict | list:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response) if response.status != 204 else {}
        except urllib.error.HTTPError as exc:
            raise SystemExit(f"{method} {path} failed: {exc.code} {exc.read().decode()[:300]}") from None

    def login(self, email: str, password: str) -> dict:
        self.token = None
        result = self.call("POST", "/auth/login", {"email": email, "password": password})
        self.token = result["access_token"]
        return result["user"]


def read_accounts(path: str) -> dict[str, tuple[str, str]]:
    """{'guard': (email, password), ...} from 'role: email / password' lines."""
    accounts = {}
    with open(os.path.expanduser(path)) as f:
        for line in f:
            if ":" not in line or " / " not in line:
                continue
            role, rest = line.split(":", 1)
            email, password = rest.strip().split(" / ", 1)
            accounts[role.split()[0]] = (email, password)
    return accounts


def signed_in(base: str, accounts: dict, role: str) -> Api:
    if role not in accounts:
        raise SystemExit(f"No {role!r} account in the accounts file")
    api = Api(base)
    api.login(*accounts[role])
    return api


def wake(base: str) -> None:
    started = time.monotonic()
    for _ in range(30):
        try:
            with urllib.request.urlopen(Api(base).root + "/api/v1/sites", timeout=90) as response:
                response.read()
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):  # awake: it answered, and wants a sign-in
                print(f"Awake after {time.monotonic() - started:.0f} s")
                return
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(5)
    raise SystemExit("Still not answering after several minutes")


def history(base: str, accounts: dict) -> None:
    guard = signed_in(base, accounts, "guard")
    if guard.call("GET", "/logs")["total"]:
        raise SystemExit("This deployment already has gate decisions; history is for a freshly seeded demo")
    me = guard.call("GET", "/auth/me")
    alerts = guard.call("GET", "/alerts?limit=100")["alerts"]
    # Reads waiting for plate review stay open, to show the review step live.
    handled = [a for a in alerts if not a.get("requires_review")]
    for alert in sorted(handled, key=lambda a: a["timestamp"]):
        decision, verdict, note = HANDLING.get(alert["mismatch_type"], ("approve", None, None))
        guard.call("POST", "/access-logs", {
            "plate_number": alert["plate_number"],
            "action": decision,
            "client_ref": str(uuid.uuid4()),
            "details": {"alert_id": alert["id"]},
        })
        if note:
            guard.call("POST", f"/alerts/{alert['id']}/comment", {"comment": note})
        if alert["mismatch_type"] == "watchlist":
            guard.call("POST", f"/alerts/{alert['id']}/assign", {"user_id": me["id"]})
        # Escalations stay open: someone is still following them up.
        status = "in_progress" if verdict == "escalated" else "closed"
        body = {"status": status, **({"feedback_status": verdict} if verdict else {})}
        guard.call("POST", f"/alerts/{alert['id']}/status", body)
        print(f"{alert['plate_number']:9} {alert['mismatch_type']:13} -> {decision:8} {verdict or ''}")

    if "user" in accounts:
        resident = signed_in(base, accounts, "user")
        start = datetime.now(timezone.utc) + timedelta(hours=2)
        resident.call("POST", "/visitor-passes", {
            "plate_number": "KCA444A",
            "visitor_name": "Plumber (Mwangi & Sons)",
            "valid_from": start.isoformat(),
            "valid_until": (start + timedelta(hours=4)).isoformat(),
            "notes": "Kitchen sink. Please send to house 12.",
        })
        print("Resident added a visitor pass for later today")
    print(f"Done: {len(handled)} alerts handled; {len(alerts) - len(handled)} left for plate review")


def arrivals(base: str, accounts: dict, every: float, count: int) -> None:
    camera = signed_in(base, accounts, "service")
    sent = 0
    try:
        while count <= 0 or sent < count:
            plate, kind, colour, confidence, story = ARRIVALS[sent % len(ARRIVALS)]
            alert = camera.call("POST", "/alerts", {
                "plate_number": plate, "detected_type": kind, "detected_color": colour,
                "plate_confidence": confidence, "type_confidence": 0.9, "plate_width_px": 190,
                "direction": "entry", "detector_name": "demo-seed", "detector_version": "1",
            })
            sent += 1
            print(f"{datetime.now():%H:%M:%S} {plate:9} {alert['mismatch_type']:13} ({story})")
            if count <= 0 or sent < count:
                time.sleep(every)
    except KeyboardInterrupt:
        pass
    print(f"Sent {sent} arrivals")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["wake", "history", "arrivals"])
    parser.add_argument("base_url")
    parser.add_argument("--accounts", default="~/aegis-demo-accounts.txt")
    parser.add_argument("--every", type=float, default=20, help="arrivals: seconds between cars")
    parser.add_argument("--count", type=int, default=len(ARRIVALS), help="arrivals: how many (0 = until Ctrl+C)")
    args = parser.parse_args()
    if args.command == "wake":
        wake(args.base_url)
    elif args.command == "history":
        history(args.base_url, read_accounts(args.accounts))
    else:
        arrivals(args.base_url, read_accounts(args.accounts), args.every, args.count)


if __name__ == "__main__":
    main()
