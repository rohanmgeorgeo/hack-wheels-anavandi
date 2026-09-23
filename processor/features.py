"""Explainable sensor-feature derivations for RoadPulse.

Every function here is a documented mathematical transform of the *measured*
source channels loaded by :mod:`processor.loader`. Nothing is invented.

Units (as reported by the source device):

* accelerometer and gravity: m/s^2 (gravity magnitude is ~9.8);
* gyroscope: rad/s.

The derived features are intended to be readable by hackathon judges: each
one isolates an interpretable physical quantity (overall motion, vertical
shock, lateral motion, rotation, heading change).
"""

from __future__ import annotations

import math
from typing import Optional, Sequence

DERIVED_FEATURE_NAMES = (
    "acceleration_magnitude",
    "gravity_magnitude",
    "vertical_acceleration",
    "horizontal_acceleration",
    "gyroscope_magnitude",
    "yaw_rate",
)


def _magnitude(vector: Sequence[Optional[float]]) -> Optional[float]:
    if vector is None or any(component is None for component in vector):
        return None
    return math.sqrt(sum(component * component for component in vector))


def _dot(left: Sequence[Optional[float]], right: Sequence[Optional[float]]) -> Optional[float]:
    if any(component is None for component in left) or any(
        component is None for component in right
    ):
        return None
    return sum(a * b for a, b in zip(left, right))


def acceleration_magnitude(accelerometer: Sequence[Optional[float]]) -> Optional[float]:
    """Overall magnitude of the accelerometer vector ``|a|`` in m/s^2.

    Captures total vibration/shock energy regardless of orientation.
    """

    return _magnitude(accelerometer)


def gravity_magnitude(gravity: Sequence[Optional[float]]) -> Optional[float]:
    """Magnitude of the measured gravity vector ``|g|`` in m/s^2.

    A useful sanity/quality signal: it should stay close to 9.8.
    """

    return _magnitude(gravity)


def gravity_aligned_vertical_acceleration(
    accelerometer: Sequence[Optional[float]],
    gravity: Sequence[Optional[float]],
) -> Optional[float]:
    """Acceleration component along the measured gravity axis.

    ``vertical = (a . g) / |g|``

    Projecting onto gravity removes device orientation from the equation and
    isolates vertical motion, which is where pothole/bump shocks appear.
    """

    gravity_norm = _magnitude(gravity)
    if not gravity_norm:
        return None
    return _dot(accelerometer, gravity) / gravity_norm


def horizontal_longitudinal_acceleration(
    accelerometer: Sequence[Optional[float]],
    gravity: Sequence[Optional[float]],
) -> Optional[float]:
    """Magnitude of the acceleration component perpendicular to gravity.

    ``horizontal = sqrt(|a|^2 - vertical^2)``

    Because the phone's heading is unknown this is a proxy for combined
    lateral/longitudinal (non-vertical) motion rather than a signed axis.
    """

    total = _magnitude(accelerometer)
    vertical = gravity_aligned_vertical_acceleration(accelerometer, gravity)
    if total is None or vertical is None:
        return None
    squared = total * total - vertical * vertical
    return math.sqrt(squared) if squared > 0 else 0.0


def gyroscope_magnitude(gyroscope: Sequence[Optional[float]]) -> Optional[float]:
    """Overall rotation rate ``|w|`` in rad/s."""

    return _magnitude(gyroscope)


def yaw_rate_signal(
    gyroscope: Sequence[Optional[float]],
    gravity: Sequence[Optional[float]],
) -> Optional[float]:
    """Rotation rate about the gravity axis (heading/yaw rate) in rad/s.

    ``yaw_rate = (w . g) / |g|``

    Isolates turning/heading change from roll and pitch, which helps separate
    road-roughness events from ordinary steering.
    """

    gravity_norm = _magnitude(gravity)
    if not gravity_norm:
        return None
    return _dot(gyroscope, gravity) / gravity_norm


def derive_features(row) -> dict:
    """Return all derived features for a :class:`processor.loader.SensorRow`."""

    accelerometer = row.accelerometer
    gravity = row.gravity
    gyroscope = row.gyroscope
    return {
        "acceleration_magnitude": acceleration_magnitude(accelerometer),
        "gravity_magnitude": gravity_magnitude(gravity),
        "vertical_acceleration": gravity_aligned_vertical_acceleration(
            accelerometer, gravity
        ),
        "horizontal_acceleration": horizontal_longitudinal_acceleration(
            accelerometer, gravity
        ),
        "gyroscope_magnitude": gyroscope_magnitude(gyroscope),
        "yaw_rate": yaw_rate_signal(gyroscope, gravity),
    }
