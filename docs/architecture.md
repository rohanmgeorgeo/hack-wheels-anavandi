# RoadPulse Architecture (Round 2 prototype)

RoadPulse turns the recorded motion of public buses into road-condition
evidence. This document describes what is **implemented now**; future work is
listed separately and is not claimed as working.

## DATA

* **RoadSens-4M** recorded sessions (public dataset, not produced by this team).
* A tracked four-session demo subset lives in `data/demo/source/`:
  anomaly drives (sessions 2, 4, 35) and one normal-road drive (session 9).
* Real GPS exists only in the anomaly sessions. Session 9 has no GPS and no
  annotations and is used as the normal-road calibration reference.

## PIPELINE

```
recorded sensors
  → gravity-relative feature derivation        processor/features.py
  → normal-road calibration (percentile bands) processor/detector.py
  → candidate detection
  → false-positive suppression (turning / horizontal_motion / noise)
  → accepted event  (+ suppressed candidates, kept auditable)
  → local observation store                    scripts/build_observation_store.py
  → proximity association (10 m haversine)     → road_issues.json
  → dashboard
```

Artifacts (all deterministic, offline):

* `events.json` — accepted events + suppressed candidates.
* `detector_summary.json` — thresholds, counts, validation.
* `replay_sessions.json` — per-sample recorded features + real decisions.
* `roadpulse.db` — local SQLite prototype store.
* `road_issues.json` — spatial issue aggregation.

## VIEWS

* **Operations** — accepted GPS events, detector evidence, suppression and
  transparency panels.
* **Journey Replay** — plays back a *recorded* session; real detector decisions
  appear at their recorded times (accepted or suppressed).
* **Road Issues** — proximity-based spatial issue clusters with factual
  observation/session counts.

**Exact traceability:** an accepted event, its replay decision and its spatial
issue are linked only by the stable identity
`obs:<session_id>:<event_class>:<start_row>:<peak_row>`. There is no
nearest-neighbour or fuzzy matching.

## STORAGE

* SQLite via the Python standard library (`sqlite3`) — **local prototype
  persistence**, not a production database and not a server.
* Tables: `journeys`, `observations`, `suppressed_candidates`, `road_issues`,
  `issue_observations`.

## TRUTHFUL LIMITS

* Recorded data replay — **not** live buses.
* **0 cross-session issues** in the current subset; cross-session corroboration
  is a fleet-data capability, not a demonstrated result.
* Proximity association — **not** road-network map matching.
* Severity and confidence are prototype analytical indicators, not official
  road-safety ratings.
* **Sustained Roughness** is a derived heuristic, not a dataset label.
* Current four-session Pothole/Bump separation is weak; the classifier defaults
  to the majority class rather than claiming an unsupported Pothole.
* Events without GPS are stored but never placed on a map or clustered.

## VERIFICATION

```
python3 scripts/verify_round2.py
```

Runs the Python tests, the deterministic store/replay rebuild checks, the
frontend validations, TypeScript typecheck and the production build, then prints
a factual summary derived from the generated JSON.

## NEXT / FUTURE (not implemented)

* Live phone / bus ingestion.
* Genuine repeated-session evidence when source data revisits the same
  locations.
* True road-network map matching.
* Fleet backend and maintenance integration.
