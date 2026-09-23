#!/usr/bin/env python3
"""Reproducible, read-only preparation of the RoadPulse demo subset.

This script:

1. extracts four RoadSens-4M sessions from the read-only RAR archives into
   ``data/demo/source`` under consistent names;
2. loads them with :mod:`processor.loader`;
3. derives explainable sensor features with :mod:`processor.features`;
4. parses labelled annotation regions;
5. writes a compact normalized dataset to ``data/demo/processed``.

The source archives under ``data/extracted`` and ``data/raw`` are only ever
read, never modified.

Run from the repository root:

    python3 scripts/prepare_demo_data.py
"""

from __future__ import annotations

import csv
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from processor import DERIVED_FEATURE_NAMES, derive_features, load_session  # noqa: E402

SOURCE_DIR = REPO_ROOT / "data" / "demo" / "source"
PROCESSED_DIR = REPO_ROOT / "data" / "demo" / "processed"

ANOMALIES_ARCHIVE = (
    REPO_ROOT
    / "data"
    / "extracted"
    / "Combined CSV with GIS and Weather Data"
    / "Road Anomalies"
    / "Road Anomalies.rar"
)
NORMAL_ARCHIVE = (
    REPO_ROOT
    / "data"
    / "extracted"
    / "Combined CSV with GIS and Weather Data"
    / "Normal Road (No Annotation)"
    / "Normal Road (No Annotation).rar"
)


@dataclass(frozen=True)
class SessionSpec:
    session_id: str
    archive: Path
    member: str
    output_name: str
    expected_rows: int
    note: str


SESSIONS = (
    SessionSpec("2", ANOMALIES_ARCHIVE, "2.csv", "session-2.csv", 1111, "Bump"),
    SessionSpec("4", ANOMALIES_ARCHIVE, "4.csv", "session-4.csv", 2549, "Bump + Pothole"),
    SessionSpec("35", ANOMALIES_ARCHIVE, "35.csv", "session-35.csv", 906, "Pothole"),
    SessionSpec(
        "9",
        NORMAL_ARCHIVE,
        "9 - Normal Road.csv",
        "session-9-normal.csv",
        5214,
        "Normal road baseline (no labels)",
    ),
)

# Column order of the compact normalized rows CSV.
ROW_COLUMNS = (
    "session_id",
    "row_index",
    "seconds_elapsed",
    "accelerometer_x",
    "accelerometer_y",
    "accelerometer_z",
    "gravity_x",
    "gravity_y",
    "gravity_z",
    "gyroscope_x",
    "gyroscope_y",
    "gyroscope_z",
    *DERIVED_FEATURE_NAMES,
    "location_latitude",
    "location_longitude",
    "location_verticalAccuracy",
    "annotation_text",
    "annotation_millisecond_press_duration",
)


def extract_member(archive: Path, member: str, destination: Path) -> None:
    """Extract a single archive member to ``destination`` using bsdtar.

    ``bsdtar -xOf`` streams the member to stdout, so the archive itself is
    opened read-only and left untouched.
    """

    if not archive.exists():
        raise FileNotFoundError(f"Source archive not found: {archive}")
    result = subprocess.run(
        ["bsdtar", "-xOf", str(archive), member],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"bsdtar failed for {member!r} in {archive}:\n"
            f"{result.stderr.decode('utf-8', 'replace').strip()}"
        )
    if not result.stdout:
        raise RuntimeError(f"bsdtar produced no data for {member!r} in {archive}")
    destination.write_bytes(result.stdout)


def row_to_record(session, row) -> dict:
    features = derive_features(row)
    record = {
        "session_id": session.session_id,
        "row_index": row.row_index,
        "seconds_elapsed": row.seconds_elapsed,
        "accelerometer_x": row.accelerometer[0],
        "accelerometer_y": row.accelerometer[1],
        "accelerometer_z": row.accelerometer[2],
        "gravity_x": row.gravity[0],
        "gravity_y": row.gravity[1],
        "gravity_z": row.gravity[2],
        "gyroscope_x": row.gyroscope[0],
        "gyroscope_y": row.gyroscope[1],
        "gyroscope_z": row.gyroscope[2],
        "location_latitude": row.location_latitude,
        "location_longitude": row.location_longitude,
        "location_verticalAccuracy": row.location_vertical_accuracy,
        "annotation_text": row.annotation_text,
        "annotation_millisecond_press_duration": (
            row.annotation_millisecond_press_duration
        ),
    }
    record.update(features)
    return record


def write_rows_csv(sessions, destination: Path) -> int:
    total = 0
    with destination.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=ROW_COLUMNS)
        writer.writeheader()
        for session in sessions:
            for row in session.rows:
                writer.writerow(row_to_record(session, row))
                total += 1
    return total


def session_summary(spec: SessionSpec, session) -> dict:
    label_counts: dict = {}
    for row in session.rows:
        if row.annotation_text:
            label_counts[row.annotation_text] = label_counts.get(row.annotation_text, 0) + 1
    return {
        "session_id": spec.session_id,
        "source_name": spec.output_name,
        "source_archive": str(spec.archive.relative_to(REPO_ROOT)),
        "source_member": spec.member,
        "schema": session.schema,
        "row_count": session.row_count,
        "expected_row_count": spec.expected_rows,
        "row_count_ok": session.row_count == spec.expected_rows,
        "gps_available": session.gps_available,
        "annotation_available": session.annotation_available,
        "annotation_region_count": len(session.annotation_regions),
        "annotation_row_counts": label_counts,
    }


def main() -> int:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    print("Extracting selected RoadSens-4M sessions (read-only)...")
    sessions = []
    specs_by_id = {}
    for spec in SESSIONS:
        destination = SOURCE_DIR / spec.output_name
        extract_member(spec.archive, spec.member, destination)
        session = load_session(destination, session_id=spec.session_id)
        sessions.append(session)
        specs_by_id[spec.session_id] = spec
        print(
            f"  session {spec.session_id:>2}: {session.row_count:>5} rows, "
            f"schema={session.schema}, regions={len(session.annotation_regions)} "
            f"-> {destination.relative_to(REPO_ROOT)}"
        )

    rows_path = PROCESSED_DIR / "normalized_rows.csv"
    total_rows = write_rows_csv(sessions, rows_path)
    print(f"\nWrote {total_rows} normalized rows -> {rows_path.relative_to(REPO_ROOT)}")

    regions = [
        region.to_dict() for session in sessions for region in session.annotation_regions
    ]
    regions_path = PROCESSED_DIR / "annotation_regions.json"
    regions_path.write_text(
        json.dumps(
            {
                "dataset": "RoadSens-4M",
                "subset": "roadpulse-demo",
                "regions": regions,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(regions)} annotation regions -> {regions_path.relative_to(REPO_ROOT)}")

    summaries = [session_summary(specs_by_id[s.session_id], s) for s in sessions]
    summary_path = PROCESSED_DIR / "summary.json"
    summary_path.write_text(
        json.dumps(
            {
                "dataset": "RoadSens-4M",
                "subset": "roadpulse-demo",
                "generated_by": "scripts/prepare_demo_data.py",
                "sessions": summaries,
                "totals": {
                    "rows": total_rows,
                    "annotation_regions": len(regions),
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote summary -> {summary_path.relative_to(REPO_ROOT)}")

    print("\nVerification:")
    ok = True
    for summary in summaries:
        status = "OK" if summary["row_count_ok"] else "MISMATCH"
        if not summary["row_count_ok"]:
            ok = False
        print(
            f"  session {summary['session_id']:>2}: rows "
            f"{summary['row_count']}/{summary['expected_row_count']} [{status}], "
            f"labels={summary['annotation_row_counts'] or '{}'}"
        )
    print(f"\n{'All expected row counts matched.' if ok else 'ROW COUNT MISMATCH DETECTED.'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
