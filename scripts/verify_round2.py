#!/usr/bin/env python3
"""One-command Round-2 verification for the RoadPulse prototype.

Runs the complete offline verification chain and prints a factual summary
derived from the generated JSON. No network access is required; OpenStreetMap
tile connectivity is deliberately out of scope.

    python3 scripts/verify_round2.py

Steps:
  1. Python unit tests
  2. Observation store: deterministic rebuild/check
  3. Journey Replay: dataset integrity
  4. Frontend Road Issues validation
  5. Frontend traceability validation
  6. TypeScript typecheck
  7. Frontend production build

Stops on the first real failure and returns non-zero.
"""

from __future__ import annotations

import json
import re
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = REPO_ROOT / "frontend"
PROCESSED_DIR = REPO_ROOT / "data" / "demo" / "processed"

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(REPO_ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "scripts"))

# Round-2 baseline. Actual values are always derived from the generated files;
# these are only used to fail loudly if the outputs drift unexpectedly.
EXPECTED = {
    "accepted_events": 44,
    "suppressed_candidates": 98,
    "accepted_with_gps": 31,
    "spatial_issues": 11,
    "multi_observation_issues": 9,
    "cross_session_issues": 0,
    "python_tests": 67,
}

TABLES = (
    "journeys",
    "observations",
    "suppressed_candidates",
    "road_issues",
    "issue_observations",
)


class VerificationError(Exception):
    """Raised when a verification step fails."""


def section(label: str) -> None:
    print(f"\n=== {label} ===")


def run(label: str, command: list, cwd: Path) -> str:
    section(label)
    print("$ " + " ".join(command))
    completed = subprocess.run(command, cwd=str(cwd), capture_output=True, text=True)
    output = completed.stdout + completed.stderr
    if completed.returncode != 0:
        print(output[-6000:])
        raise VerificationError(f"{label} FAILED (exit {completed.returncode})")
    print(f"PASS: {label}")
    return output


def dump_database(path: Path) -> dict:
    connection = sqlite3.connect(path)
    try:
        return {
            table: connection.execute(
                f"SELECT * FROM {table} ORDER BY 1, 2"
            ).fetchall()
            for table in TABLES
        }
    finally:
        connection.close()


def check_observation_store() -> None:
    section("[2/7] Observation store: deterministic rebuild")
    from build_observation_store import build_all, write_database

    built = build_all(PROCESSED_DIR)
    committed = json.loads(
        (PROCESSED_DIR / "road_issues.json").read_text(encoding="utf-8")
    )
    if built["payload"] != committed:
        raise VerificationError(
            "road_issues.json does not match a deterministic rebuild "
            "(run scripts/build_observation_store.py)"
        )

    with tempfile.TemporaryDirectory() as directory:
        first = Path(directory) / "first.db"
        second = Path(directory) / "second.db"
        for path in (first, second):
            write_database(
                path,
                built["journeys"],
                built["observations"],
                built["suppressed"],
                built["issues"],
            )
        if dump_database(first) != dump_database(second):
            raise VerificationError("SQLite rebuild is not deterministic")

    print(
        "PASS: observation store rebuild matches committed output and is "
        "deterministic (temp DBs only; source data untouched)"
    )


def check_replay_integrity() -> None:
    section("[3/7] Journey Replay: dataset integrity")
    from export_replay_data import build_replay, load_demo_sessions
    from processor.detector import detect_sessions

    sessions = load_demo_sessions()
    result = detect_sessions(sessions)
    rebuilt = build_replay(sessions, result)
    committed = json.loads(
        (PROCESSED_DIR / "replay_sessions.json").read_text(encoding="utf-8")
    )
    if rebuilt != committed:
        raise VerificationError(
            "replay_sessions.json does not match a deterministic rebuild "
            "(run scripts/export_replay_data.py)"
        )
    print("PASS: replay dataset matches a deterministic rebuild")


def derive_counts(test_output: str) -> dict:
    events = json.loads((PROCESSED_DIR / "events.json").read_text(encoding="utf-8"))
    issues = json.loads(
        (PROCESSED_DIR / "road_issues.json").read_text(encoding="utf-8")
    )
    match = re.search(r"Ran (\d+) tests", test_output)
    return {
        "accepted_events": len(events["events"]),
        "suppressed_candidates": len(events["suppressed_candidates"]),
        "accepted_with_gps": sum(1 for event in events["events"] if event.get("gps")),
        "spatial_issues": len(issues["issues"]),
        "multi_observation_issues": issues["summary"]["multi_observation_issue_count"],
        "cross_session_issues": issues["summary"]["multi_session_issue_count"],
        "python_tests": int(match.group(1)) if match else -1,
    }


def print_summary(counts: dict) -> None:
    print("\n" + "=" * 48)
    print("RoadPulse verification passed")
    print("=" * 48)
    print(f"Accepted events: {counts['accepted_events']}")
    print(f"Suppressed candidates: {counts['suppressed_candidates']}")
    print(f"Accepted with GPS: {counts['accepted_with_gps']}")
    print(f"Spatial issues: {counts['spatial_issues']}")
    print(f"Multi-observation issues: {counts['multi_observation_issues']}")
    print(f"Cross-session issues: {counts['cross_session_issues']}")
    print(f"Python tests: {counts['python_tests']} passed")
    print("=" * 48)


def main() -> int:
    print("RoadPulse Round-2 verification")
    print(f"Repository: {REPO_ROOT}")
    try:
        test_output = run(
            "[1/7] Python unit tests",
            [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
            REPO_ROOT,
        )
        check_observation_store()
        check_replay_integrity()
        run(
            "[4/7] Road Issues validation",
            ["npm", "run", "validate:issues"],
            FRONTEND_DIR,
        )
        run(
            "[5/7] Traceability validation",
            ["npm", "run", "validate:traceability"],
            FRONTEND_DIR,
        )
        run("[6/7] TypeScript typecheck", ["npm", "run", "typecheck"], FRONTEND_DIR)
        run(
            "[7/7] Frontend production build",
            ["npm", "run", "build"],
            FRONTEND_DIR,
        )

        counts = derive_counts(test_output)
        mismatches = {
            key: (counts[key], EXPECTED[key])
            for key in EXPECTED
            if counts[key] != EXPECTED[key]
        }
        if mismatches:
            section("Demo data integrity summary")
            for key, (actual, expected) in mismatches.items():
                print(f"MISMATCH {key}: actual={actual} expected={expected}")
            raise VerificationError(
                "demo data counts differ from the expected Round-2 baseline"
            )

        print_summary(counts)
        return 0
    except VerificationError as error:
        print(f"\nVERIFICATION FAILED: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
