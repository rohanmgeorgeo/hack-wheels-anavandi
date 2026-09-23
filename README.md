# RoadPulse

**Passive Road Intelligence from Public Buses.**

RoadPulse turns the everyday motion of public buses into road-condition
intelligence. A bus already carries accelerometers, gyroscopes and GPS; this
project reads that signal and reports **where the road surface disturbs the
vehicle**, without installing any new hardware.

This repository contains the **Hackathon Round 1 vertical slice**: an
explainable Python detector over a small public dataset plus a React
operations dashboard that visualises the detector's real output on a map.

---

## Problem being solved

Road defects — potholes, broken patches, rough stretches and unmarked speed
breakers — are expensive to survey and degrade quickly. Dedicated survey
vehicles are slow to cover a city. Public buses, however, drive every route
every day. RoadPulse treats that existing fleet as a **passive, distributed
road-condition sensing network**.

The first slice is intentionally narrow and honest: detect events from sensor
data, explain why each one was accepted or suppressed, and map the ones that
have real GPS.

---

## Architecture

```
Raw RoadSens-4M CSVs
        │
        ▼
Python preparation pipeline        scripts/prepare_demo_data.py
        │  (load, derive features)
        ▼
Explainable detector               processor/detector.py
        │  events.json + detector_summary.json + replay_sessions.json
        ▼
Local observation store &          scripts/build_observation_store.py
spatial issue association          (SQLite + road_issues.json)
        │
        ▼
React + TypeScript frontend        frontend/
        │  imports the JSON at build time
        ▼
Leaflet / OpenStreetMap map        "GPS Event View" + "Journey Replay"
```

* **No backend, no database server, no authentication.** SQLite is used as a
  local file-based prototype store only.
* The frontend reads the generated JSON directly (build-time import), so the
  whole analytical UI works offline.
* Only the OpenStreetMap basemap tiles need connectivity.

Repository layout:

| Path | Purpose |
| --- | --- |
| `processor/` | Loader, feature derivation and the explainable detector. |
| `scripts/` | `prepare_demo_data.py`, `run_detector.py`, `export_replay_data.py` and `build_observation_store.py`. |
| `data/demo/` | Tracked demo subset, source CSVs and generated `processed/` outputs. |
| `tests/` | Python unit/integration tests. |
| `frontend/` | Vite + React + TypeScript + Leaflet dashboard. |

---

## Dataset attribution

This project uses the **public RoadSens-4M** dataset as raw input. The data was
**not produced by this team**.

* A small, tracked four-session subset is copied under `data/demo/source/`.
* Sessions include annotated anomaly drives (Bump, Pothole) and one normal-road
  drive used to define the baseline.
* The original archives stay local and git-ignored; the preparation step is
  read-only. See `data/demo/README.md` for full provenance.

---

## Setup and run

### 1. Python pipeline (optional — outputs are already committed)

```bash
python3 scripts/prepare_demo_data.py   # normalise the demo subset
python3 scripts/run_detector.py        # writes events.json + detector_summary.json
```

> `prepare_demo_data.py` expects the original archives under `data/extracted/`.
> The generated `data/demo/processed/` files are committed, so the frontend can
> run without them.

Run the Python tests:

```bash
python3 -m unittest discover -s tests -v
```

### 2. Frontend dashboard

```bash
cd frontend
npm install
npm run dev        # development server
```

Other useful commands:

```bash
npm run typecheck  # TypeScript, no emit
npm run build      # production build into frontend/dist
npm run preview    # serve the production build
```

### 3. Journey Replay dataset (optional — already committed)

The **Journey Replay** view plays back a *recorded* RoadSens-4M session; it does
not run the detector in the browser and is never presented as a live bus. Its
dataset is produced by reusing the existing pipeline:

```bash
python3 scripts/export_replay_data.py   # writes replay_sessions.json
```

---

## Journey Replay

A judge-facing playback of one recorded anomaly session (2, 4 or 35), built from
real prepared data and the real detector decisions:

* a replay clock advances the recorded timestamp; the sensor traces update with
  the actual per-sample `vertical_acceleration`, `horizontal_acceleration`,
  `yaw_rate` and rolling vibration RMS;
* when the clock reaches a recorded candidate's timestamp, the card shows the
  **actual** detector decision — `CANDIDATE DETECTED`, then `✓ ACCEPTED` (class,
  severity, confidence) or `✕ SUPPRESSED` (turning / horizontal_motion / noise);
* accepted/suppressed counters grow during playback;
* accepted events with **real** source GPS appear on the map only when their
  recorded time is reached, along the recorded GPS track;
* controls: Play/Pause, Restart and 1x / 4x / 10x speed.

The replay does not fabricate sensor values, GPS or decisions, and does not
simulate a different algorithm. Events without GPS are never plotted.

---

## Detector approach

`processor/detector.py` is deterministic and explainable by design.

1. **Reference baseline.** Every operating threshold is a percentile of a
   rolling "evidence band" measured on the normal-road session — not a magic
   constant.
2. **Impact candidates.** A short-window peak of `|vertical_acceleration|`
   above the candidate threshold is an impact candidate; nearby crossings are
   merged so one physical impact yields one candidate.
3. **Suppression.** Candidates that look like turns, lateral shake or noise are
   flagged with an explicit reason instead of being silently dropped.
4. **Classification.** Pothole vs Bump is a prior-corrected nearest-centroid
   classifier over explainable features (peak magnitude, local RMS, duration,
   rebound). It never copies the source annotation.
5. **Sustained roughness.** A persistence-filtered rolling-RMS heuristic, kept
   separate from individual impacts.
6. **Prototype scores.** Severity and confidence are 0–100 analytical scores,
   **not official road-safety ratings**.

### Three event classes

| Class | Origin | Notes |
| --- | --- | --- |
| **Pothole** | Source-supported RoadSens-4M label | The demo subset currently has **0 accepted potholes**; the true value is displayed, not fabricated. |
| **Bump / Speed Breaker** | Source-supported RoadSens-4M label | Majority class in this subset. |
| **Sustained Roughness** | **Derived heuristic** | Persistent vibration over a run; not a dataset label. |

Normal road is the **baseline state**, never an event class.

---

## False-positive suppression

Before a disturbance is reported as a road-surface event, RoadPulse checks
rotational and horizontal vehicle motion. Suppressed candidates fall into three
auditable reasons:

* **turning** — sustained yaw / rotational activity.
* **horizontal_motion** — lateral/longitudinal shake without matching vertical
  impact evidence.
* **noise** — isolated spike below the accept threshold.

In the current demo subset: **44 accepted events, 98 suppressed candidates**
(turning 2, horizontal motion 30, noise 66).

---

## Known limitations

* **Small subset.** Four sessions only; not representative of the full dataset.
* **Weak Pothole/Bump separation.** On this subset leave-one-out accuracy
  (0.9649) equals the majority-class baseline (0.9649), so the classifier
  defaults to the majority class instead of claiming an unsupported Pothole.
  This is reported in the dashboard, not hidden.
* **No true map matching.** The map plots real GPS points; the optional
  connections are straight event-order lines, **not** road-segment matching.
* **No fabricated GPS.** Events without GPS (the normal-road session) are never
  plotted at invented coordinates.
* **Prototype scores.** Severity and confidence are analytical scores, not
  official ratings.

---

## Local observation store & spatial issue association

RoadPulse now has a deterministic, offline step that turns accepted detector
observations into road-issue evidence:

```bash
python3 scripts/build_observation_store.py
```

It reads the existing `events.json` / `summary.json` (it does **not** re-run or
change the detector) and writes:

* `data/demo/processed/roadpulse.db` — a local **SQLite** prototype store
  (Python standard library `sqlite3`) with `journeys`, `observations`,
  `suppressed_candidates`, `road_issues` and `issue_observations` tables.
* `data/demo/processed/road_issues.json` — a compact aggregation for the next
  dashboard feature.

**Spatial issue clustering** (prototype proximity association, **not**
road-network map matching): accepted observations that have **real GPS** are
grouped when they fall within a single configurable radius
(`ASSOCIATION_RADIUS_METERS = 10.0`, justified by the observed within-session
nearest-neighbour distances of ~2 m and the 208 m minimum cross-session
separation). Each cluster reports a factual `observation_count` and
`distinct_session_count`, plus class counts and severity/confidence summaries
computed from its real members.

Truthfulness rules:

* observations without GPS are stored but **never** enter clustering;
* `distinct_session_count` stays `1` when every member comes from one recorded
  session — that is **not** called cross-session corroboration;
* on the current demo data there are **zero** cross-session clusters, and the
  payload says so explicitly rather than inventing corroboration;
* SQLite here is **local prototype persistence**, not a production database.

---

## Offline behaviour

* The dashboard UI **and** all analytical results render from the local
  detector JSON, with no backend and no network calls.
* **OpenStreetMap tiles require internet connectivity.** If tiles are
  unavailable, the map background may be blank, but the markers, metrics,
  event details and explainability panels still render.

---

## AI-use declaration

* **ChatGPT** — architecture, review and task planning.
* **OpenCode with DeepSeek V4.1 Flash** — implementation assistance.

All detector logic, thresholds and statistics come from the project's own
Python pipeline; no analytical values in the UI are invented.

---

## Current prototype status

Round 2 technical step — **working core, not a finished product**:

* ✅ Explainable Python detector with 67 passing tests.
* ✅ Dashboard with real metrics, GPS event map, event details, suppression and
  transparency panels.
* ✅ Recorded RoadSens Journey Replay (real samples + real detector decisions).
* ✅ Local SQLite observation store and prototype proximity-based spatial issue
  association (`road_issues.json`).
* ✅ Offline-capable analytical UI.
* ⬜ Road-issue screen in the dashboard (next task).
* ⬜ Road-segment map matching.
* ⬜ Live phone sensing and a real fleet backend.
