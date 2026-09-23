"""RoadPulse data preparation package.

Exposes the RoadSens-4M CSV loader and the explainable sensor-feature
derivations used to normalize the demo subset.
"""

from .loader import (
    ANOMALY_SCHEMA,
    NORMAL_SCHEMA,
    AnnotationRegion,
    SensorRow,
    Session,
    load_session,
    parse_float,
)
from .features import DERIVED_FEATURE_NAMES, derive_features

__all__ = [
    "ANOMALY_SCHEMA",
    "NORMAL_SCHEMA",
    "AnnotationRegion",
    "SensorRow",
    "Session",
    "load_session",
    "parse_float",
    "DERIVED_FEATURE_NAMES",
    "derive_features",
]
