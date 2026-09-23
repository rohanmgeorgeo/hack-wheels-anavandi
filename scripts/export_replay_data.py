#!/usr/bin/env python3
"""Export a compact chronological replay dataset for the RoadPulse dashboard.

The "Journey Replay" view plays back a *recorded* RoadSens-4M session. It does
not re-run the detector in the browser and it does not simulate live sensing.
Instead this script reuses the existing pipeline:

* :mod:`processor.loader` to load the tracked demo sessions;
* :func:`processor.detector.detect_sessions` to obtain the **exact** accepted and
  suppressed decisions that are already published in ``events.json``;
* :func:`processor.detector.build_series` (which itself uses
  :func:`processor.features.derive_features`) to obtain the real per-sample
  feature values and rolling bands.

Nothing is invented: sensor values, GPS coordinates and decisions are copied
from the prepared data. Events without GPS stay without GPS.

Output: ``data/demo/processed/replay_sessions.json``.

Run from the repository root:

    python3 scripts/export_replay_data.py
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from processor import load_session  # noqa: E402
from processor.detector import DetectorConfig, build_series, detect_sessions  # noqa: E402

SOURCE_DIR = REPO_ROOT / "data" / "demo" / "source"
PROCESSED_DIR = REPO_ROOT / "data" / "demo" / "processed"

# All sessions are needed so the detector reproduces the same reference baseline
# (session 9 is the normal-road reference) and therefore the same decisions.
DEMO_SESSIONS = (
    ("2", "session-2.csv"),
    ("4", "session-4.csv"),
    ("35", "session-35.csv"),
    ("9", "session-9-normal.csv"),
)

# Only anomaly sessions are offered for replay (normal road has no GPS and no
# accepted events). Session 4 is the richest and is listed first.
ANOMALY_SESSIONS = (
    ("4", "session-4.csv"),
    ("2", "session-2.csv"),
    ("35", "session-35.csv"),
)

SAMPLE_FIELDS = (
    "t",
    "vertical_acceleration",
    "horizontal_acceleration",
    "yaw_rate",
    "gyroscope_magnitude",
    "rolling_rms",
    "latitude",
    "longitude",
)


def load_demo_sessions() -> list:
    sessions = []
    for session_id, name in DEMO_SESSIONS:
        path = SOURCE_DIR / name
        if not path.exists():
            raise FileNotFoundError(
                f"Missing demo source {path}. Run scripts/prepare_demo_data.py first."
            )
        sessions.append(load_session(path, session_id=session_id))
    return sessions


def _round(value, digits: int = 6):
    if value is None:
        return None
    return round(float(value), digits)


def _samples_for(session, series) -> list:
    """Real per-sample features + GPS, straight from the existing pipeline."""

    samples = []
    for index, t in enumerate(series.times):
        row = series.rows[index]
        samples.append(
            {
                "t": _round(t),
                "vertical_acceleration": _round(series.vertical[index]),
                "horizontal_acceleration": _round(series.horizontal[index]),
                "yaw_rate": _round(series.yaw[index]),
                "gyroscope_magnitude": _round(series.gyro_magnitude[index]),
                "rolling_rms": _round(series.roughness[index]),
                "latitude": _round(row.location_latitude),
                "longitude": _round(row.location_longitude),
            }
        )
    return samples


def _decision(record: dict, kind: str) -> dict:
    """Normalise one real detector record into a replay decision."""

    gps = record.get("gps") or {}
    t = record.get("peak_time")
    if t is None:
        t = record.get("start_time")
    return {
        "t": _round(t),
        "decision": kind,
        "event_type": record.get("class") if kind == "accepted" else None,
        "suppression_reason": record.get("suppression_reason"),
        "severity": _round(record.get("severity_score", 0.0), 2),
        "confidence": _round(record.get("confidence_score", 0.0), 2),
        "latitude": _round(gps.get("latitude")),
        "longitude": _round(gps.get("longitude")),
        "provenance": record.get("provenance"),
        "start_time": record.get("start_time"),
        "end_time": record.get("end_time"),
        "peak_time": record.get("peak_time"),
        "start_row": record.get("start_row"),
        "end_row": record.get("end_row"),
        "peak_row": record.get("peak_row"),
        "evidence": record.get("evidence"),
        "truth_label": record.get("truth_label"),
    }


def build_replay(sessions, result) -> dict:
    """Build the replay payload from loaded sessions and detector output."""

    config = DetectorConfig()
    by_id = {session.session_id: session for session in sessions}

    accepted = defaultdict(list)
    suppressed = defaultdict(list)
    roughness = defaultdict(list)
    for event in result.accepted:
        accepted[event.session_id].append(event)
    for candidate in result.suppressed:
        suppressed[candidate.session_id].append(candidate)
    for event in result.roughness:
        roughness[event.session_id].append(event)

    replay_sessions = []
    for session_id, _name in ANOMALY_SESSIONS:
        session = by_id[session_id]
        series = build_series(session, config)
        samples = _samples_for(session, series)

        decisions = []
        for event in accepted[session_id]:
            decisions.append(_decision(event.to_dict(), "accepted"))
        for event in roughness[session_id]:
            decisions.append(_decision(event.to_dict(), "accepted"))
        for candidate in suppressed[session_id]:
            decisions.append(_decision(candidate.to_dict(), "suppressed"))
        decisions.sort(key=lambda item: item["t"])

        replay_sessions.append(
            {
                "session_id": session_id,
                "schema": session.schema,
                "row_count": session.row_count,
                "duration_seconds": _round(samples[-1]["t"]) if samples else 0.0,
                "sampling_hz": config.sampling_hz,
                "sample_fields": list(SAMPLE_FIELDS),
                "samples": samples,
                "decisions": decisions,
            }
        )

    return {
        "dataset": "RoadSens-4M",
        "subset": "roadpulse-demo",
        "detector": "processor/detector.py",
        "generated_by": "scripts/export_replay_data.py",
        "note": (
            "Recorded session replay. Samples and decisions are copied from the "
            "prepared RoadSens-4M demo data and the existing detector output; "
            "no values are simulated."
        ),
        "sessions": replay_sessions,
    }


def main() -> int:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    sessions = load_demo_sessions()
    result = detect_sessions(sessions)
    payload = build_replay(sessions, result)

    path = PROCESSED_DIR / "replay_sessions.json"
    path.write_text(
        json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote replay dataset -> {path.relative_to(REPO_ROOT)}")
    for session in payload["sessions"]:
        accepted = sum(1 for d in session["decisions"] if d["decision"] == "accepted")
        suppressed = sum(
            1 for d in session["decisions"] if d["decision"] == "suppressed"
        )
        print(
            f"  session {session['session_id']}: "
            f"{len(session['samples'])} samples, "
            f"{accepted} accepted, {suppressed} suppressed, "
            f"{session['duration_seconds']}s"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
