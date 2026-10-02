from app.tracking import PlateTracker, vote
from app.types import BoundingBox, Frame, Observation, PlateDetection


def obs(text, x=100, width=200, confidence=0.95):
    detection = PlateDetection(box=BoundingBox(x, 300, width, 50), confidence=0.9)
    return Observation(text, confidence, detection, Frame(image=b"", source="cam"), "d", "1")


class TestVote:
    def test_a_truncated_read_supports_the_full_plate(self):
        """Video: the reader gave 34AIE79 as often as 34AIE791, at higher confidence."""
        reads = [("34AIE79", 1.0)] * 5 + [("34AIE791", 0.86)] * 5

        text, confidence, support = vote(reads)

        assert (text, support) == ("34AIE791", 10)
        assert confidence == 0.86  # the full reading's own confidence

    def test_the_majority_wins_over_single_misreads(self):
        """Video: an out-of-focus MCC699 was misread as WCC699 in some frames."""
        text, _, support = vote([("MCC699", 1.0), ("WCC699", 0.95), ("MCC699", 1.0)])

        assert (text, support) == ("MCC699", 2)


class TestPlateTracker:
    def test_a_moving_plate_is_one_track(self):
        tracker = PlateTracker(confirm_frames=3)
        published = []
        for x in (100, 160, 220):  # the car moves between frames
            ready, _, _ = tracker.update([obs("AB12CD", x=x)])
            published += ready

        assert [o.plate_text for o in published] == ["AB12CD"]

    def test_two_plates_in_one_frame_are_tracked_separately(self):
        tracker = PlateTracker(confirm_frames=3)
        published = []
        for _ in range(3):
            ready, _, _ = tracker.update([obs("AB12CD", x=100), obs("XY99ZZ", x=900)])
            published += ready

        assert sorted(o.plate_text for o in published) == ["AB12CD", "XY99ZZ"]

    def test_a_variant_read_after_publishing_is_not_a_new_alert(self):
        tracker = PlateTracker(confirm_frames=3)
        for _ in range(3):
            tracker.update([obs("AB12CD")])

        ready, present, _ = tracker.update([obs("AB12C")])

        assert ready == []
        assert present == {"AB12CD"}

    def test_one_misread_among_three_reads_cannot_win(self):
        tracker = PlateTracker(confirm_frames=3)
        published = []
        for text in ("AB12CD", "ZZ99ZZ", "QQ11QQ"):
            published += tracker.update([obs(text)])[0]

        assert published == []  # no reading is backed by two frames yet
