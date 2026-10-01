"""
The ONNX detector and reader adapters, with the models faked out.

The models themselves are measured, not unit-tested: see `python -m app.evaluate`.
"""

from types import SimpleNamespace

from app.detectors.plate_onnx import OnnxPlateDetector, _providers
from app.ocr.fast_plate import FastPlateReader
from app.types import BoundingBox, Frame


def reader_with(prediction=None, error=None) -> FastPlateReader:
    def run_one(image, return_confidence):
        if error:
            raise error
        return prediction

    reader = FastPlateReader.__new__(FastPlateReader)
    reader._cv2 = SimpleNamespace(cvtColor=lambda image, code: image)
    reader._color = None
    reader._ocr = SimpleNamespace(run_one=run_one)
    return reader


def prediction(plate: str, probs: list[float]):
    # Stands in for the model's numpy array of per-slot probabilities.
    return SimpleNamespace(plate=plate, char_probs=SimpleNamespace(ravel=lambda: probs))


CROP = SimpleNamespace(size=20 * 60 * 3)


class TestFastPlateReader:
    def test_confidence_is_the_weakest_character(self):
        # One wrong character makes the plate wrong; an average would hide it.
        reading = reader_with(prediction("AB12CD", [1.0, 1.0, 0.4, 1.0, 1.0, 1.0])).read(CROP)

        assert reading.text == "AB12CD"
        assert reading.confidence == 0.4

    def test_padding_positions_do_not_count(self):
        # The model scores fixed-length slots; trailing pad slots are not characters.
        reading = reader_with(prediction("AB12", [0.99, 0.98, 0.97, 0.96, 0.1, 0.1])).read(CROP)

        assert reading.confidence == 0.96

    def test_nothing_read_is_no_reading(self):
        assert reader_with(prediction("", [])).read(CROP) is None

    def test_empty_crop_is_no_reading(self):
        assert reader_with(prediction("AB12", [1.0] * 4)).read(SimpleNamespace(size=0)) is None

    def test_model_failure_is_no_reading(self):
        assert reader_with(error=RuntimeError("onnx")).read(CROP) is None


def detector_with(results=None, error=None) -> OnnxPlateDetector:
    def predict(image):
        if error:
            raise error
        return results

    detector = OnnxPlateDetector.__new__(OnnxPlateDetector)
    detector._model = SimpleNamespace(predict=predict)
    return detector


def result(x1, y1, x2, y2, confidence):
    return SimpleNamespace(
        bounding_box=SimpleNamespace(x1=x1, y1=y1, x2=x2, y2=y2), confidence=confidence
    )


class TestOnnxPlateDetector:
    def test_corners_become_a_clamped_box(self):
        # Boxes can extend past the frame edge; a negative origin would make
        # the crop slice wrap around to the far side of the image.
        [detection] = detector_with([result(-5, 10, 95, 40, 0.9)]).detect(Frame(image=CROP, source="t"))

        assert (detection.box.x, detection.box.y) == (0, 10)
        assert (detection.box.width, detection.box.height) == (100, 30)
        assert detection.confidence == 0.9

    def test_model_failure_drops_the_frame(self):
        assert detector_with(error=RuntimeError("onnx")).detect(Frame(image=CROP, source="t")) == []

    def test_device_selects_providers(self):
        assert _providers(None) is None
        assert _providers("cuda:0")[0] == "CUDAExecutionProvider"
        assert _providers("cpu") == ["CPUExecutionProvider"]


class TestOwningVehicle:
    """Boxes from real photos in the measurement set."""

    def test_a_car_on_a_transporter_is_not_the_cab(self):
        from app.detectors.vehicle_onnx import owning_vehicle

        plate = BoundingBox(612, 282, 100, 29)  # the loaded car's plate
        vehicles = [("truck", 0.89, (408, 102, 1172, 901)), ("car", 0.71, (534, 149, 883, 354))]

        assert owning_vehicle(plate, vehicles) == ("car", 0.71)

    def test_the_cab_owns_its_own_bumper_plate(self):
        from app.detectors.vehicle_onnx import owning_vehicle

        plate = BoundingBox(640, 840, 90, 25)
        vehicles = [("truck", 0.89, (408, 102, 1172, 901)), ("car", 0.71, (534, 149, 883, 354))]

        assert owning_vehicle(plate, vehicles) == ("truck", 0.89)

    def test_no_vehicle_around_the_plate(self):
        from app.detectors.vehicle_onnx import owning_vehicle

        assert owning_vehicle(BoundingBox(0, 0, 10, 5), [("car", 0.9, (500, 500, 900, 800))]) is None


def test_onnx_runtime_telemetry_is_off():
    """ORT reports to Microsoft by default; only this variable stops it."""
    import os

    import app  # noqa: F401 - setting it is the package's import side effect

    assert os.environ["ORT_DISABLE_TELEMETRY"] == "1"
