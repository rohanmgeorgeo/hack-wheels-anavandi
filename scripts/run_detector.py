#!/usr/bin/env python3
"""Run the RoadPulse explainable detector on the demo subset and write outputs.

Reads the tracked demo source CSVs from ``data/demo/source`` and writes:

* ``data/demo/processed/events.json`` -- accepted events + suppressed candidates.
* ``data/demo/processed/detector_summary.json`` -- thresholds, counts, validation.

Run from the repository root:

    python3 scripts/run_detector.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from processor import load_session  # noqa: E402
from processor.detector import detect_sessions  # noqa: E402

SOURCE_DIR = REPO_ROOT / "data" / "demo" / "source"
PROCESSED_DIR = REPO_ROOT / "data" / "demo" / "processed"

DEMO_SESSIONS = (
    ("2", "session-2.csv"),
    ("4", "session-4.csv"),
    ("35", "session-35.csv"),
    ("9", "session-9-normal.csv"),
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


def main() -> int:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    sessions = load_demo_sessions()
    result = detect_sessions(sessions)

    events = {
        "dataset": "RoadSens-4M",
        "subset": "roadpulse-demo",
        "detector": "processor/detector.py",
        "events": [event.to_dict() for event in result.accepted]
        + [event.to_dict() for event in result.roughness],
        "suppressed_candidates": [candidate.to_dict() for candidate in result.suppressed],
    }
    events_path = PROCESSED_DIR / "events.json"
    events_path.write_text(json.dumps(events, indent=2) + "\n", encoding="utf-8")

    summary_path = PROCESSED_DIR / "detector_summary.json"
    summary_path.write_text(json.dumps(result.summary, indent=2) + "\n", encoding="utf-8")

    counts = result.summary["counts"]
    validation = result.summary["validation"]
    print(f"Wrote {len(events['events'])} accepted events -> {events_path.relative_to(REPO_ROOT)}")
    print(
        f"Wrote summary -> {summary_path.relative_to(REPO_ROOT)}\n"
    )
    print("Accepted by class:")
    for label, count in counts["accepted_by_class"].items():
        print(f"  {label:20} {count}")
    print("Suppressed by reason:")
    for reason, count in counts["suppressed_by_reason"].items():
        print(f"  {reason:20} {count}")
    print("Validation:")
    print(
        f"  pothole/bump agree={validation['predictions_agreeing_with_supplied_labels']} "
        f"disagree={validation['predictions_disagreeing_with_supplied_labels']} "
        f"loo_accuracy={validation['leave_one_out_accuracy']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())