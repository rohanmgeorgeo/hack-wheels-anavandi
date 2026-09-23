"""Checks for the RoadPulse demo data preparation pipeline.

Run from the repository root:

    python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = REPO_ROOT / "data" / "demo" / "source"
PROCESSED_DIR = REPO_ROOT / "data" / "demo" / "processed"

sys.path.insert(0, str(REPO_ROOT))

from processor import (  # noqa: E402
    ANOMALY_SCHEMA,
    NORMAL_SCHEMA,
    load_session,
    parse_float,
)
from processor.features import (  # noqa: E402
    acceleration_magnitude,
    gravity_aligned_vertical_acceleration,
    gyroscope_magnitude,
    horizontal_longitudinal_acceleration,
    yaw_rate_signal,
)

EXPECTED_ROWS = {"2": 1111, "4": 2549, "35": 906, "9": 5214}


def setUpModule() -> None:
    """Ensure the tracked demo source copies exist before running checks."""

    if not (SOURCE_DIR / "session-2.csv").exists():
        subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "prepare_demo_data.py")],
            cwd=str(REPO_ROOT),
            check=True,
        )


class LoaderTests(unittest.TestCase):
    def test_row_counts_match_acceptance_criteria(self) -> None:
        for session_id, expected in EXPECTED_ROWS.items():
            path = SOURCE_DIR / _source_name(session_id)
            session = load_session(path, session_id=session_id)
            self.assertEqual(session.row_count, expected, session_id)

    def test_schemas_detected(self) -> None:
        anomaly = load_session(SOURCE_DIR / "session-2.csv", session_id="2")
        normal = load_session(SOURCE_DIR / "session-9-normal.csv", session_id="9")
        self.assertEqual(anomaly.schema, ANOMALY_SCHEMA)
        self.assertEqual(normal.schema, NORMAL_SCHEMA)
        self.assertEqual(len(anomaly.columns), 45)
        self.assertEqual(len(normal.columns), 40)

    def test_normal_session_has_no_gps_or_annotations(self) -> None:
        session = load_session(SOURCE_DIR / "session-9-normal.csv", session_id="9")
        self.assertFalse(session.gps_available)
        self.assertFalse(session.annotation_available)
        self.assertEqual(session.annotation_regions, [])
        for row in session.rows:
            self.assertIsNone(row.location_latitude)
            self.assertIsNone(row.location_longitude)
            self.assertIsNone(row.annotation_text)

    def test_anomaly_session_preserves_gps(self) -> None:
        session = load_session(SOURCE_DIR / "session-2.csv", session_id="2")
        self.assertTrue(session.gps_available)
        self.assertTrue(session.annotation_available)
        self.assertIsNotNone(session.rows[0].location_latitude)
        self.assertIsNotNone(session.rows[0].location_longitude)


class AnnotationTests(unittest.TestCase):
    def test_region_counts_and_labels(self) -> None:
        expected = {
            "2": ["Bump"],
            "4": ["Bump", "Pothole", "Bump"],
            "35": ["Pothole"],
        }
        for session_id, labels in expected.items():
            session = load_session(
                SOURCE_DIR / _source_name(session_id), session_id=session_id
            )
            self.assertEqual(
                [region.label for region in session.annotation_regions],
                labels,
                session_id,
            )

    def test_region_spans_are_contiguous(self) -> None:
        session = load_session(SOURCE_DIR / "session-4.csv", session_id="4")
        regions = session.annotation_regions
        self.assertEqual(
            [(r.start_row, r.end_row) for r in regions],
            [(247, 1079), (1203, 1269), (1362, 2549)],
        )
        for region in regions:
            self.assertAlmostEqual(
                region.duration_seconds, region.end_time - region.start_time, places=9
            )

    def test_press_durations_preserved(self) -> None:
        session = load_session(SOURCE_DIR / "session-35.csv", session_id="35")
        region = session.annotation_regions[0]
        self.assertEqual(region.label, "Pothole")
        self.assertEqual(region.press_durations_ms, [83.0, 46.0])

    def test_regions_expose_gps(self) -> None:
        session = load_session(SOURCE_DIR / "session-2.csv", session_id="2")
        region = session.annotation_regions[0]
        self.assertIsNotNone(region.gps["start"])
        self.assertIsNotNone(region.gps["end"])
        self.assertIsNotNone(region.gps["centroid"])


class FeatureTests(unittest.TestCase):
    def test_parse_float_is_safe(self) -> None:
        self.assertEqual(parse_float("1.5"), 1.5)
        self.assertIsNone(parse_float(""))
        self.assertIsNone(parse_float("   "))
        self.assertIsNone(parse_float(None))
        self.assertIsNone(parse_float("not-a-number"))

    def test_magnitude_math(self) -> None:
        self.assertAlmostEqual(acceleration_magnitude((3.0, 4.0, 0.0)), 5.0)
        self.assertAlmostEqual(gyroscope_magnitude((0.0, 0.0, 2.0)), 2.0)

    def test_vertical_and_horizontal_projection(self) -> None:
        gravity = (0.0, 0.0, 9.8)
        self.assertAlmostEqual(
            gravity_aligned_vertical_acceleration((0.0, 0.0, 9.8), gravity), 9.8
        )
        self.assertAlmostEqual(
            horizontal_longitudinal_acceleration((3.0, 4.0, 0.0), gravity), 5.0
        )
        self.assertAlmostEqual(
            gravity_aligned_vertical_acceleration((3.0, 4.0, 0.0), gravity), 0.0
        )

    def test_yaw_rate_projection(self) -> None:
        gravity = (0.0, 0.0, 9.8)
        self.assertAlmostEqual(yaw_rate_signal((0.0, 0.0, 2.0), gravity), 2.0)
        self.assertAlmostEqual(yaw_rate_signal((1.0, 0.0, 0.0), gravity), 0.0)

    def test_zero_gravity_is_not_fabricated(self) -> None:
        self.assertIsNone(gravity_aligned_vertical_acceleration((1.0, 1.0, 1.0), (0.0, 0.0, 0.0)))
        self.assertIsNone(yaw_rate_signal((1.0, 1.0, 1.0), (0.0, 0.0, 0.0)))


class OutputTests(unittest.TestCase):
    def test_processed_outputs_written(self) -> None:
        for name in ("normalized_rows.csv", "annotation_regions.json", "summary.json"):
            self.assertTrue((PROCESSED_DIR / name).exists(), name)

    def test_summary_reports_expected_counts(self) -> None:
        summary = json.loads((PROCESSED_DIR / "summary.json").read_text())
        by_id = {item["session_id"]: item for item in summary["sessions"]}
        for session_id, expected in EXPECTED_ROWS.items():
            self.assertEqual(by_id[session_id]["row_count"], expected)
            self.assertTrue(by_id[session_id]["row_count_ok"])
        self.assertEqual(summary["totals"]["rows"], sum(EXPECTED_ROWS.values()))


def _source_name(session_id: str) -> str:
    return {
        "2": "session-2.csv",
        "4": "session-4.csv",
        "35": "session-35.csv",
        "9": "session-9-normal.csv",
    }[session_id]


if __name__ == "__main__":
    unittest.main()
