"""Integrity checks for the RoadPulse Journey Replay export.

These tests assert that the replay dataset is a faithful, deterministic copy of
the existing pipeline output: samples come from ``derive_features`` /
``build_series`` and decisions come from the real detector run. No fabricated
data is allowed through.

Run from the repository root:

    python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = REPO_ROOT / "data" / "demo" / "source"
PROCESSED_DIR = REPO_ROOT / "data" / "demo" / "processed"
REPLAY_PATH = PROCESSED_DIR / "replay_sessions.json"

sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from processor import load_session  # noqa: E402
from processor.detector import DetectorConfig, build_series, detect_sessions  # noqa: E402
from processor.features import derive_features  # noqa: E402
from export_replay_data import ANOMALY_SESSIONS, DEMO_SESSIONS, build_replay  # noqa: E402

SAMPLE_KEYS = (
    "t",
    "vertical_acceleration",
    "horizontal_acceleration",
    "yaw_rate",
    "gyroscope_magnitude",
    "rolling_rms",
)


def setUpModule() -> None:
    if not (SOURCE_DIR / "session-2.csv").exists():
        subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "prepare_demo_data.py")],
            cwd=str(REPO_ROOT),
            check=True,
        )


class ReplayExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sessions = [
            load_session(SOURCE_DIR / name, session_id=session_id)
            for session_id, name in DEMO_SESSIONS
        ]
        cls.result = detect_sessions(cls.sessions)
        cls.replay = json.loads(REPLAY_PATH.read_text())
        cls.by_id = {item["session_id"]: item for item in cls.replay["sessions"]}

    def test_replay_file_present_with_expected_sessions(self) -> None:
        self.assertTrue(REPLAY_PATH.exists())
        self.assertEqual(self.replay["dataset"], "RoadSens-4M")
        self.assertEqual(
            set(self.by_id), {session_id for session_id, _ in ANOMALY_SESSIONS}
        )
        for session in self.by_id.values():
            self.assertGreater(len(session["samples"]), 0)
            self.assertGreater(len(session["decisions"]), 0)

    def test_samples_are_chronological_and_finite(self) -> None:
        for session in self.by_id.values():
            times = [sample["t"] for sample in session["samples"]]
            self.assertEqual(times, sorted(times), session["session_id"])
            for sample in session["samples"]:
                for key in SAMPLE_KEYS:
                    self.assertTrue(
                        math.isfinite(sample[key]),
                        f"{session['session_id']}:{key}",
                    )
                for key in ("latitude", "longitude"):
                    if sample[key] is not None:
                        self.assertTrue(math.isfinite(sample[key]))

    def test_decisions_are_chronological(self) -> None:
        for session in self.by_id.values():
            times = [decision["t"] for decision in session["decisions"]]
            self.assertEqual(times, sorted(times), session["session_id"])

    def test_decisions_match_real_detector_output(self) -> None:
        accepted = {
            (event.session_id, event.start_row, event.event_class): event
            for event in list(self.result.accepted) + list(self.result.roughness)
        }
        suppressed = {
            (candidate.session_id, candidate.start_row): candidate
            for candidate in self.result.suppressed
        }

        for session in self.by_id.values():
            session_id = session["session_id"]
            for decision in session["decisions"]:
                if decision["decision"] == "accepted":
                    key = (session_id, decision["start_row"], decision["event_type"])
                    self.assertIn(key, accepted)
                    event = accepted[key]
                    self.assertAlmostEqual(
                        decision["severity"], round(event.severity_score, 2), places=2
                    )
                    self.assertAlmostEqual(
                        decision["confidence"],
                        round(event.confidence_score, 2),
                        places=2,
                    )
                    self.assertEqual(decision["provenance"], event.provenance)
                    if event.gps:
                        self.assertAlmostEqual(
                            decision["latitude"],
                            round(event.gps["latitude"], 6),
                            places=6,
                        )
                        self.assertAlmostEqual(
                            decision["longitude"],
                            round(event.gps["longitude"], 6),
                            places=6,
                        )
                    else:
                        self.assertIsNone(decision["latitude"])
                        self.assertIsNone(decision["longitude"])
                else:
                    key = (session_id, decision["start_row"])
                    self.assertIn(key, suppressed)
                    candidate = suppressed[key]
                    self.assertEqual(
                        decision["suppression_reason"], candidate.suppression_reason
                    )
                    self.assertEqual(decision["severity"], 0.0)
                    self.assertEqual(decision["confidence"], 0.0)

    def test_no_gps_coordinates_for_events_lacking_gps(self) -> None:
        for session in self.by_id.values():
            for decision in session["decisions"]:
                has_coords = (
                    decision["latitude"] is not None
                    and decision["longitude"] is not None
                )
                if decision["decision"] == "suppressed":
                    self.assertFalse(has_coords, decision)
                if has_coords:
                    self.assertEqual(decision["decision"], "accepted")

    def test_counters_match_detector_result(self) -> None:
        for session_id, session in self.by_id.items():
            accepted_so_far = sum(
                1 for d in session["decisions"] if d["decision"] == "accepted"
            )
            suppressed_so_far = sum(
                1 for d in session["decisions"] if d["decision"] == "suppressed"
            )
            expected_accepted = sum(
                1
                for event in list(self.result.accepted) + list(self.result.roughness)
                if event.session_id == session_id
            )
            expected_suppressed = sum(
                1
                for candidate in self.result.suppressed
                if candidate.session_id == session_id
            )
            self.assertEqual(accepted_so_far, expected_accepted)
            self.assertEqual(suppressed_so_far, expected_suppressed)

    def test_samples_match_feature_pipeline(self) -> None:
        session = self.by_id["4"]
        loaded = next(item for item in self.sessions if item.session_id == "4")
        series = build_series(loaded, DetectorConfig())
        for index in (0, 10, 500, len(series.rows) - 1):
            sample = session["samples"][index]
            row = series.rows[index]
            features = derive_features(row)
            self.assertAlmostEqual(
                sample["vertical_acceleration"],
                round(features["vertical_acceleration"], 6),
                places=6,
            )
            self.assertAlmostEqual(
                sample["horizontal_acceleration"],
                round(features["horizontal_acceleration"], 6),
                places=6,
            )
            self.assertAlmostEqual(
                sample["yaw_rate"], round(features["yaw_rate"], 6), places=6
            )
            self.assertAlmostEqual(
                sample["rolling_rms"], round(series.roughness[index], 6), places=6
            )
            if row.has_gps:
                self.assertAlmostEqual(
                    sample["latitude"], round(row.location_latitude, 6), places=6
                )
                self.assertAlmostEqual(
                    sample["longitude"], round(row.location_longitude, 6), places=6
                )

    def test_export_is_deterministic_and_current(self) -> None:
        rebuilt = build_replay(self.sessions, self.result)
        self.assertEqual(rebuilt, self.replay)


if __name__ == "__main__":
    unittest.main()
