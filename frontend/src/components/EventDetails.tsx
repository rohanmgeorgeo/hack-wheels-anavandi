import {
  CLASS_META,
  EVIDENCE_LABELS,
  formatCoords,
  formatNumber,
  formatSeconds,
  formatTimeRange,
} from '../data';
import { pluralize } from '../roadIssues';
import LocationLookup from './LocationLookup';
import type { EventRecord, RoadIssue } from '../types';

interface EventDetailsProps {
  event: EventRecord | null;
  linkedIssue?: RoadIssue | null;
  onViewIssue?: (() => void) | null;
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

export default function EventDetails({
  event,
  linkedIssue = null,
  onViewIssue = null,
}: EventDetailsProps) {
  if (!event) {
    return (
      <div className="panel inspector">
        <p className="section-label">Selected event</p>
        <p className="placeholder">
          Select a mapped observation to inspect detector evidence.
        </p>
      </div>
    );
  }

  const meta = event.class ? CLASS_META[event.class] : null;
  const evidence = Object.entries(event.evidence) as Array<[string, number]>;

  return (
    <div className="panel inspector">
      <div className="inspector-head">
        <div>
          <span className="inspector-eyebrow">Selected event</span>
          <h3 className="inspector-title">{meta?.label ?? 'Unclassified'}</h3>
        </div>
        <span
          className="class-chip"
          style={{ color: meta?.color ?? 'var(--text-2)' }}
        >
          <span
            className="class-dot"
            style={{ background: meta?.color ?? 'var(--text-3)' }}
          />
          Session {event.session_id}
        </span>
      </div>

      <div className="inspector-section">
        <p className="section-label">Summary</p>
        <div className="score-grid">
          <ScoreBar label="Severity score" value={event.severity_score} />
          <ScoreBar label="Confidence score" value={event.confidence_score} />
        </div>
      </div>

      <div className="inspector-section">
        <p className="section-label">Location</p>
        <dl className="detail-list">
          <div>
            <dt>GPS</dt>
            <dd>
              {event.gps
                ? formatCoords(event.gps)
                : 'No GPS in source — not plotted.'}
            </dd>
          </div>
          <div>
            <dt>Rows</dt>
            <dd>
              {event.start_row}–{event.end_row}
              {event.peak_row !== null ? ` (peak ${event.peak_row})` : ''}
            </dd>
          </div>
        </dl>
        {event.gps ? (
          <LocationLookup
            latitude={event.gps.latitude}
            longitude={event.gps.longitude}
          />
        ) : null}
      </div>

      <div className="inspector-section">
        <p className="section-label">Detector evidence</p>
        <dl className="detail-list">
          <div>
            <dt>Event time</dt>
            <dd>{formatTimeRange(event.start_time, event.end_time)}</dd>
          </div>
          <div>
            <dt>Peak time</dt>
            <dd>{formatSeconds(event.peak_time)}</dd>
          </div>
          <div>
            <dt>Provenance</dt>
            <dd>{PROVENANCE_LABELS[event.provenance] ?? event.provenance}</dd>
          </div>
        </dl>

        <ul className="evidence-list">
          {evidence.map(([key, value]) => (
            <li key={key}>
              <span>{EVIDENCE_LABELS[key] ?? key}</span>
              <span className="evidence-value">{formatNumber(value, 3)}</span>
            </li>
          ))}
        </ul>

        {event.class_distances ? (
          <>
            <ul className="evidence-list">
              {Object.entries(event.class_distances).map(([label, distance]) => (
                <li key={label}>
                  <span>{label} distance</span>
                  <span className="evidence-value">
                    {formatNumber(distance, 3)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="detail-footnote">
              Nearest-centroid distances after standardization; lower is closer.
            </p>
          </>
        ) : null}

        {event.truth_label ? (
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
        ) : null}
      </div>

      <div className="inspector-section">
        <p className="section-label">Traceability</p>
        {linkedIssue && onViewIssue ? (
          <div className="trace-action">
            <p className="detail-footnote">
              Part of {linkedIssue.issue_id}: {linkedIssue.observation_count}{' '}
              {pluralize(
                linkedIssue.observation_count,
                'observation',
                'observations',
              )}{' '}
              in {linkedIssue.distinct_session_count}{' '}
              {pluralize(
                linkedIssue.distinct_session_count,
                'recorded session',
                'recorded sessions',
              )}
              .
            </p>
            <button className="trace-btn" onClick={onViewIssue}>
              View spatial issue
            </button>
          </div>
        ) : !event.gps ? (
          <p className="detail-footnote">
            No spatial issue: this event has no source GPS.
          </p>
        ) : (
          <p className="detail-footnote">No spatial issue membership.</p>
        )}
      </div>

      <p className="disclaimer">
        Severity and confidence are prototype analytical scores, not official
        road-safety ratings.
      </p>
    </div>
  );
}
