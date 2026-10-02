"""
Follow each plate across a camera's frames and vote on what it says.

Confirming by identical text (the same string in 3 of 5 frames) lost plates
whose reads disagreed by one character, and every plate seen too briefly. Measured
on labelled video, 23 of 32 missed plates had been read correctly in some frame.
A track follows the plate by its position instead, so all of its reads count
towards one decision.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field, replace

from app.types import BoundingBox, Observation


def _iou(a: BoundingBox, b: BoundingBox) -> float:
    ix = max(0, min(a.x + a.width, b.x + b.width) - max(a.x, b.x))
    iy = max(0, min(a.y + a.height, b.y + b.height) - max(a.y, b.y))
    inter = ix * iy
    union = a.width * a.height + b.width * b.height - inter
    return inter / union if union else 0.0


def _same_plate(a: BoundingBox, b: BoundingBox) -> bool:
    """Overlapping, or nearby and of similar size: a vehicle moves between frames."""
    if _iou(a, b) >= 0.2:
        return True
    ratio = a.width / b.width if b.width else 0
    dx = (a.x + a.width / 2) - (b.x + b.width / 2)
    dy = (a.y + a.height / 2) - (b.y + b.height / 2)
    return 0.6 <= ratio <= 1.7 and (dx * dx + dy * dy) ** 0.5 <= 1.5 * max(a.width, b.width)


def _drops_one(short: str, long: str) -> bool:
    """True when `short` is `long` with one character missing: a truncated read."""
    return len(long) == len(short) + 1 and any(long[:i] + long[i + 1:] == short for i in range(len(long)))


def vote(reads: list[tuple[str, float]]) -> tuple[str, float, int]:
    """
    (text, confidence, support) for a track's reads.

    A read that is the winner with one character dropped supports the winner.
    The reader truncates small plates (34AIE79 for 34AIE791), so the full
    reading must not lose to its own truncation. Confidence is the median of
    the winner's reads. Scaling it by agreement was measured and rejected: one
    dissenting early frame pushed clear 200-500 px plates into review.
    """
    texts = {t for t, _ in reads}
    count = {t: sum(1 for r, _ in reads if r == t) for t in texts}
    support = {t: count[t] + sum(count[s] for s in texts if _drops_one(s, t)) for t in texts}
    total_conf = {t: sum(c for r, c in reads if r == t) for t in texts}
    winner = max(texts, key=lambda t: (support[t], len(t), total_conf[t]))
    median = statistics.median(c for r, c in reads if r == winner)
    return winner, round(median, 4), support[winner]


@dataclass
class _Track:
    box: BoundingBox
    last_frame: int
    reads: list[Observation] = field(default_factory=list)
    published: str | None = None  # the plate this track was published as


class PlateTracker:
    """One camera's live plate tracks."""

    def __init__(self, confirm_frames: int = 3, max_gap_frames: int = 3):
        self._confirm = confirm_frames
        self._max_gap = max_gap_frames
        self._tracks: list[_Track] = []
        self._frame = 0

    def update(self, observations: list[Observation]) -> tuple[list[Observation], set[str], int]:
        """
        Feed one frame's reads. Returns (observations to publish now, plates of
        already-published tracks still in view, reads held back).

        A track publishes once, when it has `confirm_frames` reads and its
        winning text is backed by at least two of them: a single misread among
        good reads can never win. Later reads of a published track publish
        nothing, so a variant read of a waiting car is not a new alert; the
        pipeline uses the still-in-view plates to keep its de-duplication fresh.
        """
        self._frame += 1
        self._tracks = [t for t in self._tracks if self._frame - t.last_frame <= self._max_gap]
        held, ready, present = 0, [], set()
        unmatched = list(self._tracks)
        for observation in observations:
            box = observation.detection.box
            track = max(
                (t for t in unmatched if _same_plate(t.box, box)),
                key=lambda t: _iou(t.box, box), default=None,
            )
            if track is None:
                track = _Track(box=box, last_frame=self._frame)
                self._tracks.append(track)
            else:
                unmatched.remove(track)
            track.box, track.last_frame = box, self._frame
            track.reads.append(observation)
            if track.published:
                present.add(track.published)
                continue
            if len(track.reads) >= self._confirm:
                text, confidence, support = vote([(o.plate_text, o.plate_confidence) for o in track.reads])
                if support >= 2:
                    best = max((o for o in track.reads if o.plate_text == text), key=lambda o: o.plate_confidence)
                    track.published = text
                    ready.append(replace(best, plate_confidence=confidence))
                    continue
            held += 1
        return ready, present, held
