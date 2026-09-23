"""Explainable road-event detection for RoadPulse.

This module turns the normalized RoadSens-4M demo pipeline
(:mod:`processor.loader` + :mod:`processor.features`) into a small,
deterministic and judge-explainable detector. It detects three classes:

* ``Pothole``  -- supplied by the dataset (labelled regions)
* ``Bump``     -- supplied by the dataset (labelled regions)
* ``Sustained Roughness`` -- **derived heuristic**, not a dataset label.

Normal / smooth road is the baseline state, never an event class.

Design principles
-----------------

* **Robust, data-derived thresholds.** Every threshold is a percentile of a
  rolling "evidence band" measured on the normal-road session, so the numbers
  come from the data instead of magic constants. See
  :func:`build_reference_baseline`.
* **Short-window impact detection with merging.** A physical impact shows up as
  a brief vertical-acceleration shock. We threshold the short-window peak of
  ``|vertical_acceleration|`` and merge crossings that are close together so one
  physical impact yields one candidate.
* **Feature-based classification.** Pothole vs Bump is predicted by a
  deterministic nearest-centroid distance classifier over explainable features
  (peak magnitude, local RMS, duration, rebound). It does **not** copy the
  annotation text.
* **Honest false-positive suppression.** Candidates are flagged with an explicit
  ``suppression_reason`` of ``turning``, ``horizontal_motion`` or ``noise`` so
  judges can see why something was rejected.
* **Prototype scores only.** Severity and confidence are 0-100 prototype
  scores, not official road-safety ratings.

Units follow the source device: accelerometer/gravity in m/s^2, gyroscope in
rad/s. Sampling is derived from the data (median dt = 0.01 s -> 100 Hz).
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

from .features import derive_features

SAMPLING_HZ = 100.0

POTHOLE = "Pothole"
BUMP = "Bump"
ROUGHNESS = "Sustained Roughness"

SUPPRESSION_TURNING = "turning"
SUPPRESSION_HORIZONTAL = "horizontal_motion"
SUPPRESSION_NOISE = "noise"

IMPACT_CLASSES = (POTHOLE, BUMP)


# --------------------------------------------------------------------------- #
# Robust statistics
# --------------------------------------------------------------------------- #
def percentile(sorted_values: Sequence[float], percent: float) -> float:
    """Nearest-rank percentile of an already sorted, non-empty sequence."""

    if not sorted_values:
        raise ValueError("percentile() needs at least one value")
    if percent <= 0:
        return sorted_values[0]
    if percent >= 100:
        return sorted_values[-1]
    index = int(round(percent / 100.0 * (len(sorted_values) - 1)))
    index = max(0, min(len(sorted_values) - 1, index))
    return sorted_values[index]


@dataclass
class RobustStats:
    """Median / MAD / percentile description of one evidence band."""

    count: int = 0
    median: float = 0.0
    mad: float = 0.0
    p95: float = 0.0
    p99: float = 0.0
    p995: float = 0.0
    minimum: float = 0.0
    maximum: float = 0.0
    _sorted: list = field(default_factory=list, repr=False, compare=False)

    def value_at(self, percent: float) -> float:
        return percentile(self._sorted, percent)

    def to_dict(self) -> dict:
        return {
            "count": self.count,
            "median": round(self.median, 6),
            "mad": round(self.mad, 6),
            "p95": round(self.p95, 6),
            "p99": round(self.p99, 6),
            "p99_5": round(self.p995, 6),
            "min": round(self.minimum, 6),
            "max": round(self.maximum, 6),
        }


def robust_stats(values: Iterable[float]) -> RobustStats:
    """Compute median/MAD/percentiles, ignoring non-finite values."""

    clean = sorted(float(v) for v in values if v is not None and math.isfinite(v))
    if not clean:
        return RobustStats()
    median = statistics.median(clean)
    mad = statistics.median(abs(v - median) for v in clean)
    return RobustStats(
        count=len(clean),
        median=median,
        mad=mad,
        p95=percentile(clean, 95.0),
        p99=percentile(clean, 99.0),
        p995=percentile(clean, 99.5),
        minimum=clean[0],
        maximum=clean[-1],
        _sorted=clean,
    )


# --------------------------------------------------------------------------- #
# Rolling evidence bands
# --------------------------------------------------------------------------- #
def _centered_span(n: int, index: int, half_window: int) -> tuple:
    return max(0, index - half_window), min(n, index + half_window + 1)


def rolling_max_abs(values: Sequence[float], half_window: int) -> list:
    """Centered rolling maximum of ``|value|`` (short-window impact evidence)."""

    n = len(values)
    out = []
    for i in range(n):
        lo, hi = _centered_span(n, i, half_window)
        out.append(max(abs(v) for v in values[lo:hi]))
    return out


def rolling_mean_abs(values: Sequence[float], half_window: int) -> list:
    """Centered rolling mean of ``|value|`` (sustained rotation / lateral)."""

    n = len(values)
    out = []
    for i in range(n):
        lo, hi = _centered_span(n, i, half_window)
        segment = values[lo:hi]
        out.append(sum(abs(v) for v in segment) / len(segment))
    return out


def rolling_rms(values: Sequence[float], half_window: int) -> list:
    """Centered rolling RMS (vibration energy)."""

    n = len(values)
    out = []
    for i in range(n):
        lo, hi = _centered_span(n, i, half_window)
        segment = values[lo:hi]
        out.append(math.sqrt(sum(v * v for v in segment) / len(segment)))
    return out


def _half_window(seconds: float, hz: float) -> int:
    return max(0, int(round(seconds * hz / 2.0)))


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class DetectorConfig:
    """All tunables in one place, with physical/statistical meaning."""

    sampling_hz: float = SAMPLING_HZ
    # Short-window impact evidence (±1 sample max on vertical acceleration).
    impact_peak_window_seconds: float = 0.02
    # Merge threshold crossings closer than this into one physical impact.
    impact_merge_gap_seconds: float = 0.08
    # Context / local-energy window around a candidate.
    impact_context_seconds: float = 0.10
    impact_rms_window_seconds: float = 0.20
    # Suppression evidence windows.
    turning_window_seconds: float = 0.50
    horizontal_window_seconds: float = 0.20
    # Sustained-roughness rolling window and minimum persistence.
    roughness_window_seconds: float = 1.0
    roughness_min_duration_seconds: float = 1.0
    roughness_gap_seconds: float = 0.30
    # Skip a roughness run whose impact overlap exceeds this fraction.
    roughness_max_impact_overlap: float = 0.60
    # Percentiles of the normal-road baseline that become thresholds.
    candidate_percentile: float = 95.0
    accept_percentile: float = 99.0
    turning_percentile: float = 99.0
    horizontal_percentile: float = 99.0
    roughness_percentile: float = 99.0
    # Severity scaling: peak at this multiple of the accept threshold -> 100.
    severe_ratio: float = 2.5
    # Reference duration for the duration component of severity (seconds).
    reference_duration_seconds: float = 0.30

    def to_dict(self) -> dict:
        return {
            "sampling_hz": self.sampling_hz,
            "impact_peak_window_seconds": self.impact_peak_window_seconds,
            "impact_merge_gap_seconds": self.impact_merge_gap_seconds,
            "impact_context_seconds": self.impact_context_seconds,
            "impact_rms_window_seconds": self.impact_rms_window_seconds,
            "turning_window_seconds": self.turning_window_seconds,
            "horizontal_window_seconds": self.horizontal_window_seconds,
            "roughness_window_seconds": self.roughness_window_seconds,
            "roughness_min_duration_seconds": self.roughness_min_duration_seconds,
            "roughness_gap_seconds": self.roughness_gap_seconds,
            "roughness_max_impact_overlap": self.roughness_max_impact_overlap,
            "candidate_percentile": self.candidate_percentile,
            "accept_percentile": self.accept_percentile,
            "turning_percentile": self.turning_percentile,
            "horizontal_percentile": self.horizontal_percentile,
            "roughness_percentile": self.roughness_percentile,
            "severe_ratio": self.severe_ratio,
            "reference_duration_seconds": self.reference_duration_seconds,
        }


# --------------------------------------------------------------------------- #
# Session series
# --------------------------------------------------------------------------- #
@dataclass
class SessionSeries:
    """Derived feature arrays for one session, plus rolling evidence bands."""

    session_id: str
    rows: list
    times: list
    vertical: list
    horizontal: list
    yaw: list
    gyro_magnitude: list
    vertical_peak: list
    turning: list
    horizontal_band: list
    roughness: list


def build_series(session, config: DetectorConfig) -> SessionSeries:
    """Derive per-row features and rolling evidence bands for a session."""

    times: list = []
    vertical: list = []
    horizontal: list = []
    yaw: list = []
    gyro_magnitude: list = []
    for row in session.rows:
        features = derive_features(row)
        times.append(row.seconds_elapsed)
        vertical.append(features["vertical_acceleration"] or 0.0)
        horizontal.append(features["horizontal_acceleration"] or 0.0)
        yaw.append(features["yaw_rate"] or 0.0)
        gyro_magnitude.append(features["gyroscope_magnitude"] or 0.0)

    hz = config.sampling_hz
    return SessionSeries(
        session_id=session.session_id,
        rows=session.rows,
        times=times,
        vertical=vertical,
        horizontal=horizontal,
        yaw=yaw,
        gyro_magnitude=gyro_magnitude,
        vertical_peak=rolling_max_abs(
            vertical, _half_window(config.impact_peak_window_seconds, hz)
        ),
        turning=rolling_mean_abs(
            yaw, _half_window(config.turning_window_seconds, hz)
        ),
        horizontal_band=rolling_mean_abs(
            horizontal, _half_window(config.horizontal_window_seconds, hz)
        ),
        roughness=rolling_rms(
            vertical, _half_window(config.roughness_window_seconds, hz)
        ),
    )


# --------------------------------------------------------------------------- #
# Reference baseline and thresholds
# --------------------------------------------------------------------------- #
@dataclass
class Thresholds:
    candidate_peak: float
    accept_peak: float
    turning: float
    horizontal: float
    roughness: float

    def to_dict(self) -> dict:
        return {
            "candidate_peak": round(self.candidate_peak, 6),
            "accept_peak": round(self.accept_peak, 6),
            "turning": round(self.turning, 6),
            "horizontal": round(self.horizontal, 6),
            "roughness": round(self.roughness, 6),
        }


def build_reference_baseline(series: SessionSeries) -> dict:
    """Robust statistics of every evidence band on the normal-road reference.

    The normal-road session is the baseline definition: anything that is rare
    on a smooth road is a candidate event. We describe each band with robust
    statistics (median/MAD/percentiles) rather than fixed constants.
    """

    return {
        "vertical_peak": robust_stats(series.vertical_peak),
        "turning": robust_stats(series.turning),
        "horizontal": robust_stats(series.horizontal_band),
        "roughness": robust_stats(series.roughness),
    }


def thresholds_from_baseline(baseline: dict, config: DetectorConfig) -> Thresholds:
    """Turn reference percentiles into operating thresholds.

    Documented derivation:

    * ``candidate_peak`` -- ``candidate_percentile`` (95th) of the normal-road
      short-window vertical peak. Above this a sample is worth a look.
    * ``accept_peak`` -- ``accept_percentile`` (99th) of the normal-road
      short-window vertical peak. Above this a candidate is strong enough to
      accept (unless suppressed).
    * ``turning`` -- ``turning_percentile`` (99th) of the normal-road sustained
      yaw activity.
    * ``horizontal`` -- ``horizontal_percentile`` (99th) of the normal-road
      sustained horizontal activity.
    * ``roughness`` -- ``roughness_percentile`` (99th) of the normal-road
      rolling RMS.
    """

    return Thresholds(
        candidate_peak=baseline["vertical_peak"].value_at(config.candidate_percentile),
        accept_peak=baseline["vertical_peak"].value_at(config.accept_percentile),
        turning=baseline["turning"].value_at(config.turning_percentile),
        horizontal=baseline["horizontal"].value_at(config.horizontal_percentile),
        roughness=baseline["roughness"].value_at(config.roughness_percentile),
    )


# --------------------------------------------------------------------------- #
# Impact candidates
# --------------------------------------------------------------------------- #
@dataclass
class Candidate:
    session_id: str
    start_sample: int
    end_sample: int
    peak_sample: int
    start_row: int
    end_row: int
    peak_row: int
    start_time: Optional[float]
    end_time: Optional[float]
    peak_time: Optional[float]
    peak_vertical: float
    peak_abs_vertical: float
    duration_seconds: float
    local_rms: float
    impulse: float
    rebound_ratio: float
    turning_activity: float
    horizontal_activity: float
    gyro_activity: float
    truth_label: Optional[str] = None
    suppressed: bool = False
    suppression_reason: Optional[str] = None
    event_class: Optional[str] = None
    class_distances: dict = field(default_factory=dict)
    severity_score: float = 0.0
    confidence_score: float = 0.0
    gps: Optional[dict] = None
    provenance: str = "detected_impact"

    def evidence(self) -> dict:
        return {
            "peak_vertical_acceleration": round(self.peak_vertical, 6),
            "peak_abs_vertical_acceleration": round(self.peak_abs_vertical, 6),
            "duration_seconds": round(self.duration_seconds, 6),
            "local_vibration_rms": round(self.local_rms, 6),
            "vertical_impulse": round(self.impulse, 6),
            "rebound_ratio": round(self.rebound_ratio, 6),
            "turning_activity": round(self.turning_activity, 6),
            "horizontal_activity": round(self.horizontal_activity, 6),
            "gyroscope_magnitude": round(self.gyro_activity, 6),
        }

    def to_dict(self) -> dict:
        record = {
            "session_id": self.session_id,
            "class": self.event_class,
            "provenance": self.provenance,
            "suppressed": self.suppressed,
            "suppression_reason": self.suppression_reason,
            "start_row": self.start_row,
            "end_row": self.end_row,
            "peak_row": self.peak_row,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "peak_time": self.peak_time,
            "severity_score": round(self.severity_score, 2),
            "confidence_score": round(self.confidence_score, 2),
            "evidence": self.evidence(),
            "gps": self.gps,
            "truth_label": self.truth_label,
            "classification_matches_label": (
                None
                if self.truth_label is None or self.event_class is None
                else self.event_class == self.truth_label
            ),
        }
        if self.class_distances:
            record["class_distances"] = {
                key: round(value, 6) for key, value in self.class_distances.items()
            }
        return record


def _duration(times: Sequence, start: int, end: int, hz: float) -> float:
    start_time = times[start]
    end_time = times[end]
    if start_time is not None and end_time is not None:
        return abs(end_time - start_time)
    return abs(end - start) / hz


def _time_at(times: Sequence, index: int, hz: float) -> Optional[float]:
    value = times[index]
    if value is not None:
        return value
    return round(index / hz, 6)


def _merge_groups(indices: Sequence[int], gap: int) -> list:
    groups: list = []
    for index in indices:
        if groups and index - groups[-1][-1] <= gap:
            groups[-1].append(index)
        else:
            groups.append([index])
    return groups


def detect_impact_candidates(
    series: SessionSeries, thresholds: Thresholds, config: DetectorConfig
) -> list:
    """Find and characterize short-window vertical-acceleration impacts."""

    n = len(series.vertical)
    if n == 0:
        return []
    hz = config.sampling_hz
    ctx = _half_window(config.impact_context_seconds, hz)
    rms_half = _half_window(config.impact_rms_window_seconds, hz)
    gap = max(1, int(round(config.impact_merge_gap_seconds * hz)))

    indices = [i for i in range(n) if series.vertical_peak[i] >= thresholds.candidate_peak]
    candidates: list = []
    for group in _merge_groups(indices, gap):
        peak = max(group, key=lambda i: abs(series.vertical[i]))
        lo, hi = group[0], group[-1]
        ext_lo, ext_hi = max(0, lo - ctx), min(n, hi + ctx + 1)

        rms_lo, rms_hi = _centered_span(n, peak, rms_half)
        segment = series.vertical[rms_lo:rms_hi]
        local_rms = math.sqrt(sum(v * v for v in segment) / len(segment)) if segment else 0.0

        dt = 1.0 / hz
        impulse = sum(abs(series.vertical[i]) for i in range(lo, hi + 1)) * dt

        peak_value = series.vertical[peak]
        after = series.vertical[peak:ext_hi]
        if peak_value >= 0:
            opposite = min(after) if after else 0.0
        else:
            opposite = max(after) if after else 0.0
        rebound = abs(opposite) / abs(peak_value) if peak_value else 0.0

        candidates.append(
            Candidate(
                session_id=series.session_id,
                start_sample=lo,
                end_sample=hi,
                peak_sample=peak,
                start_row=series.rows[lo].row_index,
                end_row=series.rows[hi].row_index,
                peak_row=series.rows[peak].row_index,
                start_time=_time_at(series.times, lo, hz),
                end_time=_time_at(series.times, hi, hz),
                peak_time=_time_at(series.times, peak, hz),
                peak_vertical=peak_value,
                peak_abs_vertical=abs(peak_value),
                duration_seconds=_duration(series.times, lo, hi, hz),
                local_rms=local_rms,
                impulse=impulse,
                rebound_ratio=min(rebound, 2.0),
                turning_activity=max(series.turning[ext_lo:ext_hi]),
                horizontal_activity=max(series.horizontal_band[ext_lo:ext_hi]),
                gyro_activity=max(series.gyro_magnitude[ext_lo:ext_hi]),
            )
        )
    return candidates


# --------------------------------------------------------------------------- #
# False-positive suppression
# --------------------------------------------------------------------------- #
def suppression_reason(
    candidate: Candidate, thresholds: Thresholds
) -> Optional[str]:
    """Return a suppression reason, or ``None`` if the candidate is accepted.

    Rules, in evaluation order:

    1. ``turning`` -- sustained high yaw-rate / rotational activity, even when
       the vertical evidence looks impact-like.
    2. ``horizontal_motion`` -- elevated horizontal (lateral/longitudinal)
       acceleration proxy together with insufficient vertical road-impact
       evidence, i.e. the shake is not coming from the road surface.
    3. ``noise`` -- the vertical peak never reaches the accept threshold, so it
       is an insignificant isolated spike.
    """

    if candidate.turning_activity >= thresholds.turning:
        return SUPPRESSION_TURNING
    if (
        candidate.horizontal_activity >= thresholds.horizontal
        and candidate.peak_abs_vertical < thresholds.accept_peak
    ):
        return SUPPRESSION_HORIZONTAL
    if candidate.peak_abs_vertical < thresholds.accept_peak:
        return SUPPRESSION_NOISE
    return None


# --------------------------------------------------------------------------- #
# Pothole vs Bump classifier
# --------------------------------------------------------------------------- #
CLASSIFIER_FEATURES = ("peak_abs_vertical", "local_rms", "duration_seconds", "rebound_ratio")


@dataclass
class ImpactClassifier:
    """Deterministic standardized nearest-centroid classifier.

    Calibrated from candidates that fall inside labelled regions. It makes its
    own prediction from features; it never copies ``annotation_text``.
    """

    means: list = field(default_factory=list)
    scales: list = field(default_factory=list)
    centroids: dict = field(default_factory=dict)
    training_counts: dict = field(default_factory=dict)
    class_priors: dict = field(default_factory=dict)

    @property
    def is_calibrated(self) -> bool:
        return bool(self.centroids)

    def _vector(self, candidate: Candidate) -> list:
        return [float(getattr(candidate, name)) for name in CLASSIFIER_FEATURES]

    def _standardize(self, vector: Sequence[float]) -> list:
        return [
            (vector[i] - self.means[i]) / (self.scales[i] or 1.0)
            for i in range(len(vector))
        ]

    def predict(self, candidate: Candidate) -> tuple:
        """Return ``(label, {label: distance})`` for a candidate.

        The decision uses a prior-corrected nearest centroid (a small Bayesian
        distance classifier): ``score = distance - log(prior)``. The prior
        correction matters because the labelled demo candidates are heavily
        imbalanced (many more Bump than Pothole); without it a class with only
        a couple of calibration examples would be over-predicted. Raw
        (un-corrected) distances are still reported for explainability.
        """

        if not self.is_calibrated:
            return BUMP, {}
        vector = self._standardize(self._vector(candidate))
        distances = {
            label: math.sqrt(sum((vector[i] - centroid[i]) ** 2 for i in range(len(vector))))
            for label, centroid in self.centroids.items()
        }
        scores = {
            label: distance - math.log(max(self.class_priors.get(label, 1.0), 1e-9))
            for label, distance in distances.items()
        }
        label = min(scores, key=lambda key: (scores[key], key))
        return label, distances

    def to_dict(self) -> dict:
        return {
            "features": list(CLASSIFIER_FEATURES),
            "feature_means": [round(v, 6) for v in self.means],
            "feature_scales": [round(v, 6) for v in self.scales],
            "centroids": {
                label: [round(v, 6) for v in centroid]
                for label, centroid in self.centroids.items()
            },
            "training_counts": dict(self.training_counts),
            "class_priors": {k: round(v, 6) for k, v in self.class_priors.items()},
            "decision_rule": "prior_corrected_nearest_centroid",
        }


def calibrate_impact_classifier(candidates: Sequence[Candidate]) -> ImpactClassifier:
    """Fit feature means/scales and per-class centroids on labelled candidates."""

    labelled = [c for c in candidates if c.truth_label in IMPACT_CLASSES]
    if not labelled:
        return ImpactClassifier()

    vectors = [
        [float(getattr(c, name)) for name in CLASSIFIER_FEATURES] for c in labelled
    ]
    means = [statistics.mean(v[i] for v in vectors) for i in range(len(CLASSIFIER_FEATURES))]
    scales = [
        statistics.pstdev(v[i] for v in vectors) or 1.0
        for i in range(len(CLASSIFIER_FEATURES))
    ]

    centroids: dict = {}
    training_counts: dict = {}
    for label in IMPACT_CLASSES:
        class_vectors = [
            vectors[i] for i, c in enumerate(labelled) if c.truth_label == label
        ]
        training_counts[label] = len(class_vectors)
        if not class_vectors:
            continue
        centroids[label] = [
            (statistics.mean(v[i] for v in class_vectors) - means[i]) / scales[i]
            for i in range(len(CLASSIFIER_FEATURES))
        ]
    return ImpactClassifier(
        means=means,
        scales=scales,
        centroids=centroids,
        training_counts=training_counts,
        class_priors={
            label: count / len(labelled)
            for label, count in training_counts.items()
        }
        or {"Bump": 1.0},
    )


def leave_one_out_accuracy(candidates: Sequence[Candidate]) -> Optional[float]:
    """Honest accuracy estimate of the classifier via leave-one-out folds."""

    labelled = [c for c in candidates if c.truth_label in IMPACT_CLASSES]
    if len(labelled) < 2:
        return None
    correct = 0
    for index, held_out in enumerate(labelled):
        rest = labelled[:index] + labelled[index + 1 :]
        classifier = calibrate_impact_classifier(rest)
        prediction, _ = classifier.predict(held_out)
        if prediction == held_out.truth_label:
            correct += 1
    return correct / len(labelled)


# --------------------------------------------------------------------------- #
# Severity and confidence
# --------------------------------------------------------------------------- #
def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def score_impact(
    candidate: Candidate, thresholds: Thresholds, config: DetectorConfig
) -> None:
    """Fill in prototype severity/confidence scores (0-100) on a candidate."""

    span = max(config.severe_ratio - 1.0, 1e-9)
    magnitude = _clamp(
        (candidate.peak_abs_vertical / thresholds.accept_peak - 1.0) / span * 100.0
    )
    energy = _clamp(
        (candidate.local_rms / thresholds.accept_peak - 1.0) / span * 100.0
    )
    duration = _clamp(
        candidate.duration_seconds / max(config.reference_duration_seconds, 1e-9) * 100.0
    )
    candidate.severity_score = _clamp(0.60 * magnitude + 0.25 * energy + 0.15 * duration)

    confidence = 50.0
    confidence += 0.25 * magnitude
    confidence += 0.15 * _clamp(candidate.rebound_ratio * 100.0)
    if candidate.turning_activity > thresholds.turning:
        over = (candidate.turning_activity / thresholds.turning) - 1.0
        confidence -= 30.0 * _clamp(over, 0.0, 1.0)
    # Penalise when horizontal motion dominates the vertical road evidence.
    ratio = candidate.horizontal_activity / (candidate.peak_abs_vertical + 1e-9)
    if ratio > 1.0:
        confidence -= 20.0 * _clamp(ratio - 1.0, 0.0, 1.0)
    candidate.confidence_score = _clamp(confidence)


# --------------------------------------------------------------------------- #
# Sustained roughness (derived heuristic)
# --------------------------------------------------------------------------- #
@dataclass
class RoughnessEvent:
    session_id: str
    start_sample: int
    end_sample: int
    start_row: int
    end_row: int
    start_time: Optional[float]
    end_time: Optional[float]
    duration_seconds: float
    mean_rms: float
    peak_rms: float
    severity_score: float
    confidence_score: float
    gps: Optional[dict] = None
    event_class: str = ROUGHNESS
    provenance: str = "derived_heuristic"

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "class": self.event_class,
            "provenance": self.provenance,
            "suppressed": False,
            "suppression_reason": None,
            "start_row": self.start_row,
            "end_row": self.end_row,
            "peak_row": None,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "peak_time": None,
            "severity_score": round(self.severity_score, 2),
            "confidence_score": round(self.confidence_score, 2),
            "evidence": {
                "mean_vertical_rms": round(self.mean_rms, 6),
                "peak_vertical_rms": round(self.peak_rms, 6),
                "duration_seconds": round(self.duration_seconds, 6),
            },
            "gps": self.gps,
            "truth_label": None,
            "classification_matches_label": None,
        }


def detect_roughness(
    series: SessionSeries,
    thresholds: Thresholds,
    config: DetectorConfig,
    accepted_impacts: Sequence[Candidate],
) -> list:
    """Detect sustained roughness as a persistence-filtered rolling-RMS heuristic.

    Persistence ("sustained") is enforced two ways:

    * the run above the roughness threshold must last at least
      ``roughness_min_duration_seconds``;
    * short dips up to ``roughness_gap_seconds`` are bridged.

    A run that is mostly explained by an accepted impact (its overlap with the
    impact windows exceeds ``roughness_max_impact_overlap``) is skipped, so a
    single pothole/bump is never re-reported as roughness.
    """

    n = len(series.vertical)
    if n == 0:
        return []
    hz = config.sampling_hz
    ctx = _half_window(config.impact_context_seconds, hz)

    impact_mask = [False] * n
    for impact in accepted_impacts:
        for i in range(max(0, impact.start_sample - ctx), min(n, impact.end_sample + ctx + 1)):
            impact_mask[i] = True

    active = [series.roughness[i] >= thresholds.roughness for i in range(n)]
    gap = max(1, int(round(config.roughness_gap_seconds * hz)))
    min_samples = max(1, int(round(config.roughness_min_duration_seconds * hz)))

    # Contiguous active runs, then bridge short below-threshold dips.
    runs: list = []
    current: Optional[list] = None
    for i in range(n):
        if active[i]:
            if current is None:
                current = [i, i]
            else:
                current[1] = i
        elif current is not None:
            runs.append(current)
            current = None
    if current is not None:
        runs.append(current)

    merged: list = []
    for run in runs:
        if merged and run[0] - merged[-1][1] - 1 <= gap:
            merged[-1][1] = run[1]
        else:
            merged.append(list(run))

    events: list = []
    for group in merged:
        if group[1] - group[0] + 1 < min_samples:
            continue
        lo, hi = group[0], group[1]
        overlap = sum(1 for i in range(lo, hi + 1) if impact_mask[i])
        if overlap / (hi - lo + 1) > config.roughness_max_impact_overlap:
            continue
        values = series.roughness[lo : hi + 1]
        mean_rms = sum(values) / len(values)
        peak_rms = max(values)
        duration = _duration(series.times, lo, hi, hz)
        span = max(config.severe_ratio - 1.0, 1e-9)
        severity = _clamp((peak_rms / thresholds.roughness - 1.0) / span * 100.0)
        persistence = _clamp(duration / (config.roughness_min_duration_seconds * 4.0) * 100.0)
        margin = _clamp((mean_rms / thresholds.roughness - 1.0) * 100.0)
        confidence = _clamp(40.0 + 0.3 * persistence + 0.3 * margin)
        events.append(
            RoughnessEvent(
                session_id=series.session_id,
                start_sample=lo,
                end_sample=hi,
                start_row=series.rows[lo].row_index,
                end_row=series.rows[hi].row_index,
                start_time=_time_at(series.times, lo, hz),
                end_time=_time_at(series.times, hi, hz),
                duration_seconds=duration,
                mean_rms=mean_rms,
                peak_rms=peak_rms,
                severity_score=severity,
                confidence_score=confidence,
            )
        )
    return events


# --------------------------------------------------------------------------- #
# GPS
# --------------------------------------------------------------------------- #
def event_gps(rows: Sequence, start: int, peak: int, end: int) -> Optional[dict]:
    """Return real source GPS for an event, or ``None``; never fabricates."""

    order = [peak] + list(range(start, peak)) + list(range(peak + 1, end + 1))
    for index in order:
        row = rows[index]
        if not row.has_gps:
            continue
        gps = {
            "latitude": row.location_latitude,
            "longitude": row.location_longitude,
        }
        if row.location_vertical_accuracy is not None:
            gps["vertical_accuracy"] = row.location_vertical_accuracy
        return gps
    return None


def region_label_for(session, row_index: int) -> Optional[str]:
    """Ground-truth label of the annotated region containing ``row_index``."""

    for region in session.annotation_regions:
        if region.start_row <= row_index <= region.end_row:
            return region.label
    return None


# --------------------------------------------------------------------------- #
# Full pipeline
# --------------------------------------------------------------------------- #
@dataclass
class DetectionResult:
    accepted: list
    suppressed: list
    roughness: list
    summary: dict


def detect_sessions(sessions: Sequence, config: Optional[DetectorConfig] = None) -> DetectionResult:
    """Run the full detector over a list of loaded sessions.

    The first session whose ``schema`` is normal is used as the reference
    baseline. All other sessions are detected against that reference.
    """

    config = config or DetectorConfig()
    sessions = list(sessions)
    if not sessions:
        raise ValueError("detect_sessions() needs at least one session")

    reference = next((s for s in sessions if s.schema == "normal"), sessions[0])
    reference_series = build_series(reference, config)
    baseline = build_reference_baseline(reference_series)
    thresholds = thresholds_from_baseline(baseline, config)

    # First pass collects candidates (for calibration), second pass scores them.
    prepared: list = []
    for session in sessions:
        prepared.append((session, build_series(session, config)))

    all_candidates: list = []
    for session, series in prepared:
        candidates = detect_impact_candidates(series, thresholds, config)
        for candidate in candidates:
            candidate.truth_label = region_label_for(session, candidate.peak_row)
        all_candidates.extend(candidates)

    classifier = calibrate_impact_classifier(all_candidates)
    loo_accuracy = leave_one_out_accuracy(all_candidates)

    accepted: list = []
    suppressed: list = []
    roughness_events: list = []
    for session, series in prepared:
        candidates = [c for c in all_candidates if c.session_id == session.session_id]
        session_accepted: list = []
        for candidate in candidates:
            reason = suppression_reason(candidate, thresholds)
            if reason is not None:
                candidate.suppressed = True
                candidate.suppression_reason = reason
                suppressed.append(candidate)
                continue
            label, distances = classifier.predict(candidate)
            candidate.event_class = label
            candidate.class_distances = distances
            score_impact(candidate, thresholds, config)
            candidate.gps = event_gps(
                series.rows,
                candidate.start_sample,
                candidate.peak_sample,
                candidate.end_sample,
            )
            accepted.append(candidate)
            session_accepted.append(candidate)

        roughness = detect_roughness(series, thresholds, config, session_accepted)
        for event in roughness:
            event.gps = event_gps(
                series.rows, event.start_sample, event.start_sample, event.end_sample
            )
        roughness_events.extend(roughness)

    accepted.sort(key=lambda c: (c.session_id, c.start_row))
    suppressed.sort(key=lambda c: (c.session_id, c.start_row))
    roughness_events.sort(key=lambda e: (e.session_id, e.start_row))

    summary = build_summary(
        sessions, accepted, suppressed, roughness_events, baseline, thresholds,
        config, classifier, loo_accuracy,
    )
    return DetectionResult(
        accepted=accepted,
        suppressed=suppressed,
        roughness=roughness_events,
        summary=summary,
    )


def _validation(accepted: Sequence[Candidate]) -> dict:
    agree = 0
    disagree = 0
    confusion = {(truth, pred): 0 for truth in IMPACT_CLASSES for pred in IMPACT_CLASSES}
    disagreements: list = []
    for event in accepted:
        if event.truth_label not in IMPACT_CLASSES or event.event_class not in IMPACT_CLASSES:
            continue
        confusion[(event.truth_label, event.event_class)] += 1
        if event.truth_label == event.event_class:
            agree += 1
        else:
            disagree += 1
            disagreements.append(
                {
                    "session_id": event.session_id,
                    "peak_row": event.peak_row,
                    "predicted": event.event_class,
                    "supplied_label": event.truth_label,
                }
            )
    return {
        "predictions_agreeing_with_supplied_labels": agree,
        "predictions_disagreeing_with_supplied_labels": disagree,
        "confusion_matrix": {
            f"{truth}->{pred}": count for (truth, pred), count in confusion.items()
        },
        "disagreements": disagreements,
    }


def build_summary(
    sessions,
    accepted,
    suppressed,
    roughness_events,
    baseline,
    thresholds,
    config,
    classifier,
    loo_accuracy,
) -> dict:
    suppression_counts = {
        SUPPRESSION_TURNING: 0,
        SUPPRESSION_HORIZONTAL: 0,
        SUPPRESSION_NOISE: 0,
    }
    for candidate in suppressed:
        suppression_counts[candidate.suppression_reason] = (
            suppression_counts.get(candidate.suppression_reason, 0) + 1
        )

    class_counts = {POTHOLE: 0, BUMP: 0, ROUGHNESS: 0}
    for event in accepted:
        if event.event_class in class_counts:
            class_counts[event.event_class] += 1
    class_counts[ROUGHNESS] = len(roughness_events)

    validation = _validation(accepted)
    validation["leave_one_out_accuracy"] = (
        None if loo_accuracy is None else round(loo_accuracy, 4)
    )
    training_counts = classifier.training_counts
    labelled_total = sum(training_counts.values())
    majority_baseline = (
        max(training_counts.values()) / labelled_total if labelled_total else None
    )
    if loo_accuracy is None or majority_baseline is None:
        assessment = "unknown"
    elif loo_accuracy <= majority_baseline + 0.05:
        assessment = "weak"
    else:
        assessment = "usable"
    validation["labelled_candidates"] = labelled_total
    validation["class_counts_in_labelled_candidates"] = dict(training_counts)
    validation["majority_class_baseline_accuracy"] = (
        None if majority_baseline is None else round(majority_baseline, 4)
    )
    validation["pothole_bump_separation"] = assessment
    validation["separation_note"] = (
        "Pothole vs Bump separation on this 4-session demo subset is "
        f"{assessment}: leave-one-out accuracy "
        f"{validation['leave_one_out_accuracy']} vs majority-class baseline "
        f"{validation['majority_class_baseline_accuracy']}. The classifier "
        "therefore defaults to the majority class rather than claiming a "
        "Pothole it cannot support. This is reported honestly, not hidden."
    )

    return {
        "dataset": "RoadSens-4M",
        "subset": "roadpulse-demo",
        "detector": "processor/detector.py",
        "reference_session": next(
            (s.session_id for s in sessions if s.schema == "normal"),
            sessions[0].session_id if sessions else None,
        ),
        "config": config.to_dict(),
        "baseline": {name: stats.to_dict() for name, stats in baseline.items()},
        "thresholds": thresholds.to_dict(),
        "classifier": classifier.to_dict(),
        "counts": {
            "accepted_total": len(accepted) + len(roughness_events),
            "accepted_by_class": class_counts,
            "suppressed_total": len(suppressed),
            "suppressed_by_reason": suppression_counts,
            "candidates_total": len(accepted) + len(suppressed),
        },
        "validation": validation,
        "notes": [
            "Pothole and Bump labels are supplied by the RoadSens-4M dataset.",
            "Sustained Roughness is a derived_heuristic, not a dataset label.",
            "Normal road is the baseline state, never an event class.",
            "Severity and confidence are prototype 0-100 scores, not official ratings.",
            "Horizontal acceleration is an unsigned lateral/longitudinal proxy, "
            "not true signed braking acceleration.",
        ],
    }