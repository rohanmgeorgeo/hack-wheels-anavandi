"""Focused automated checks for the RoadPulse explainable detector.

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

from processor import load_session  # noqa: E402
from processor.detector import (  # noqa: E402
    BUMP,
    POTHOLE,
    ROUGHNESS,
    Candidate,
    DetectorConfig,
    SessionSeries,
    Thresholds,
    detect_impact_candidates,
    detect_roughness,
    detect_sessions,
    event_gps,
    percentile,
    robust_stats,
    rolling_max_abs,
    rolling_mean_abs,
    rolling_rms,
    score_impact,
    suppression_reason,
    thresholds_from_baseline,
    SUPPRESSION_HORIZONTAL,
    SUPPRESSION_NOISE,
    SUPPRESSION_TURNING,
)

DEMO_SESSIONS = (
    ("2", "session-2.csv"),
    ("4", "session-4.csv"),
    ("35", "session-35.csv"),
    ("9", "session-9-normal.csv"),
)


def setUpModule() -> None:
    if not (SOURCE_DIR / "session-2.csv").exists():
        subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "prepare_demo_data.py")],
            cwd=str(REPO_ROOT),
            check=True,
        )


class _Row:
    """Minimal stand-in for a SensorRow in synthetic series tests."""

    def __init__(self, row_index, has_gps=False, latitude=None, longitude=None,
                 accuracy=None):
        self.row_index = row_index
        self.has_gps = has_gps
        self.location_latitude = latitude
        self.location_longitude = longitude
        self.location_vertical_accuracy = accuracy


def make_series(vertical, roughness=None, session_id="syn", hz=100.0):
    n = len(vertical)
    half_impact = int(round(0.02 * hz / 2.0))
    half_rms = int(round(1.0 * hz / 2.0))
    zero = [0.0] * n
    series = SessionSeries(
        session_id=session_id,
        rows=[_Row(i + 1) for i in range(n)],
        times=[round(i / hz, 6) for i in range(n)],
        vertical=list(vertical),
        horizontal=zero,
        yaw=zero,
        gyro_magnitude=zero,
        vertical_peak=rolling_max_abs(vertical, half_impact),
        turning=zero,
        horizontal_band=zero,
        roughness=roughness if roughness is not None else rolling_rms(vertical, half_rms),
    )
    return series


def make_thresholds(candidate=1.0, accept=1.0, turning=0.2, horizontal=2.0, roughness=1.0):
    return Thresholds(
        candidate_peak=candidate,
        accept_peak=accept,
        turning=turning,
        horizontal=horizontal,
        roughness=roughness,
    )


def make_candidate(**overrides):
    defaults = dict(
        session_id="syn",
        start_sample=0,
        end_sample=10,
        peak_sample=5,
        start_row=1,
        end_row=11,
        peak_row=6,
        start_time=0.0,
        end_time=0.1,
        peak_time=0.05,
        peak_vertical=1.0,
        peak_abs_vertical=1.0,
        duration_seconds=0.1,
        local_rms=0.5,
        impulse=0.05,
        rebound_ratio=0.5,
        turning_activity=0.0,
        horizontal_activity=0.0,
        gyro_activity=0.1,
    )
    defaults.update(overrides)
    return Candidate(**defaults)


class RobustStatsTests(unittest.TestCase):
    def test_percentile_and_robust_stats(self) -> None:
        values = [0.0, 1.0, 2.0, 3.0, 4.0]
        self.assertEqual(percentile(sorted(values), 0.0), 0.0)
        self.assertEqual(percentile(sorted(values), 100.0), 4.0)
        stats = robust_stats(values)
        self.assertEqual(stats.count, 5)
        self.assertEqual(stats.median, 2.0)
        self.assertEqual(stats.mad, 1.0)
        self.assertLessEqual(stats.minimum, stats.p95)

    def test_thresholds_from_baseline_use_percentiles(self) -> None:
        baseline = {
            "vertical_peak": robust_stats([1.0, 2.0, 3.0, 4.0, 5.0]),
            "turning": robust_stats([0.1, 0.2, 0.3, 0.4, 0.5]),
            "horizontal": robust_stats([1.0, 2.0, 3.0, 4.0, 5.0]),
            "roughness": robust_stats([0.5, 1.0, 1.5, 2.0, 2.5]),
        }
        config = DetectorConfig(candidate_percentile=50.0, accept_percentile=100.0)
        thresholds = thresholds_from_baseline(baseline, config)
        self.assertEqual(thresholds.candidate_peak, 3.0)
        self.assertEqual(thresholds.accept_peak, 5.0)

    def test_abs_bands_are_non_negative(self) -> None:
        self.assertTrue(all(v >= 0 for v in rolling_mean_abs([-1.0, 1.0], 1)))
        self.assertTrue(all(v >= 0 for v in rolling_rms([-1.0, 1.0], 1)))


class ImpactMergingTests(unittest.TestCase):
    def test_close_crossings_merge_into_one_candidate(self) -> None:
        vertical = [0.0] * 100
        vertical[20] = 2.0
        vertical[25] = 2.0
        series = make_series(vertical)
        candidates = detect_impact_candidates(
            series, make_thresholds(), DetectorConfig(impact_merge_gap_seconds=0.08)
        )
        self.assertEqual(len(candidates), 1)

    def test_distant_crossings_stay_separate(self) -> None:
        vertical = [0.0] * 100
        vertical[20] = 2.0
        vertical[60] = 2.0
        series = make_series(vertical)
        candidates = detect_impact_candidates(
            series, make_thresholds(), DetectorConfig(impact_merge_gap_seconds=0.08)
        )
        self.assertEqual(len(candidates), 2)


class SuppressionTests(unittest.TestCase):
    def test_turning_suppression(self) -> None:
        thresholds = make_thresholds(turning=0.1)
        candidate = make_candidate(turning_activity=0.5)
        self.assertEqual(suppression_reason(candidate, thresholds), SUPPRESSION_TURNING)

    def test_horizontal_motion_suppression(self) -> None:
        thresholds = make_thresholds(accept=2.0, horizontal=1.0)
        candidate = make_candidate(
            peak_abs_vertical=1.5, horizontal_activity=3.0, turning_activity=0.0
        )
        self.assertEqual(
            suppression_reason(candidate, thresholds), SUPPRESSION_HORIZONTAL
        )

    def test_noise_suppression_below_accept_threshold(self) -> None:
        thresholds = make_thresholds(accept=2.0, horizontal=100.0)
        candidate = make_candidate(peak_abs_vertical=1.2, horizontal_activity=0.0)
        self.assertEqual(suppression_reason(candidate, thresholds), SUPPRESSION_NOISE)

    def test_strong_vertical_survives_high_horizontal(self) -> None:
        thresholds = make_thresholds(accept=2.0, horizontal=1.0)
        candidate = make_candidate(peak_abs_vertical=3.0, horizontal_activity=5.0)
        self.assertIsNone(suppression_reason(candidate, thresholds))


class RoughnessTests(unittest.TestCase):
    def test_sustained_run_produces_one_event(self) -> None:
        n = 400
        roughness = [0.0] * n
        for i in range(0, 200):
            roughness[i] = 1.5
        series = make_series([0.0] * n, roughness=roughness)
        events = detect_roughness(
            series, make_thresholds(roughness=1.0), DetectorConfig(), []
        )
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].provenance, "derived_heuristic")
        self.assertEqual(events[0].event_class, ROUGHNESS)

    def test_short_blip_is_not_sustained(self) -> None:
        n = 400
        roughness = [0.0] * n
        for i in range(0, 50):
            roughness[i] = 1.5
        series = make_series([0.0] * n, roughness=roughness)
        events = detect_roughness(
            series, make_thresholds(roughness=1.0), DetectorConfig(), []
        )
        self.assertEqual(events, [])

    def test_overlapping_impact_is_not_re_emitted_as_roughness(self) -> None:
        n = 400
        roughness = [0.0] * n
        for i in range(0, 160):
            roughness[i] = 1.5
        series = make_series([0.0] * n, roughness=roughness)
        impact = make_candidate(start_sample=0, end_sample=170, peak_sample=80)
        events = detect_roughness(
            series, make_thresholds(roughness=1.0), DetectorConfig(), [impact]
        )
        self.assertEqual(events, [])


class ScoringTests(unittest.TestCase):
    def test_severity_and_confidence_are_bounded(self) -> None:
        thresholds = make_thresholds(accept=2.0)
        for peak in (0.0, 1.0, 5.0, 50.0):
            for rebound in (0.0, 1.0, 5.0):
                candidate = make_candidate(
                    peak_abs_vertical=peak,
                    local_rms=peak,
                    duration_seconds=1.0,
                    rebound_ratio=rebound,
                    horizontal_activity=10.0,
                )
                score_impact(candidate, thresholds, DetectorConfig())
                self.assertGreaterEqual(candidate.severity_score, 0.0)
                self.assertLessEqual(candidate.severity_score, 100.0)
                self.assertGreaterEqual(candidate.confidence_score, 0.0)
                self.assertLessEqual(candidate.confidence_score, 100.0)


class GpsTests(unittest.TestCase):
    def test_missing_gps_is_never_fabricated(self) -> None:
        rows = [_Row(i + 1, has_gps=False) for i in range(5)]
        self.assertIsNone(event_gps(rows, 0, 2, 4))

    def test_real_gps_is_returned(self) -> None:
        rows = [
            _Row(1, has_gps=False),
            _Row(2, has_gps=True, latitude=24.5, longitude=88.5),
            _Row(3, has_gps=True, latitude=24.6, longitude=88.6),
        ]
        gps = event_gps(rows, 0, 1, 2)
        self.assertEqual(gps["latitude"], 24.5)
        self.assertEqual(gps["longitude"], 88.5)


class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sessions = [
            load_session(SOURCE_DIR / name, session_id=session_id)
            for session_id, name in DEMO_SESSIONS
        ]
        cls.result = detect_sessions(cls.sessions)

    def test_roughness_provenance_marked_derived(self) -> None:
        for event in self.result.roughness:
            self.assertEqual(event.provenance, "derived_heuristic")
            self.assertEqual(event.event_class, ROUGHNESS)

    def test_suppressed_candidates_have_valid_reasons(self) -> None:
        valid = {SUPPRESSION_TURNING, SUPPRESSION_HORIZONTAL, SUPPRESSION_NOISE}
        for candidate in self.result.suppressed:
            self.assertTrue(candidate.suppressed)
            self.assertIn(candidate.suppression_reason, valid)

    def test_accepted_events_have_bounded_scores_and_gps_rules(self) -> None:
        gps_sessions = {"2", "4", "35"}
        for event in self.result.accepted:
            self.assertIn(event.event_class, {POTHOLE, BUMP})
            self.assertGreaterEqual(event.severity_score, 0.0)
            self.assertLessEqual(event.severity_score, 100.0)
            self.assertGreaterEqual(event.confidence_score, 0.0)
            self.assertLessEqual(event.confidence_score, 100.0)
            if event.session_id == "9":
                self.assertIsNone(event.gps)
            elif event.session_id in gps_sessions:
                self.assertIsNotNone(event.gps)

    def test_accepted_gps_matches_source_rows(self) -> None:
        for session in self.sessions:
            if session.session_id != "2":
                continue
            coordinates = {
                (row.location_latitude, row.location_longitude)
                for row in session.rows
                if row.has_gps
            }
            for event in self.result.accepted:
                if event.session_id == "2":
                    self.assertIn(
                        (event.gps["latitude"], event.gps["longitude"]), coordinates
                    )

    def test_deterministic_output(self) -> None:
        second = detect_sessions(self.sessions)
        first_events = [
            event.to_dict() for event in self.result.accepted + self.result.roughness
        ]
        second_events = [
            event.to_dict() for event in second.accepted + second.roughness
        ]
        self.assertEqual(first_events, second_events)
        self.assertEqual(self.result.summary, second.summary)


class OutputTests(unittest.TestCase):
    def test_detector_outputs_written(self) -> None:
        for name in ("events.json", "detector_summary.json"):
            self.assertTrue((PROCESSED_DIR / name).exists(), name)

    def test_summary_has_required_counts(self) -> None:
        summary = json.loads((PROCESSED_DIR / "detector_summary.json").read_text())
        counts = summary["counts"]
        for key in (POTHOLE, BUMP, ROUGHNESS):
            self.assertIn(key, counts["accepted_by_class"])
        for reason in (SUPPRESSION_TURNING, SUPPRESSION_HORIZONTAL, SUPPRESSION_NOISE):
            self.assertIn(reason, counts["suppressed_by_reason"])
        validation = summary["validation"]
        self.assertIn("pothole_bump_separation", validation)

    def test_events_json_shape(self) -> None:
        events = json.loads((PROCESSED_DIR / "events.json").read_text())
        self.assertIn("events", events)
        self.assertIn("suppressed_candidates", events)


if __name__ == "__main__":
    unittest.main()