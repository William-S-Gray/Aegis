import os

# ONNX Runtime ships Microsoft telemetry that is on by default on Linux: it
# writes a hardware device id and reports session and run events to
# mobile.events.data.microsoft.com. Its own disable_telemetry_events() does
# not stop that; this variable does, and must be set before it is imported.
# A camera host has no business reporting to a third party.
os.environ.setdefault("ORT_DISABLE_TELEMETRY", "1")
