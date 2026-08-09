from __future__ import annotations

import pytest

from app.detectors.stub import StubPlateDetector, StubPlateReader
from app.pipeline import MIN_PLATE_LENGTH, Pipeline, normalize_plate
from app.types import BoundingBox, Frame, PlateDetection, PlateReading


class FakeClient:
    """Records what the pipeline tried to publish."""

    def __init__(self, response: dict | None = None, reject: bool = False):
        self.calls: list[dict] = []
        self._response = response or {}
        self._reject = reject

    def create_alert(self, payload: dict) -> dict | None:
        self.calls.append(payload)
        if self._reject:
            return None
        return {"id": "alert-1", "requires_review": False, **self._response}


class FixedDetector:
    name = "fixed"
    version = "1.0"

    def __init__(self, *detections: PlateDetection):
        self._detections = list(detections)

    def detect(self, frame: Frame) -> list[PlateDetection]:
        return self._detections


class FixedReader:
    name = "fixed-ocr"
    version = "1.0"

    def __init__(self, text: str | None, confidence: float = 1.0):
        self._text = text
        self._confidence = confidence

    def read(self, image):
        if self._text is None:
            return None
        return PlateReading(text=self._text, confidence=self._confidence)


def frame(source: str = "cam-1") -> Frame:
    return Frame(image=b"fake-bytes", source=source)


def detection(confidence: float = 0.9, **kwargs) -> PlateDetection:
    return PlateDetection(
        box=BoundingBox(0, 0, 10, 10), confidence=confidence, **kwargs
    )


class TestNormalizePlate:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("ab-12 cd", "AB12CD"),
            ("  xy99zz  ", "XY99ZZ"),
            ("A.B/1*2", "AB12"),
            ("", ""),
        ],
    )
    def test_matches_the_api_canonical_form(self, raw, expected):
        assert normalize_plate(raw) == expected


class TestObserve:
    def test_combines_detection_and_reading_confidence(self):
        pipeline = Pipeline(FixedDetector(detection(0.9)), FixedReader("AB12CD", 0.8))

        observation = pipeline.observe(frame())[0]

        # A crisp box around unreadable characters is not a good read, so the
        # two confidences multiply rather than either standing alone.
        assert observation.plate_confidence == pytest.approx(0.72)

    def test_unreadable_crop_is_counted_not_published(self):
        pipeline = Pipeline(FixedDetector(detection()), FixedReader(None))

        assert pipeline.observe(frame()) == []
        assert pipeline.stats.unreadable == 1
        assert pipeline.stats.detections == 1

    def test_too_short_to_be_a_plate_is_discarded(self):
        pipeline = Pipeline(FixedDetector(detection()), FixedReader("AB"))

        assert pipeline.observe(frame()) == []
        assert pipeline.stats.unreadable == 1

    def test_plate_at_the_minimum_length_is_kept(self):
        text = "A" * MIN_PLATE_LENGTH
        pipeline = Pipeline(FixedDetector(detection()), FixedReader(text))

        assert pipeline.observe(frame())[0].plate_text == text

    def test_reading_is_normalised(self):
        pipeline = Pipeline(FixedDetector(detection()), FixedReader("ab-12 cd"))
        assert pipeline.observe(frame())[0].plate_text == "AB12CD"

    def test_detector_provenance_is_carried(self):
        pipeline = Pipeline(FixedDetector(detection()), FixedReader("AB12CD"))
        observation = pipeline.observe(frame())[0]

        assert observation.detector_name == "fixed"
        assert observation.detector_version == "1.0"


class TestGating:
    def test_low_confidence_is_not_published(self):
        client = FakeClient()
        pipeline = Pipeline(
            FixedDetector(detection(0.4)),
            FixedReader("AB12CD", 1.0),
            client,
            min_publish_confidence=0.5,
        )

        assert pipeline.process(frame()) == []
        assert client.calls == []
        assert pipeline.stats.below_floor == 1

    def test_confident_read_is_published(self):
        client = FakeClient()
        pipeline = Pipeline(
            FixedDetector(detection(0.95)), FixedReader("AB12CD", 1.0), client
        )

        published = pipeline.process(frame())

        assert len(published) == 1
        assert client.calls[0]["plate_number"] == "AB12CD"
        assert pipeline.stats.published == 1

    def test_api_rejection_is_recorded(self):
        client = FakeClient(reject=True)
        pipeline = Pipeline(
            FixedDetector(detection(0.95)), FixedReader("AB12CD", 1.0), client
        )

        assert pipeline.process(frame()) == []
        assert pipeline.stats.rejected_by_api == 1
        assert pipeline.stats.published == 0

    def test_payload_matches_the_api_contract(self):
        client = FakeClient()
        pipeline = Pipeline(
            FixedDetector(
                detection(
                    0.95,
                    vehicle_type="sedan",
                    vehicle_type_confidence=0.8,
                    vehicle_color="white",
                )
            ),
            FixedReader("AB12CD", 1.0),
            client,
            site_id="site-1",
        )

        pipeline.process(frame())

        assert client.calls[0] == {
            "plate_number": "AB12CD",
            "detected_type": "sedan",
            "detected_color": "white",
            "plate_confidence": pytest.approx(0.95),
            "type_confidence": 0.8,
            "site_id": "site-1",
            "detector_name": "fixed",
            "detector_version": "1.0",
        }


class TestDeduplication:
    def test_same_plate_in_quick_succession_is_published_once(self):
        """A car waiting at a barrier appears in every frame."""
        client = FakeClient()
        now = [1000.0]
        pipeline = Pipeline(
            FixedDetector(detection(0.95)),
            FixedReader("AB12CD", 1.0),
            client,
            dedupe_window_seconds=30,
            clock=lambda: now[0],
        )

        for _ in range(5):
            pipeline.process(frame())
            now[0] += 1

        assert len(client.calls) == 1
        assert pipeline.stats.deduped == 4

    def test_same_plate_after_the_window_is_a_new_event(self):
        client = FakeClient()
        now = [1000.0]
        pipeline = Pipeline(
            FixedDetector(detection(0.95)),
            FixedReader("AB12CD", 1.0),
            client,
            dedupe_window_seconds=30,
            clock=lambda: now[0],
        )

        pipeline.process(frame())
        now[0] += 31
        pipeline.process(frame())

        assert len(client.calls) == 2

    def test_different_plates_are_independent(self):
        client = FakeClient()
        pipeline = Pipeline(
            FixedDetector(detection(0.95)), FixedReader("AB12CD", 1.0), client
        )
        pipeline.process(frame())

        pipeline._reader = FixedReader("XY99ZZ", 1.0)
        pipeline.process(frame())

        assert [c["plate_number"] for c in client.calls] == ["AB12CD", "XY99ZZ"]


class TestStubDetector:
    def test_output_is_deterministic_per_source(self):
        detector = StubPlateDetector()
        first = detector.detect(frame("cam-a"))[0]
        second = detector.detect(frame("cam-a"))[0]

        assert first.confidence == second.confidence
        assert first.vehicle_type == second.vehicle_type

    def test_different_sources_differ(self):
        detector = StubPlateDetector()
        plates = {detector.plate_for(frame(f"cam-{i}")) for i in range(12)}
        assert len(plates) > 1

    def test_pairs_with_the_stub_reader(self):
        detector = StubPlateDetector(confidence=0.95)
        pipeline = Pipeline(detector, StubPlateReader(detector), FakeClient())

        published = pipeline.process(frame("cam-a"))

        assert len(published) == 1
        assert pipeline.stats.published == 1


class TestStats:
    def test_counters_describe_the_whole_run(self):
        client = FakeClient()
        pipeline = Pipeline(
            FixedDetector(detection(0.95)), FixedReader("AB12CD", 1.0), client
        )
        pipeline.process(frame())

        stats = pipeline.stats.as_dict()
        assert stats["frames"] == 1
        assert stats["detections"] == 1
        assert stats["published"] == 1
        assert stats["deduped"] == 0
