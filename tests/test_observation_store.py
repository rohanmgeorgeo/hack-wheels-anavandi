"""Integrity checks for the RoadPulse local observation store and aggregation.

These tests assert that the store is a faithful, deterministic copy of the
existing detector output, that GPS-less observations never enter spatial
clustering, and that cluster statistics are factual.

Run from the repository root:

    python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = REPO_ROOT / "data" / "demo" / "source"
PROCESSED_DIR = REPO_ROOT / "data" / "demo" / "processed"
DB_PATH = PROCESSED_DIR / "roadpulse.db"
ISSUES_PATH = PROCESSED_DIR / "road_issues.json"

sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from processor import load_session  # noqa: E402
from processor.detector import detect_sessions  # noqa: E402
from build_observation_store import (  # noqa: E402
    ASSOCIATION_RADIUS_METERS,
    build_all,
    haversine_meters,
    write_database,
)

DEMO_SESSIONS = (
    ("2", "session-2.csv"),
    ("4", "session-4.csv"),
    ("35", "session-35.csv"),
    ("9", "session-9-normal.csv"),
)


def setUpModule() -> None:
    if not ISSUES_PATH.exists() or not DB_PATH.exists():
        subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "build_observation_store.py")],
            cwd=str(REPO_ROOT),
            check=True,
        )


def _dump_database(path: Path) -> dict:
    connection = sqlite3.connect(path)
    try:
        dump = {}
        for table in (
            "journeys",
            "observations",
            "suppressed_candidates",
            "road_issues",
            "issue_observations",
        ):
            rows = connection.execute(
                f"SELECT * FROM {table} ORDER BY 1, 2"
            ).fetchall()
            dump[table] = rows
        return dump
    finally:
        connection.close()


class ObservationStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.events = json.loads((PROCESSED_DIR / "events.json").read_text())
        cls.built = build_all(PROCESSED_DIR)
        cls.payload = json.loads(ISSUES_PATH.read_text())
        cls.observations = cls.built["observations"]
        cls.suppressed = cls.built["suppressed"]
        cls.issues = cls.built["issues"]
        cls.by_issue = {issue["issue_id"]: issue for issue in cls.issues}
        cls.observation_by_id = {
            observation["observation_id"]: observation
            for observation in cls.observations
        }

    # ------------------------------------------------------------------ counts
    def test_stored_accepted_count_matches_detector_output(self) -> None:
        self.assertEqual(len(self.observations), len(self.events["events"]))
        sessions = [
            load_session(SOURCE_DIR / name, session_id=session_id)
            for session_id, name in DEMO_SESSIONS
        ]
        detector = detect_sessions(sessions)
        self.assertEqual(
            len(self.observations),
            len(detector.accepted) + len(detector.roughness),
        )

    def test_stored_suppressed_count_matches_detector_output(self) -> None:
        self.assertEqual(
            len(self.suppressed), len(self.events["suppressed_candidates"])
        )
        sessions = [
            load_session(SOURCE_DIR / name, session_id=session_id)
            for session_id, name in DEMO_SESSIONS
        ]
        detector = detect_sessions(sessions)
        self.assertEqual(len(self.suppressed), len(detector.suppressed))

    def test_suppressed_reasons_preserved(self) -> None:
        source_reasons = sorted(
            candidate["suppression_reason"]
            for candidate in self.events["suppressed_candidates"]
        )
        stored_reasons = sorted(item["suppression_reason"] for item in self.suppressed)
        self.assertEqual(source_reasons, stored_reasons)

    # ------------------------------------------------------------- GPS honesty
    def test_gps_less_observations_stored_but_not_clustered(self) -> None:
        gps_less = [
            observation
            for observation in self.observations
            if observation["latitude"] is None or observation["longitude"] is None
        ]
        self.assertTrue(gps_less, "expected some GPS-less accepted observations")
        clustered_ids = {
            member["observation_id"]
            for issue in self.issues
            for member in issue["members"]
        }
        for observation in gps_less:
            self.assertIsNone(observation["latitude"])
            self.assertIsNone(observation["longitude"])
            self.assertNotIn(observation["observation_id"], clustered_ids)

    def test_no_gps_values_are_invented(self) -> None:
        source = {
            (
                event["session_id"],
                event["class"],
                event["start_row"],
                event["peak_row"],
            ): (event.get("gps") or {})
            for event in self.events["events"]
        }
        for observation in self.observations:
            key = (
                observation["session_id"],
                observation["event_class"],
                observation["start_row"],
                observation["peak_row"],
            )
            gps = source[key]
            self.assertEqual(observation["latitude"], gps.get("latitude"))
            self.assertEqual(observation["longitude"], gps.get("longitude"))

    # -------------------------------------------------------- cluster integrity
    def test_every_issue_member_is_a_real_accepted_observation(self) -> None:
        for issue in self.issues:
            self.assertGreaterEqual(issue["observation_count"], 1)
            for member in issue["members"]:
                self.assertIn(member["observation_id"], self.observation_by_id)
                source = self.observation_by_id[member["observation_id"]]
                self.assertEqual(member["session_id"], source["session_id"])
                self.assertEqual(member["event_class"], source["event_class"])
                self.assertIsNotNone(member["latitude"])
                self.assertIsNotNone(member["longitude"])

    def test_every_member_within_radius_of_cluster_anchor(self) -> None:
        for issue in self.issues:
            for member in issue["members"]:
                distance = haversine_meters(
                    member["latitude"],
                    member["longitude"],
                    issue["anchor_latitude"],
                    issue["anchor_longitude"],
                )
                self.assertLessEqual(distance, ASSOCIATION_RADIUS_METERS + 1e-6)

    def test_clusters_are_well_separated(self) -> None:
        anchors = [
            (issue["anchor_latitude"], issue["anchor_longitude"])
            for issue in self.issues
        ]
        for i in range(len(anchors)):
            for j in range(i + 1, len(anchors)):
                self.assertGreater(
                    haversine_meters(*anchors[i], *anchors[j]),
                    ASSOCIATION_RADIUS_METERS,
                )

    def test_observation_count_is_correct(self) -> None:
        for issue in self.issues:
            self.assertEqual(issue["observation_count"], len(issue["members"]))

    def test_distinct_session_count_is_correct(self) -> None:
        for issue in self.issues:
            expected = len({member["session_id"] for member in issue["members"]})
            self.assertEqual(issue["distinct_session_count"], expected)
            self.assertEqual(
                issue["session_ids"],
                sorted({member["session_id"] for member in issue["members"]}),
            )

    def test_class_counts_are_correct(self) -> None:
        for issue in self.issues:
            expected: dict = {}
            for member in issue["members"]:
                expected[member["event_class"]] = (
                    expected.get(member["event_class"], 0) + 1
                )
            self.assertEqual(issue["class_counts"], expected)
            self.assertEqual(sum(issue["class_counts"].values()), issue["observation_count"])

    def test_center_is_derived_from_members(self) -> None:
        for issue in self.issues:
            latitudes = [member["latitude"] for member in issue["members"]]
            longitudes = [member["longitude"] for member in issue["members"]]
            self.assertAlmostEqual(
                issue["center_latitude"],
                round(sum(latitudes) / len(latitudes), 6),
                places=6,
            )
            self.assertAlmostEqual(
                issue["center_longitude"],
                round(sum(longitudes) / len(longitudes), 6),
                places=6,
            )

    def test_severity_and_confidence_summaries_are_from_members(self) -> None:
        for issue in self.issues:
            severities = [member["severity_score"] for member in issue["members"]]
            confidences = [member["confidence_score"] for member in issue["members"]]
            self.assertAlmostEqual(
                issue["severity_mean"], round(sum(severities) / len(severities), 4)
            )
            self.assertAlmostEqual(issue["severity_max"], round(max(severities), 4))
            self.assertAlmostEqual(
                issue["confidence_mean"],
                round(sum(confidences) / len(confidences), 4),
            )
            self.assertAlmostEqual(issue["confidence_max"], round(max(confidences), 4))

    def test_provenance_preserved(self) -> None:
        source = {
            (
                event["session_id"],
                event["class"],
                event["start_row"],
                event["peak_row"],
            ): event["provenance"]
            for event in self.events["events"]
        }
        for observation in self.observations:
            key = (
                observation["session_id"],
                observation["event_class"],
                observation["start_row"],
                observation["peak_row"],
            )
            self.assertEqual(observation["provenance"], source[key])
        for issue in self.issues:
            for member in issue["members"]:
                self.assertIn(
                    member["provenance"], {"detected_impact", "derived_heuristic"}
                )

    # ------------------------------------------------- cross-session truthfulness
    def test_cross_session_counts_are_factual(self) -> None:
        summary = self.payload["summary"]
        multi_session = [
            issue for issue in self.issues if issue["distinct_session_count"] > 1
        ]
        self.assertEqual(summary["multi_session_issue_count"], len(multi_session))
        expected_combinations: dict = {}
        for issue in multi_session:
            key = "+".join(issue["session_ids"])
            expected_combinations[key] = expected_combinations.get(key, 0) + 1
        self.assertEqual(summary["session_combinations"], expected_combinations)

    def test_no_fake_cross_session_corroboration(self) -> None:
        summary = self.payload["summary"]
        # The closest cross-session pair is far beyond the radius, so at the
        # configured radius no cluster may span more than one recorded session.
        self.assertGreater(
            summary["min_cross_session_distance_meters"],
            ASSOCIATION_RADIUS_METERS,
        )
        self.assertEqual(summary["multi_session_issue_count"], 0)
        for issue in self.issues:
            self.assertEqual(issue["distinct_session_count"], 1)

    def test_multi_observation_and_distribution_are_factual(self) -> None:
        summary = self.payload["summary"]
        expected_multi = sum(1 for issue in self.issues if issue["observation_count"] > 1)
        self.assertEqual(summary["multi_observation_issue_count"], expected_multi)
        distribution: dict = {}
        for issue in self.issues:
            key = str(issue["observation_count"])
            distribution[key] = distribution.get(key, 0) + 1
        self.assertEqual(summary["cluster_size_distribution"], distribution)

    # ------------------------------------------------------------- determinism
    def test_build_is_deterministic(self) -> None:
        first = build_all(PROCESSED_DIR)["payload"]
        second = build_all(PROCESSED_DIR)["payload"]
        self.assertEqual(first, second)
        self.assertEqual(first, self.payload)

    def test_database_rebuild_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "roadpulse.db"
            write_database(
                path,
                self.built["journeys"],
                self.built["observations"],
                self.built["suppressed"],
                self.built["issues"],
            )
            first = _dump_database(path)
            write_database(
                path,
                self.built["journeys"],
                self.built["observations"],
                self.built["suppressed"],
                self.built["issues"],
            )
            second = _dump_database(path)
            self.assertEqual(first, second)

    def test_committed_database_matches_source(self) -> None:
        self.assertTrue(DB_PATH.exists())
        connection = sqlite3.connect(DB_PATH)
        try:
            accepted = connection.execute(
                "SELECT COUNT(*) FROM observations"
            ).fetchone()[0]
            suppressed = connection.execute(
                "SELECT COUNT(*) FROM suppressed_candidates"
            ).fetchone()[0]
            issues = connection.execute("SELECT COUNT(*) FROM road_issues").fetchone()[0]
            members = connection.execute(
                "SELECT COUNT(*) FROM issue_observations"
            ).fetchone()[0]
            journeys = connection.execute("SELECT COUNT(*) FROM journeys").fetchone()[0]
            gps_less_clustered = connection.execute(
                "SELECT COUNT(*) FROM issue_observations io "
                "JOIN observations o ON o.observation_id = io.observation_id "
                "WHERE o.latitude IS NULL OR o.longitude IS NULL"
            ).fetchone()[0]
        finally:
            connection.close()
        self.assertEqual(accepted, len(self.observations))
        self.assertEqual(suppressed, len(self.suppressed))
        self.assertEqual(issues, len(self.issues))
        self.assertEqual(members, sum(issue["observation_count"] for issue in self.issues))
        self.assertEqual(journeys, len(self.built["journeys"]))
        self.assertEqual(gps_less_clustered, 0)

    def test_journeys_preserve_session_ids(self) -> None:
        source_sessions = {
            session["session_id"] for session in json.loads(
                (PROCESSED_DIR / "summary.json").read_text()
            )["sessions"]
        }
        stored_sessions = {journey["session_id"] for journey in self.built["journeys"]}
        self.assertEqual(source_sessions, stored_sessions)


if __name__ == "__main__":
    unittest.main()
