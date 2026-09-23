import {
  CLASS_META,
  EVIDENCE_LABELS,
  formatCoords,
  formatNumber,
  formatSeconds,
  formatTimeRange,
} from '../data';
import type { EventRecord } from '../types';

interface EventDetailsProps {
  event: EventRecord | null;
}

const PROVENANCE_LABELS: Record<string, string> = {
  detected_impact: 'Detected impact (threshold + classifier)',
  derived_heuristic: 'Derived heuristic (persistent vibration)',
};

function ScoreBar({ label, value }: { label: string; value: number }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="score">
      <div className="score-head">
        <span>{label}</span>
        <span className="score-value">{formatNumber(value, 1)}</span>
      </div>
      <div className="score-track">
        <div className="score-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function EventDetails({ event }: EventDetailsProps) {
  if (!event) {
    return (
      <div className="panel details-panel">
        <p className="panel-title">Selected event</p>
        <p className="placeholder">
          Select a marker on the map to inspect its detector evidence.
        </p>
      </div>
    );
  }

  const meta = event.class ? CLASS_META[event.class] : null;
  const evidence = Object.entries(event.evidence) as Array<[string, number]>;

  return (
    <div className="panel details-panel">
      <div className="details-head">
        <span className="panel-title">Selected event</span>
        <span
          className="class-chip"
          style={{
            color: meta?.color ?? '#cbd5e1',
            borderColor: meta?.color ?? '#334155',
            backgroundColor: meta ? `rgba(${meta.rgb}, 0.14)` : '#1e293b',
          }}
        >
          {meta?.label ?? 'Unclassified'}
        </span>
      </div>

      <div className="score-grid">
        <ScoreBar label="Severity score" value={event.severity_score} />
        <ScoreBar label="Confidence score" value={event.confidence_score} />
      </div>

      <dl className="detail-list">
        <div>
          <dt>Session ID</dt>
          <dd>{event.session_id}</dd>
        </div>
        <div>
          <dt>Event time</dt>
          <dd>{formatTimeRange(event.start_time, event.end_time)}</dd>
        </div>
        <div>
          <dt>Peak time</dt>
          <dd>{formatSeconds(event.peak_time)}</dd>
        </div>
        <div>
          <dt>Rows</dt>
          <dd>
            {event.start_row}–{event.end_row}
            {event.peak_row !== null ? ` (peak ${event.peak_row})` : ''}
          </dd>
        </div>
        <div>
          <dt>Provenance</dt>
          <dd>{PROVENANCE_LABELS[event.provenance] ?? event.provenance}</dd>
        </div>
        <div>
          <dt>GPS</dt>
          <dd>
            {event.gps
              ? formatCoords(event.gps)
              : 'No GPS in source — not plotted on the map.'}
          </dd>
        </div>
      </dl>

      <div className="detail-section">
        <p className="detail-section-title">Detector evidence / features</p>
        <ul className="evidence-list">
          {evidence.map(([key, value]) => (
            <li key={key}>
              <span>{EVIDENCE_LABELS[key] ?? key}</span>
              <span className="evidence-value">{formatNumber(value, 3)}</span>
            </li>
          ))}
        </ul>
      </div>

      {event.class_distances ? (
        <div className="detail-section">
          <p className="detail-section-title">Classifier distances</p>
          <ul className="evidence-list">
            {Object.entries(event.class_distances).map(([label, distance]) => (
              <li key={label}>
                <span>{label}</span>
                <span className="evidence-value">{formatNumber(distance, 3)}</span>
              </li>
            ))}
          </ul>
          <p className="detail-footnote">
            Nearest-centroid distances after standardization; lower is closer.
          </p>
        </div>
      ) : null}

      {event.truth_label ? (
        <div className="detail-section">
          <p className="detail-section-title">Source annotation</p>
          <ul className="evidence-list">
            <li>
              <span>Supplied label</span>
              <span className="evidence-value">{event.truth_label}</span>
            </li>
            <li>
              <span>Matches prediction</span>
              <span className="evidence-value">
                {event.classification_matches_label ? 'Yes' : 'No'}
              </span>
            </li>
          </ul>
        </div>
      ) : null}

      <p className="disclaimer">
        Severity and confidence are prototype analytical scores, not official
        road-safety ratings.
      </p>
    </div>
  );
}
