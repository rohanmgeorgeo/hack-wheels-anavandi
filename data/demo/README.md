# RoadPulse demo subset (RoadSens-4M)

## What this is

This directory holds a **small, tracked demo subset** of the public external
**RoadSens-4M** dataset, plus the compact normalized output that our
preparation pipeline derives from it.

The original data was **not produced by our team**. It is a public external
dataset used here only as raw input for the RoadPulse hackathon prototype
(PS-01 — *Bus Fleet as a Mobile Road-Condition Sensing Network*).

Only a handful of sessions are included so the demo is small, reproducible and
easy to inspect. The full dataset stays local and ignored.

## Source data is untouched

* The RAR archives live under `data/extracted/` and the zips under
  `data/raw/`; both trees are git-ignored and are **never modified**.
* Extraction is read-only: `bsdtar -xOf <archive> <member>` streams a member
  to stdout, and the pipeline writes the copy into `data/demo/source/`.
* `data/demo/` is intentionally *not* git-ignored.

## Selected sessions

| Demo file | Source member | Source archive | Rows | Labels present |
| --- | --- | --- | ---: | --- |
| `source/session-2.csv` | `2.csv` | `Combined CSV with GIS and Weather Data/Road Anomalies/Road Anomalies.rar` | 1,111 | Bump |
| `source/session-4.csv` | `4.csv` | `Combined CSV with GIS and Weather Data/Road Anomalies/Road Anomalies.rar` | 2,549 | Bump, Pothole |
| `source/session-35.csv` | `35.csv` | `Combined CSV with GIS and Weather Data/Road Anomalies/Road Anomalies.rar` | 906 | Pothole |
| `source/session-9-normal.csv` | `9 - Normal Road.csv` | `Combined CSV with GIS and Weather Data/Normal Road (No Annotation)/Normal Road (No Annotation).rar` | 5,214 | none (baseline) |

## How to run

From the repository root:

```bash
python3 scripts/prepare_demo_data.py
```

The script extracts the four sessions above into `data/demo/source/`, then
writes the normalized output into `data/demo/processed/`.

Checks:

```bash
python3 -m unittest discover -s tests -v
```

## Fields used

Source schemas:

* **45-column anomaly schema** (sessions 2, 4, 35): includes GPS
  (`location_latitude`, `location_longitude`, `location_verticalAccuracy`),
  annotation columns (`annotation_text`,
  `annotation_millisecond_press_duration`) and uncalibrated sensor channels.
* **40-column normal schema** (session 9): the same core sensor channels, but
  **no GPS and no annotation columns**.

Preserved / parsed per row:

* `seconds_elapsed`, session id, row index;
* raw `accelerometer_{x,y,z}`, `gravity_{x,y,z}`, `gyroscope_{x,y,z}`
  (source order is `z, y, x`; we normalize to `x, y, z`);
* `location_latitude`, `location_longitude`, `location_verticalAccuracy`
  (anomaly sessions only);
* `annotation_text`, `annotation_millisecond_press_duration`.

Derived per row (documented in `processor/features.py`):

* `acceleration_magnitude` — `|a|`;
* `gravity_magnitude` — `|g|` (quality check, ~9.8 m/s²);
* `vertical_acceleration` — gravity-aligned projection `(a · g) / |g|`;
* `horizontal_acceleration` — `sqrt(|a|² − vertical²)`, a lateral/longitudinal
  proxy since heading is unknown;
* `gyroscope_magnitude` — `|w|`;
* `yaw_rate` — rotation about the gravity axis `(w · g) / |g|`.

Annotation regions are parsed as maximal contiguous runs of rows sharing the
same non-empty `annotation_text`, exposing label, start/end row and time,
duration, session id, GPS (start/end/centroid) and any press durations found.

## Outputs (`processed/`)

* `normalized_rows.csv` — compact long-format table: one row per sensor sample
  with preserved fields and derived features.
* `annotation_regions.json` — the labelled regions with GPS.
* `summary.json` — per-session counts, schema, availability flags and
  verification results.

## Known limitations

* **Subset only.** Four sessions; not representative of the whole dataset.
* **Source labels.** Only **Pothole** and **Bump** are supplied by the source
  dataset.
* **Sustained Roughness is not a supplied label.** It is planned as a
  *derived prototype class* computed later from explainable rolling vibration
  features. It is not present in this output.
* **Normal road is a baseline state, not an event class.**
* **Session 9 (normal road) has no GPS and no annotations** by construction of
  the source schema; those fields are reported as missing (`None`), never
  fabricated.
* `location_verticalAccuracy` is only populated on a small number of rows.
* Units follow the source device: accelerometer/gravity in m/s², gyroscope in
  rad/s.
* This task does **not** perform event detection, map matching, ML training or
  database storage.
