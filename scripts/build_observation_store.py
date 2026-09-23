#!/usr/bin/env python3
"""Build the RoadPulse local observation store and spatial issue aggregation.

This is a deterministic, offline prototype step. It does **not** re-run or
change the detector: it ingests the existing detector output
(``events.json`` / ``summary.json``) and:

1. persists accepted and suppressed observations in a local SQLite database
   (``data/demo/processed/roadpulse.db``);
2. associates accepted observations that have **real** GPS using a simple,
   explainable proximity rule ("spatial issue clustering"); and
3. writes a compact ``data/demo/processed/road_issues.json`` for the next
   dashboard task.

This is **not** true road-network map matching. Observations without GPS are
stored but never enter spatial clustering. No GPS, observations or sessions are
fabricated. ``distinct_session_count`` is factual: if all members of a cluster
come from one recorded session, it stays ``1``.

Run from the repository root:

    python3 scripts/build_observation_store.py
"""

from __future__ import annotations

import csv
import json
import math
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

PROCESSED_DIR = REPO_ROOT / "data" / "demo" / "processed"
DB_PATH = PROCESSED_DIR / "roadpulse.db"
ISSUES_PATH = PROCESSED_DIR / "road_issues.json"

DATASET = "RoadSens-4M"

# --------------------------------------------------------------------------- #
# Single configurable association radius.
#
# Evidence for 10 m (see README / task report):
#   * within-session nearest-neighbour distances have median 1.86 m and p90
#     6.69 m, i.e. repeated detections of the same small road feature are only a
#     few metres apart;
#   * the closest observations from two different recorded sessions are 208 m
#     apart, so 10 m cannot merge different sessions;
#   * consumer GPS horizontal error is typically a few metres.
# The radius is deliberately far smaller than the cross-session separation so
# that no cross-session corroboration can be manufactured by the algorithm.
# --------------------------------------------------------------------------- #
ASSOCIATION_RADIUS_METERS = 10.0
EARTH_RADIUS_METERS = 6371000.0

SCHEMA = """
CREATE TABLE journeys (
    session_id       TEXT PRIMARY KEY,
    dataset          TEXT NOT NULL,
    source           TEXT NOT NULL,
    schema           TEXT,
    row_count        INTEGER,
    gps_available    INTEGER NOT NULL,
    duration_seconds REAL
);

CREATE TABLE observations (
    observation_id  TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES journeys(session_id),
    event_time      REAL,
    event_class     TEXT NOT NULL,
    provenance      TEXT NOT NULL,
    severity_score  REAL NOT NULL,
    confidence_score REAL NOT NULL,
    latitude        REAL,
    longitude       REAL,
    start_row       INTEGER,
    end_row         INTEGER,
    peak_row        INTEGER,
    evidence_json   TEXT NOT NULL
);

CREATE TABLE suppressed_candidates (
    candidate_id      TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL REFERENCES journeys(session_id),
    event_time        REAL,
    suppression_reason TEXT NOT NULL,
    severity_score    REAL,
    confidence_score  REAL,
    start_row         INTEGER,
    end_row           INTEGER,
    peak_row          INTEGER,
    evidence_json     TEXT NOT NULL
);

CREATE TABLE road_issues (
    issue_id               TEXT PRIMARY KEY,
    center_latitude        REAL NOT NULL,
    center_longitude       REAL NOT NULL,
    anchor_latitude        REAL NOT NULL,
    anchor_longitude       REAL NOT NULL,
    observation_count      INTEGER NOT NULL,
    distinct_session_count INTEGER NOT NULL,
    first_observation_time REAL,
    last_observation_time  REAL,
    class_counts_json      TEXT NOT NULL,
    severity_mean          REAL,
    severity_max           REAL,
    confidence_mean        REAL,
    confidence_max         REAL
);

CREATE TABLE issue_observations (
    issue_id       TEXT NOT NULL REFERENCES road_issues(issue_id),
    observation_id TEXT NOT NULL REFERENCES observations(observation_id),
    PRIMARY KEY (issue_id, observation_id)
);

CREATE INDEX idx_observations_session ON observations(session_id);
CREATE INDEX idx_suppressed_session ON suppressed_candidates(session_id);
CREATE INDEX idx_issue_observations_obs ON issue_observations(observation_id);
"""


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #
def haversine_meters(
    latitude_a: float,
    longitude_a: float,
    latitude_b: float,
    longitude_b: float,
) -> float:
    """Great-circle distance between two points, in metres."""

    lat_a = math.radians(latitude_a)
    lat_b = math.radians(latitude_b)
    delta_lat = lat_b - lat_a
    delta_lon = math.radians(longitude_b - longitude_a)
    h = (
        math.sin(delta_lat / 2.0) ** 2
        + math.cos(lat_a) * math.cos(lat_b) * math.sin(delta_lon / 2.0) ** 2
    )
    return 2.0 * EARTH_RADIUS_METERS * math.asin(min(1.0, math.sqrt(h)))


# --------------------------------------------------------------------------- #
# Identifiers and ingestion
# --------------------------------------------------------------------------- #
def _peak_suffix(peak_row) -> str:
    return "x" if peak_row is None else str(peak_row)


def observation_id(session_id: str, event_class: str, start_row: int, peak_row) -> str:
    return f"obs:{session_id}:{event_class}:{start_row}:{_peak_suffix(peak_row)}"


def candidate_id(session_id: str, start_row: int, peak_row) -> str:
    return f"sup:{session_id}:{start_row}:{_peak_suffix(peak_row)}"


def _event_time(record: dict):
    if record.get("peak_time") is not None:
        return record["peak_time"]
    return record.get("start_time")


def _evidence_json(evidence: dict) -> str:
    return json.dumps(evidence or {}, sort_keys=True, separators=(",", ":"))


def build_observations(events_payload: dict) -> list:
    """Accepted detector events -> observation rows (GPS may be null)."""

    observations = []
    for event in events_payload["events"]:
        gps = event.get("gps") or {}
        observations.append(
            {
                "observation_id": observation_id(
                    event["session_id"],
                    event["class"],
                    event["start_row"],
                    event["peak_row"],
                ),
                "session_id": event["session_id"],
                "event_time": _event_time(event),
                "event_class": event["class"],
                "provenance": event["provenance"],
                "severity_score": event["severity_score"],
                "confidence_score": event["confidence_score"],
                "latitude": gps.get("latitude"),
                "longitude": gps.get("longitude"),
                "start_row": event["start_row"],
                "end_row": event["end_row"],
                "peak_row": event["peak_row"],
                "evidence_json": _evidence_json(event.get("evidence", {})),
            }
        )
    return observations


def build_suppressed(events_payload: dict) -> list:
    """Suppressed detector candidates -> rows (kept distinct from accepted)."""

    suppressed = []
    for candidate in events_payload["suppressed_candidates"]:
        suppressed.append(
            {
                "candidate_id": candidate_id(
                    candidate["session_id"],
                    candidate["start_row"],
                    candidate["peak_row"],
                ),
                "session_id": candidate["session_id"],
                "event_time": _event_time(candidate),
                "suppression_reason": candidate["suppression_reason"],
                "severity_score": candidate.get("severity_score", 0.0),
                "confidence_score": candidate.get("confidence_score", 0.0),
                "start_row": candidate["start_row"],
                "end_row": candidate["end_row"],
                "peak_row": candidate["peak_row"],
                "evidence_json": _evidence_json(candidate.get("evidence", {})),
            }
        )
    return suppressed


def _session_durations(rows_path: Path) -> dict:
    """Real recorded duration per session from the prepared normalized rows."""

    if not rows_path.exists():
        return {}
    bounds: dict = {}
    with rows_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            session_id = row.get("session_id")
            raw = row.get("seconds_elapsed")
            if not session_id or not raw:
                continue
            try:
                value = float(raw)
            except ValueError:
                continue
            low, high = bounds.get(session_id, (value, value))
            bounds[session_id] = (min(low, value), max(high, value))
    return {
        session_id: round(high - low, 6) for session_id, (low, high) in bounds.items()
    }


def load_journeys(processed_dir: Path, summary_payload: dict) -> list:
    durations = _session_durations(processed_dir / "normalized_rows.csv")
    journeys = []
    for session in summary_payload["sessions"]:
        journeys.append(
            {
                "session_id": session["session_id"],
                "dataset": DATASET,
                "source": DATASET,
                "schema": session.get("schema"),
                "row_count": session.get("row_count"),
                "gps_available": 1 if session.get("gps_available") else 0,
                "duration_seconds": durations.get(session["session_id"]),
            }
        )
    return journeys


# --------------------------------------------------------------------------- #
# Spatial issue clustering (proximity anchor / leader algorithm)
# --------------------------------------------------------------------------- #
def cluster_observations(observations: list, radius_meters: float) -> list:
    """Deterministic proximity clustering of accepted observations with GPS.

    Algorithm (explainable, no ML):
      * keep only observations with real latitude/longitude;
      * process them in a stable order ``(session_id, start_row)``;
      * assign an observation to the first existing cluster whose **anchor**
        (its first member's real coordinate) is within ``radius_meters``;
      * otherwise start a new cluster anchored at that observation.

    The anchor is an actual observed coordinate, so every member is provably
    within ``radius_meters`` of its cluster anchor. The reported centre is the
    arithmetic mean of the real member coordinates.
    """

    spatial = [
        observation
        for observation in observations
        if observation["latitude"] is not None and observation["longitude"] is not None
    ]
    spatial.sort(key=lambda item: (item["session_id"], item["start_row"]))

    clusters: list = []
    for observation in spatial:
        placed = False
        for cluster in clusters:
            distance = haversine_meters(
                observation["latitude"],
                observation["longitude"],
                cluster["anchor_latitude"],
                cluster["anchor_longitude"],
            )
            if distance <= radius_meters:
                cluster["members"].append(observation)
                placed = True
                break
        if not placed:
            clusters.append(
                {
                    "anchor_latitude": observation["latitude"],
                    "anchor_longitude": observation["longitude"],
                    "members": [observation],
                }
            )
    return clusters


def build_issues(observations: list, radius_meters: float) -> list:
    clusters = cluster_observations(observations, radius_meters)
    clusters.sort(
        key=lambda cluster: (
            cluster["members"][0]["session_id"],
            cluster["members"][0]["start_row"],
        )
    )

    issues = []
    for index, cluster in enumerate(clusters, start=1):
        members = cluster["members"]
        latitudes = [member["latitude"] for member in members]
        longitudes = [member["longitude"] for member in members]
        sessions = sorted({member["session_id"] for member in members})
        times = [member["event_time"] for member in members if member["event_time"] is not None]
        severities = [member["severity_score"] for member in members]
        confidences = [member["confidence_score"] for member in members]

        class_counts: dict = {}
        for member in members:
            class_counts[member["event_class"]] = (
                class_counts.get(member["event_class"], 0) + 1
            )

        issues.append(
            {
                "issue_id": f"issue-{index:04d}",
                "center_latitude": round(sum(latitudes) / len(latitudes), 6),
                "center_longitude": round(sum(longitudes) / len(longitudes), 6),
                "anchor_latitude": round(cluster["anchor_latitude"], 6),
                "anchor_longitude": round(cluster["anchor_longitude"], 6),
                "observation_count": len(members),
                "distinct_session_count": len(sessions),
                "session_ids": sessions,
                "first_observation_time": round(min(times), 6) if times else None,
                "last_observation_time": round(max(times), 6) if times else None,
                "class_counts": class_counts,
                "severity_mean": round(sum(severities) / len(severities), 4),
                "severity_max": round(max(severities), 4),
                "confidence_mean": round(sum(confidences) / len(confidences), 4),
                "confidence_max": round(max(confidences), 4),
                "members": members,
            }
        )
    return issues


def _min_cross_session_distance(observations: list):
    spatial = [
        observation
        for observation in observations
        if observation["latitude"] is not None and observation["longitude"] is not None
    ]
    best = None
    for i in range(len(spatial)):
        for j in range(i + 1, len(spatial)):
            if spatial[i]["session_id"] == spatial[j]["session_id"]:
                continue
            distance = haversine_meters(
                spatial[i]["latitude"],
                spatial[i]["longitude"],
                spatial[j]["latitude"],
                spatial[j]["longitude"],
            )
            if best is None or distance < best:
                best = distance
    return None if best is None else round(best, 2)


def summarize(observations: list, suppressed: list, issues: list, radius_meters: float) -> dict:
    accepted_gps = [
        observation
        for observation in observations
        if observation["latitude"] is not None and observation["longitude"] is not None
    ]
    size_distribution: dict = {}
    for issue in issues:
        key = str(issue["observation_count"])
        size_distribution[key] = size_distribution.get(key, 0) + 1

    multi_observation = sum(1 for issue in issues if issue["observation_count"] > 1)
    multi_session = sum(
        1 for issue in issues if issue["distinct_session_count"] > 1
    )
    combinations: dict = {}
    for issue in issues:
        if issue["distinct_session_count"] > 1:
            key = "+".join(issue["session_ids"])
            combinations[key] = combinations.get(key, 0) + 1

    min_cross = _min_cross_session_distance(observations)
    if multi_session == 0:
        cross_note = (
            "No cross-session spatial clusters exist at "
            f"{radius_meters:.1f} m. Closest observations from different recorded "
            f"sessions are {min_cross:.2f} m apart, far beyond the radius. All "
            "clusters therefore come from a single recorded session; cross-session "
            "corroboration is not claimed."
            if min_cross is not None
            else "No cross-session spatial clusters exist; only one session has GPS "
            "observations."
        )
    else:
        cross_note = (
            f"{multi_session} cluster(s) contain observations from more than one "
            "recorded session at the configured radius. These are reported as "
            "distinct recorded sessions, not as separate buses."
        )

    return {
        "accepted_observations_total": len(observations),
        "accepted_gps_observations": len(accepted_gps),
        "accepted_without_gps": len(observations) - len(accepted_gps),
        "suppressed_candidates_total": len(suppressed),
        "issue_count": len(issues),
        "multi_observation_issue_count": multi_observation,
        "multi_session_issue_count": multi_session,
        "cluster_size_distribution": size_distribution,
        "session_combinations": combinations,
        "min_cross_session_distance_meters": min_cross,
        "cross_session_note": cross_note,
    }


# --------------------------------------------------------------------------- #
# Output
# --------------------------------------------------------------------------- #
def _public_issue(issue: dict) -> dict:
    return {
        "issue_id": issue["issue_id"],
        "center": {
            "latitude": issue["center_latitude"],
            "longitude": issue["center_longitude"],
        },
        "anchor": {
            "latitude": issue["anchor_latitude"],
            "longitude": issue["anchor_longitude"],
        },
        "observation_count": issue["observation_count"],
        "distinct_session_count": issue["distinct_session_count"],
        "session_ids": issue["session_ids"],
        "class_counts": issue["class_counts"],
        "severity": {"mean": issue["severity_mean"], "max": issue["severity_max"]},
        "confidence": {
            "mean": issue["confidence_mean"],
            "max": issue["confidence_max"],
        },
        "first_observation_time": issue["first_observation_time"],
        "last_observation_time": issue["last_observation_time"],
        "observations": [
            {
                "observation_id": member["observation_id"],
                "session_id": member["session_id"],
                "event_class": member["event_class"],
                "event_time": member["event_time"],
                "provenance": member["provenance"],
                "severity_score": member["severity_score"],
                "confidence_score": member["confidence_score"],
                "latitude": member["latitude"],
                "longitude": member["longitude"],
                "start_row": member["start_row"],
                "peak_row": member["peak_row"],
            }
            for member in issue["members"]
        ],
    }


def build_payload(journeys: list, observations: list, suppressed: list, issues: list, radius_meters: float) -> dict:
    return {
        "dataset": DATASET,
        "association_method": {
            "type": "proximity_anchor_cluster",
            "distance_metric": "haversine",
            "radius_meters": radius_meters,
            "clusters_accepted_gps_only": True,
            "note": (
                "Prototype proximity-based issue association. Nearby accepted "
                "observations with real GPS may share a spatial issue cluster. "
                "This is not road-network map matching and does not prove that "
                "different buses observed the same issue."
            ),
        },
        "summary": summarize(observations, suppressed, issues, radius_meters),
        "issues": [_public_issue(issue) for issue in issues],
    }


def write_database(
    db_path: Path,
    journeys: list,
    observations: list,
    suppressed: list,
    issues: list,
) -> None:
    """Create a fresh, deterministic database at ``db_path`` (idempotent)."""

    if db_path.exists():
        db_path.unlink()
    connection = sqlite3.connect(db_path)
    try:
        with connection:
            connection.executescript(SCHEMA)
            connection.executemany(
                "INSERT INTO journeys (session_id, dataset, source, schema, "
                "row_count, gps_available, duration_seconds) VALUES (?,?,?,?,?,?,?)",
                [
                    (
                        journey["session_id"],
                        journey["dataset"],
                        journey["source"],
                        journey["schema"],
                        journey["row_count"],
                        journey["gps_available"],
                        journey["duration_seconds"],
                    )
                    for journey in journeys
                ],
            )
            connection.executemany(
                "INSERT INTO observations (observation_id, session_id, event_time, "
                "event_class, provenance, severity_score, confidence_score, "
                "latitude, longitude, start_row, end_row, peak_row, evidence_json) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [
                    (
                        item["observation_id"],
                        item["session_id"],
                        item["event_time"],
                        item["event_class"],
                        item["provenance"],
                        item["severity_score"],
                        item["confidence_score"],
                        item["latitude"],
                        item["longitude"],
                        item["start_row"],
                        item["end_row"],
                        item["peak_row"],
                        item["evidence_json"],
                    )
                    for item in observations
                ],
            )
            connection.executemany(
                "INSERT INTO suppressed_candidates (candidate_id, session_id, "
                "event_time, suppression_reason, severity_score, confidence_score, "
                "start_row, end_row, peak_row, evidence_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
                [
                    (
                        item["candidate_id"],
                        item["session_id"],
                        item["event_time"],
                        item["suppression_reason"],
                        item["severity_score"],
                        item["confidence_score"],
                        item["start_row"],
                        item["end_row"],
                        item["peak_row"],
                        item["evidence_json"],
                    )
                    for item in suppressed
                ],
            )
            for issue in issues:
                connection.execute(
                    "INSERT INTO road_issues (issue_id, center_latitude, "
                    "center_longitude, anchor_latitude, anchor_longitude, "
                    "observation_count, distinct_session_count, "
                    "first_observation_time, last_observation_time, "
                    "class_counts_json, severity_mean, severity_max, "
                    "confidence_mean, confidence_max) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        issue["issue_id"],
                        issue["center_latitude"],
                        issue["center_longitude"],
                        issue["anchor_latitude"],
                        issue["anchor_longitude"],
                        issue["observation_count"],
                        issue["distinct_session_count"],
                        issue["first_observation_time"],
                        issue["last_observation_time"],
                        json.dumps(issue["class_counts"], sort_keys=True, separators=(",", ":")),
                        issue["severity_mean"],
                        issue["severity_max"],
                        issue["confidence_mean"],
                        issue["confidence_max"],
                    ),
                )
                connection.executemany(
                    "INSERT INTO issue_observations (issue_id, observation_id) VALUES (?,?)",
                    [
                        (issue["issue_id"], member["observation_id"])
                        for member in issue["members"]
                    ],
                )
    finally:
        connection.close()


def build_all(processed_dir: Path = PROCESSED_DIR, radius_meters: float = ASSOCIATION_RADIUS_METERS) -> dict:
    """Pure build: returns journeys, observations, suppressed, issues and payload."""

    events_payload = json.loads((processed_dir / "events.json").read_text(encoding="utf-8"))
    summary_payload = json.loads((processed_dir / "summary.json").read_text(encoding="utf-8"))

    journeys = load_journeys(processed_dir, summary_payload)
    observations = build_observations(events_payload)
    suppressed = build_suppressed(events_payload)
    issues = build_issues(observations, radius_meters)
    payload = build_payload(journeys, observations, suppressed, issues, radius_meters)
    return {
        "journeys": journeys,
        "observations": observations,
        "suppressed": suppressed,
        "issues": issues,
        "payload": payload,
    }


def main() -> int:
    built = build_all()
    payload = built["payload"]

    write_database(
        DB_PATH,
        built["journeys"],
        built["observations"],
        built["suppressed"],
        built["issues"],
    )
    ISSUES_PATH.write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )

    summary = payload["summary"]
    print(f"Wrote database      -> {DB_PATH.relative_to(REPO_ROOT)}")
    print(f"Wrote issue payload -> {ISSUES_PATH.relative_to(REPO_ROOT)}")
    print("Observations:")
    print(f"  accepted total        {summary['accepted_observations_total']}")
    print(f"  accepted with GPS     {summary['accepted_gps_observations']}")
    print(f"  accepted without GPS  {summary['accepted_without_gps']}")
    print(f"  suppressed candidates {summary['suppressed_candidates_total']}")
    print("Spatial issues:")
    print(f"  radius                {payload['association_method']['radius_meters']} m")
    print(f"  issue count           {summary['issue_count']}")
    print(f"  multi-observation     {summary['multi_observation_issue_count']}")
    print(f"  multi-session         {summary['multi_session_issue_count']}")
    print(f"  size distribution     {summary['cluster_size_distribution']}")
    print(f"  session combinations  {summary['session_combinations']}")
    print(f"  note                  {summary['cross_session_note']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
