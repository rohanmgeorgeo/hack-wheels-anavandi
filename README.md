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
        │  events.json + detector_summary.json
        ▼
React + TypeScript frontend        frontend/
        │  imports the JSON at build time
        ▼
Leaflet / OpenStreetMap map        "GPS Event View"
```

* **No backend, no database, no authentication.**
* The frontend reads the detector's generated JSON directly (build-time import),
  so the whole analytical UI works offline.
* Only the OpenStreetMap basemap tiles need connectivity.

Repository layout:

| Path | Purpose |
| --- | --- |
| `processor/` | Loader, feature derivation and the explainable detector. |
| `scripts/` | `prepare_demo_data.py` (normalise data) and `run_detector.py` (write outputs). |
| `data/demo/` | Tracked demo subset, source CSVs and generated `processed/` outputs. |
| `tests/` | 38 Python unit/integration tests. |
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

Round 1 vertical slice — **working core, not a finished product**:

* ✅ Explainable Python detector with 38 passing tests.
* ✅ Dashboard with real metrics, GPS event map, event details, suppression and
  transparency panels.
* ✅ Offline-capable analytical UI.
* ⬜ Road-segment map matching.
* ⬜ Live phone sensing and a real fleet backend.
