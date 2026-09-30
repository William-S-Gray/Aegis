"""
Measure plate reading on your own labelled images.

    python -m app.evaluate LABELS.csv [--auto-accept 0.85] [--review-floor 0.50]

LABELS.csv has two columns, `file` (path, relative to the CSV) and `plate`
(what a human reads on it). Uses the detector and reader from VISION_* settings,
so run it before and after any model change, on footage from your own cameras.

It reports what matters for operating the gate: of the plates, how many were
auto-accepted (and how many of those were wrong), sent to human review, or
discarded. Wrong-but-auto-accepted is the number to keep near zero.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from app.config import get_settings
from app.main import build_detector
from app.pipeline import Pipeline, normalize_plate
from app.sources import _load_image
from app.types import Frame


def evaluate(pipeline: Pipeline, rows: list[tuple[Path, str]], auto_accept: float, review_floor: float) -> dict:
    counts = dict(plates=0, missed=0, auto_right=0, auto_wrong=0, review=0, discarded=0)
    for path, truth in rows:
        image = _load_image(path)
        if image is None:
            print(f"skip   {path}: not a readable image", file=sys.stderr)
            continue
        counts["plates"] += 1
        observations = pipeline.observe(Frame(image=image, source=str(path)))
        # Score the read of this plate: the matching one if any, else the most
        # confident (a frame can hold other vehicles' plates).
        match = next((o for o in observations if o.plate_text == truth), None)
        best = match or max(observations, key=lambda o: o.plate_confidence, default=None)
        if best is None:
            counts["missed"] += 1
            outcome = "missed"
        elif best.plate_confidence >= auto_accept:
            outcome = "auto_right" if match else "auto_wrong"
        elif best.plate_confidence >= review_floor:
            outcome = "review"
        else:
            outcome = "discarded"
        if outcome != "missed":
            counts[outcome] += 1
        read = best.plate_text if best else "-"
        conf = f"{best.plate_confidence:.2f}" if best else "-"
        print(f"{outcome:10s} {truth:12s} read={read:12s} conf={conf}  {path.name}")
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.evaluate")
    parser.add_argument("labels", type=Path)
    parser.add_argument("--auto-accept", type=float, default=0.85, help="API plate_auto_accept_confidence")
    parser.add_argument("--review-floor", type=float, default=0.50, help="API plate_review_floor_confidence")
    args = parser.parse_args()

    with args.labels.open(newline="", encoding="utf-8-sig") as f:
        rows = [(args.labels.parent / r["file"], normalize_plate(r["plate"])) for r in csv.DictReader(f)]

    detector, reader = build_detector(get_settings())
    c = evaluate(Pipeline(detector, reader), rows, args.auto_accept, args.review_floor)

    n = c["plates"] or 1
    print(
        f"\n{c['plates']} plates: auto-accepted {c['auto_right'] + c['auto_wrong']} "
        f"({(c['auto_right'] + c['auto_wrong']) / n:.0%}; {c['auto_wrong']} of them wrong), "
        f"review {c['review']} ({c['review'] / n:.0%}), discarded {c['discarded']} "
        f"({c['discarded'] / n:.0%}), no plate found {c['missed']} ({c['missed'] / n:.0%})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
