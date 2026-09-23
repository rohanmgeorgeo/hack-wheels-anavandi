"""Load RoadSens-4M session CSVs into a normalized, read-only in-memory form.

The RoadSens-4M source data ships in two column layouts:

* the **45-column anomaly schema** used for the labelled road-anomaly drives.
  It carries GPS (``location_*``), the raw annotation columns
  (``annotation_text`` / ``annotation_millisecond_press_duration``) and a few
  extra uncalibrated sensor channels;
* the **40-column normal schema** used for the unlabelled normal-road drives.
  It has *no* GPS and *no* annotation columns at all.

Missing values are always represented as ``None``. We never fabricate GPS or
annotation values: if a schema simply does not contain those columns, the
corresponding fields stay ``None`` for every row and the session flags report
that the data is unavailable.

Source axis columns are emitted in ``z, y, x`` order. Internally vectors are
stored as ``(x, y, z)`` tuples so the downstream math reads naturally.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

ANOMALY_SCHEMA = "anomaly"
NORMAL_SCHEMA = "normal"

# Column counts for the two known layouts. A mismatch means the source is not
# what we expect, so we stop rather than guess.
EXPECTED_COLUMN_COUNTS = {ANOMALY_SCHEMA: 45, NORMAL_SCHEMA: 40}

# Source column name -> internal (x, y, z) tuple order.
_VECTOR_FIELDS = {
    "accelerometer": ("accelerometer_x", "accelerometer_y", "accelerometer_z"),
    "gravity": ("gravity_x", "gravity_y", "gravity_z"),
    "gyroscope": ("gyroscope_x", "gyroscope_y", "gyroscope_z"),
    "magnetometer": ("magnetometer_x", "magnetometer_y", "magnetometer_z"),
}

GPS_FIELDS = ("location_latitude", "location_longitude", "location_verticalAccuracy")
ANNOTATION_FIELDS = ("annotation_text", "annotation_millisecond_press_duration")

_SESSION_ID_RE = re.compile(r"(\d+)")


def parse_float(value: Optional[str]) -> Optional[float]:
    """Safely parse a CSV cell into ``float``.

    Returns ``None`` for missing/blank cells and for values that cannot be
    parsed, instead of raising or inventing a number.
    """

    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def detect_schema(header: list[str], path: Optional[Path] = None) -> str:
    """Identify which of the two known RoadSens-4M layouts a header uses."""

    column_count = len(header)
    if "annotation_text" in header and "location_latitude" in header:
        schema = ANOMALY_SCHEMA
    elif column_count == EXPECTED_COLUMN_COUNTS[NORMAL_SCHEMA]:
        schema = NORMAL_SCHEMA
    else:
        raise ValueError(
            f"Unrecognised schema for {path or '<stream>'}: "
            f"{column_count} columns, header={header!r}"
        )

    expected = EXPECTED_COLUMN_COUNTS[schema]
    if column_count != expected:
        raise ValueError(
            f"Schema mismatch for {path or '<stream>'}: detected {schema!r} but "
            f"found {column_count} columns (expected {expected})"
        )
    return schema


def infer_session_id(path: Path) -> str:
    """Derive a session id from a filename such as ``session-9-normal.csv``."""

    stem = Path(path).stem
    match = _SESSION_ID_RE.search(stem)
    return match.group(1) if match else stem


def _vector(header: list[str], values: list[str], field_name: str) -> tuple:
    columns = _VECTOR_FIELDS[field_name]
    return tuple(parse_float(values[header.index(col)]) for col in columns)


def _cell(header: list[str], values: list[str], column: str) -> Optional[str]:
    index = header.index(column)
    text = values[index].strip()
    return text or None


@dataclass
class SensorRow:
    """One normalized sensor sample."""

    row_index: int  # 1-based data row number within the session
    seconds_elapsed: Optional[float]
    accelerometer: tuple
    gravity: tuple
    gyroscope: tuple
    magnetometer: tuple
    orientation_roll: Optional[float]
    orientation_pitch: Optional[float]
    orientation_yaw: Optional[float]
    location_latitude: Optional[float]
    location_longitude: Optional[float]
    location_vertical_accuracy: Optional[float]
    annotation_text: Optional[str]
    annotation_millisecond_press_duration: Optional[float]

    @property
    def has_gps(self) -> bool:
        return self.location_latitude is not None and self.location_longitude is not None


@dataclass
class AnnotationRegion:
    """A contiguous run of rows sharing the same source annotation label."""

    session_id: str
    label: str
    start_row: int
    end_row: int
    start_time: Optional[float]
    end_time: Optional[float]
    duration_seconds: Optional[float]
    gps: dict
    press_durations_ms: list

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "label": self.label,
            "start_row": self.start_row,
            "end_row": self.end_row,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "duration_seconds": self.duration_seconds,
            "gps": self.gps,
            "press_durations_ms": self.press_durations_ms,
        }


@dataclass
class Session:
    """A loaded RoadSens-4M session."""

    session_id: str
    source_name: str
    schema: str
    columns: list
    rows: list = field(default_factory=list)
    annotation_regions: list = field(default_factory=list)

    @property
    def row_count(self) -> int:
        return len(self.rows)

    @property
    def gps_available(self) -> bool:
        return all(column in self.columns for column in GPS_FIELDS[:2])

    @property
    def annotation_available(self) -> bool:
        return "annotation_text" in self.columns


def _build_row(header: list[str], values: list[str], row_index: int) -> SensorRow:
    return SensorRow(
        row_index=row_index,
        seconds_elapsed=parse_float(values[header.index("seconds_elapsed")]),
        accelerometer=_vector(header, values, "accelerometer"),
        gravity=_vector(header, values, "gravity"),
        gyroscope=_vector(header, values, "gyroscope"),
        magnetometer=_vector(header, values, "magnetometer"),
        orientation_roll=parse_float(values[header.index("orientation_roll")])
        if "orientation_roll" in header
        else None,
        orientation_pitch=parse_float(values[header.index("orientation_pitch")])
        if "orientation_pitch" in header
        else None,
        orientation_yaw=parse_float(values[header.index("orientation_yaw")])
        if "orientation_yaw" in header
        else None,
        location_latitude=parse_float(values[header.index("location_latitude")])
        if "location_latitude" in header
        else None,
        location_longitude=parse_float(values[header.index("location_longitude")])
        if "location_longitude" in header
        else None,
        location_vertical_accuracy=parse_float(
            values[header.index("location_verticalAccuracy")]
        )
        if "location_verticalAccuracy" in header
        else None,
        annotation_text=_cell(header, values, "annotation_text")
        if "annotation_text" in header
        else None,
        annotation_millisecond_press_duration=parse_float(
            values[header.index("annotation_millisecond_press_duration")]
        )
        if "annotation_millisecond_press_duration" in header
        else None,
    )


def _gps_point(row: SensorRow) -> Optional[dict]:
    if not row.has_gps:
        return None
    return {"latitude": row.location_latitude, "longitude": row.location_longitude}


def parse_annotation_regions(rows: list, session_id: str) -> list:
    """Group contiguous labelled rows into annotation regions.

    A region is a maximal run of consecutive rows that carry the same
    non-empty ``annotation_text``. The source stamps
    ``annotation_millisecond_press_duration`` on the rows that start/end a
    touch annotation, so all values seen inside a region are collected.
    """

    regions: list = []
    builder: Optional[dict] = None

    def flush() -> None:
        nonlocal builder
        if builder is None:
            return
        points = builder["gps_points"]
        start_point = points[0] if points else None
        end_point = points[-1] if points else None
        centroid = None
        if points:
            centroid = {
                "latitude": sum(p["latitude"] for p in points) / len(points),
                "longitude": sum(p["longitude"] for p in points) / len(points),
            }
        start_time = builder["start_time"]
        end_time = builder["end_time"]
        duration = (
            end_time - start_time
            if start_time is not None and end_time is not None
            else None
        )
        regions.append(
            AnnotationRegion(
                session_id=session_id,
                label=builder["label"],
                start_row=builder["start_row"],
                end_row=builder["end_row"],
                start_time=start_time,
                end_time=end_time,
                duration_seconds=duration,
                gps={"start": start_point, "end": end_point, "centroid": centroid},
                press_durations_ms=builder["press_durations_ms"],
            )
        )
        builder = None

    for row in rows:
        if row.annotation_text:
            if (
                builder is not None
                and builder["label"] == row.annotation_text
                and row.row_index == builder["end_row"] + 1
            ):
                builder["end_row"] = row.row_index
                builder["end_time"] = row.seconds_elapsed
                point = _gps_point(row)
                if point:
                    builder["gps_points"].append(point)
            else:
                flush()
                builder = {
                    "label": row.annotation_text,
                    "start_row": row.row_index,
                    "end_row": row.row_index,
                    "start_time": row.seconds_elapsed,
                    "end_time": row.seconds_elapsed,
                    "gps_points": [],
                    "press_durations_ms": [],
                }
                point = _gps_point(row)
                if point:
                    builder["gps_points"].append(point)
            if row.annotation_millisecond_press_duration is not None:
                builder["press_durations_ms"].append(
                    row.annotation_millisecond_press_duration
                )
        else:
            flush()

    flush()
    return regions


def load_session(path, session_id: Optional[str] = None) -> Session:
    """Load one RoadSens-4M CSV file without modifying it."""

    path = Path(path)
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle)
        try:
            header = next(reader)
        except StopIteration as exc:  # pragma: no cover - defensive
            raise ValueError(f"Empty CSV: {path}") from exc
        header = [column.strip() for column in header]
        schema = detect_schema(header, path)

        rows: list = []
        for row_index, values in enumerate(reader, start=1):
            if not values or all(not value.strip() for value in values):
                continue
            if len(values) != len(header):
                raise ValueError(
                    f"{path}: data row {row_index} has {len(values)} values, "
                    f"expected {len(header)}"
                )
            rows.append(_build_row(header, values, row_index))

    if session_id is None:
        session_id = infer_session_id(path)

    regions = (
        parse_annotation_regions(rows, session_id) if schema == ANOMALY_SCHEMA else []
    )
    return Session(
        session_id=session_id,
        source_name=path.name,
        schema=schema,
        columns=header,
        rows=rows,
        annotation_regions=regions,
    )
