// Types mirror the shape of data/demo/processed/*.json exactly.
// Nothing here is invented: every field exists in the generated detector output.

export type EventClass = 'Pothole' | 'Bump' | 'Sustained Roughness';

export type SuppressionReason = 'turning' | 'horizontal_motion' | 'noise';

export interface Gps {
  latitude: number;
  longitude: number;
  vertical_accuracy?: number;
}

export interface ImpactEvidence {
  peak_vertical_acceleration: number;
  peak_abs_vertical_acceleration: number;
  duration_seconds: number;
  local_vibration_rms: number;
  vertical_impulse: number;
  rebound_ratio: number;
  turning_activity: number;
  horizontal_activity: number;
  gyroscope_magnitude: number;
}

export interface RoughnessEvidence {
  mean_vertical_rms: number;
  peak_vertical_rms: number;
  duration_seconds: number;
}

export type EventEvidence = ImpactEvidence | RoughnessEvidence;

export interface EventRecord {
  session_id: string;
  class: EventClass | null;
  provenance: string;
  suppressed: boolean;
  suppression_reason: SuppressionReason | null;
  start_row: number;
  end_row: number;
  peak_row: number | null;
  start_time: number | null;
  end_time: number | null;
  peak_time: number | null;
  severity_score: number;
  confidence_score: number;
  evidence: EventEvidence;
  gps: Gps | null;
  truth_label: string | null;
  classification_matches_label: boolean | null;
  class_distances?: Record<string, number>;
}

export interface EventsFile {
  dataset: string;
  subset: string;
  detector: string;
  events: EventRecord[];
  suppressed_candidates: EventRecord[];
}

export interface BaselineStats {
  count: number;
  median: number;
  mad: number;
  p95: number;
  p99: number;
  p99_5: number;
  min: number;
  max: number;
}

export interface SummaryCounts {
  accepted_total: number;
  accepted_by_class: Record<string, number>;
  suppressed_total: number;
  suppressed_by_reason: Record<string, number>;
  candidates_total: number;
}

export interface SummaryValidation {
  predictions_agreeing_with_supplied_labels: number;
  predictions_disagreeing_with_supplied_labels: number;
  confusion_matrix: Record<string, number>;
  disagreements: Array<{
    session_id: string;
    peak_row: number;
    predicted: string;
    supplied_label: string;
  }>;
  leave_one_out_accuracy: number;
  labelled_candidates: number;
  class_counts_in_labelled_candidates: Record<string, number>;
  majority_class_baseline_accuracy: number;
  pothole_bump_separation: string;
  separation_note: string;
}

export type View = 'operations' | 'replay' | 'issues';

export interface ReplaySample {
  t: number;
  vertical_acceleration: number;
  horizontal_acceleration: number;
  yaw_rate: number;
  gyroscope_magnitude: number;
  rolling_rms: number;
  latitude: number | null;
  longitude: number | null;
}

export type ReplayDecisionKind = 'accepted' | 'suppressed';

export interface ReplayDecision {
  t: number;
  decision: ReplayDecisionKind;
  event_type: EventClass | null;
  suppression_reason: SuppressionReason | null;
  severity: number;
  confidence: number;
  latitude: number | null;
  longitude: number | null;
  provenance: string;
  start_time: number | null;
  end_time: number | null;
  peak_time: number | null;
  start_row: number;
  end_row: number;
  peak_row: number | null;
  evidence: EventEvidence;
  truth_label: string | null;
}

export interface ReplaySession {
  session_id: string;
  schema: string;
  row_count: number;
  duration_seconds: number;
  sampling_hz: number;
  sample_fields: string[];
  samples: ReplaySample[];
  decisions: ReplayDecision[];
}

export interface ReplayFile {
  dataset: string;
  subset: string;
  detector: string;
  generated_by: string;
  note: string;
  sessions: ReplaySession[];
}

export interface DetectorSummary {
  dataset: string;
  subset: string;
  detector: string;
  reference_session: string;
  config: Record<string, number>;
  baseline: Record<string, BaselineStats>;
  thresholds: {
    candidate_peak: number;
    accept_peak: number;
    turning: number;
    horizontal: number;
    roughness: number;
  };
  classifier: {
    features: string[];
    feature_means: number[];
    feature_scales: number[];
    centroids: Record<string, number[]>;
    training_counts: Record<string, number>;
    class_priors: Record<string, number>;
    decision_rule: string;
  };
  counts: SummaryCounts;
  validation: SummaryValidation;
  notes: string[];
}

export interface RoadIssueObservation {
  observation_id: string;
  session_id: string;
  event_class: EventClass;
  event_time: number | null;
  provenance: string;
  severity_score: number;
  confidence_score: number;
  latitude: number;
  longitude: number;
  start_row: number;
  peak_row: number | null;
}

export interface RoadIssue {
  issue_id: string;
  center: { latitude: number; longitude: number };
  anchor: { latitude: number; longitude: number };
  observation_count: number;
  distinct_session_count: number;
  session_ids: string[];
  class_counts: Partial<Record<EventClass, number>>;
  severity: { mean: number; max: number };
  confidence: { mean: number; max: number };
  first_observation_time: number | null;
  last_observation_time: number | null;
  observations: RoadIssueObservation[];
}

export interface RoadIssuesSummary {
  accepted_observations_total: number;
  accepted_gps_observations: number;
  accepted_without_gps: number;
  suppressed_candidates_total: number;
  issue_count: number;
  multi_observation_issue_count: number;
  multi_session_issue_count: number;
  cluster_size_distribution: Record<string, number>;
  session_combinations: Record<string, number>;
  min_cross_session_distance_meters: number | null;
  cross_session_note: string;
}

export interface RoadIssuesFile {
  dataset: string;
  association_method: {
    type: string;
    distance_metric: string;
    radius_meters: number;
    clusters_accepted_gps_only: boolean;
    note: string;
  };
  summary: RoadIssuesSummary;
  issues: RoadIssue[];
}
