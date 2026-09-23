import { useCallback, useMemo, useState } from 'react';

import RoadIssuesMap from './RoadIssuesMap';
import TracePipeline from './TracePipeline';
import {
  CLASS_META,
  formatCoords,
  formatNumber,
  formatSeconds,
  roadIssues,
  roadIssuesFile,
  roadIssuesSummary,
} from '../data';
import {
  classCountEntries,
  dominantClass,
  filterIssues,
  pluralize,
  sortIssues,
} from '../roadIssues';
import { findEventForObservationId, hasReplaySession } from '../traceability';
import type { IssueFilter } from '../roadIssues';
import type { IssueTrace, RoadIssue } from '../types';

const PROVENANCE_LABELS: Record<string, string> = {
  detected_impact: 'Detected impact',
  derived_heuristic: 'Derived heuristic',
};

const FILTERS: Array<{ key: IssueFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'multi', label: 'Multi-observation' },
  { key: 'single', label: 'Single observation' },
];

interface RoadIssuesViewProps {
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string) => void;
  onInspectEvent: (observationId: string) => void;
  onReplayEvent: (sessionId: string, time: number) => void;
  trace: IssueTrace | null;
}

function ClassChip({ issue }: { issue: RoadIssue }) {
  const dominant = dominantClass(issue);
  const meta = dominant ? CLASS_META[dominant] : null;
  if (!meta) return null;
  return (
    <span
      className="class-chip"
      style={{
        color: meta.color,
        borderColor: meta.color,
        backgroundColor: `rgba(${meta.rgb}, 0.14)`,
      }}
    >
      {meta.label}
    </span>
  );
}

export default function RoadIssuesView({
  selectedIssueId,
  onSelectIssue,
  onInspectEvent,
  onReplayEvent,
  trace,
}: RoadIssuesViewProps) {
  const sorted = useMemo(() => sortIssues(roadIssues), []);
  const [filter, setFilter] = useState<IssueFilter>('all');

  const selected =
    sorted.find((issue) => issue.issue_id === selectedIssueId) ?? sorted[0] ?? null;
  const visible = useMemo(() => filterIssues(sorted, filter), [sorted, filter]);

  const radius = roadIssuesFile.association_method.radius_meters;
  const summary = roadIssuesSummary;

  const handleSelect = useCallback(
    (issue: RoadIssue) => onSelectIssue(issue.issue_id),
    [onSelectIssue],
  );

  const metrics = [
    {
      label: 'Spatial issues',
      value: summary.issue_count,
      hint: `from ${summary.accepted_gps_observations} GPS observations`,
      accent: '#38bdf8',
    },
    {
      label: 'GPS observations represented',
      value: summary.accepted_gps_observations,
      hint: 'accepted events with real source GPS',
      accent: '#34d399',
    },
    {
      label: 'Multi-observation issues',
      value: summary.multi_observation_issue_count,
      hint: 'grouped from more than one observation',
      accent: '#a78bfa',
    },
    {
      label: 'Cross-session issues',
      value: summary.multi_session_issue_count,
      hint: `no clusters span sessions at ${radius} m in this subset`,
      accent: '#64748b',
    },
  ];

  const tracedSelected =
    trace && selected && trace.issueId === selected.issue_id ? trace : null;

  return (
    <main className="app-main issues-view">
      <div className="panel issues-header">
        <div>
          <h2 className="panel-title">Proximity-based Road Issues</h2>
          <p className="replay-subtitle">
            Accepted detector observations with real GPS, grouped into spatial
            issues. This is not road-network map matching.
          </p>
        </div>
        <span className="panel-tag">
          Radius {radius} m · {roadIssuesFile.association_method.distance_metric}
        </span>
      </div>

      <section className="metrics metrics-4" aria-label="Road issue summary metrics">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <span className="metric-bar" style={{ backgroundColor: metric.accent }} />
            <div className="metric-body">
              <span className="metric-value">{metric.value}</span>
              <span className="metric-label">{metric.label}</span>
              <span className="metric-hint">{metric.hint}</span>
            </div>
          </article>
        ))}
      </section>

      <div className="content-grid">
        <section className="panel map-panel">
          <div className="panel-head map-head">
            <div>
              <h3 className="panel-title">Spatial Issue View</h3>
              <p className="panel-subtitle">
                {sorted.length} issues · one marker per issue center · marker
                colour follows the dominant event class.
              </p>
            </div>
          </div>
          <RoadIssuesMap
            issues={sorted}
            selectedId={selected?.issue_id ?? null}
            onSelect={handleSelect}
          />
          <div className="map-footer">
            <p className="map-caption">
              Nearby accepted observations are grouped using a {radius} m
              prototype proximity rule. This is not road-network map matching.
            </p>
          </div>
        </section>

        <aside className="side-column">
          <section className="panel issue-list-panel">
            <div className="panel-head">
              <h3 className="panel-title">Issue list</h3>
              <span className="panel-tag">
                {visible.length} of {sorted.length}
              </span>
            </div>

            <div className="filter-row" role="group" aria-label="Issue filters">
              {FILTERS.map((option) => (
                <button
                  key={option.key}
                  className={`filter-btn${filter === option.key ? ' active' : ''}`}
                  onClick={() => setFilter(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <ul className="issue-list">
              {visible.map((issue) => (
                <li
                  key={issue.issue_id}
                  className={`issue-item${
                    issue.issue_id === selected?.issue_id ? ' active' : ''
                  }`}
                >
                  <button
                    className="issue-item-button"
                    onClick={() => onSelectIssue(issue.issue_id)}
                  >
                    <div className="issue-item-head">
                      <span className="issue-id">{issue.issue_id}</span>
                      <ClassChip issue={issue} />
                    </div>
                    <div className="issue-item-stats">
                      <span>
                        {issue.observation_count}{' '}
                        {pluralize(
                          issue.observation_count,
                          'observation',
                          'observations',
                        )}
                      </span>
                      <span>
                        {issue.distinct_session_count}{' '}
                        {pluralize(
                          issue.distinct_session_count,
                          'recorded session',
                          'recorded sessions',
                        )}
                      </span>
                      <span>max severity {formatNumber(issue.severity.max, 1)}</span>
                      <span>
                        mean confidence {formatNumber(issue.confidence.mean, 1)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {tracedSelected ? (
        <div className="panel trace-banner">
          <div>
            <p className="trace-banner-title">
              Traced from Session {tracedSelected.sessionId} observation
              {tracedSelected.eventTime !== null
                ? ` at ${tracedSelected.eventTime.toFixed(2)} s`
                : ''}
            </p>
            <p className="trace-banner-sub">
              This spatial issue contains {selected?.observation_count ?? 0}{' '}
              accepted{' '}
              {pluralize(
                selected?.observation_count ?? 0,
                'observation',
                'observations',
              )}
              .
            </p>
          </div>
          <TracePipeline stage="issue" compact />
        </div>
      ) : null}

      {selected ? (
        <div className="issues-detail-grid">
          <section className="panel issue-detail-panel">
            <div className="details-head">
              <h3 className="panel-title">{selected.issue_id}</h3>
              <ClassChip issue={selected} />
            </div>
            <p className="panel-subtitle">
              {selected.observation_count}{' '}
              {pluralize(selected.observation_count, 'observation', 'observations')}{' '}
              in {selected.distinct_session_count}{' '}
              {pluralize(
                selected.distinct_session_count,
                'recorded session',
                'recorded sessions',
              )}
              .
            </p>

            <dl className="detail-list">
              <div>
                <dt>Center</dt>
                <dd>{formatCoords(selected.center)}</dd>
              </div>
              <div>
                <dt>Observation count</dt>
                <dd>{selected.observation_count}</dd>
              </div>
              <div>
                <dt>Distinct recorded sessions</dt>
                <dd>{selected.distinct_session_count}</dd>
              </div>
              <div>
                <dt>Session IDs</dt>
                <dd>{selected.session_ids.join(', ')}</dd>
              </div>
              <div>
                <dt>Class counts</dt>
                <dd>
                  {classCountEntries(selected)
                    .map(([eventClass, count]) => `${eventClass}: ${count}`)
                    .join(' · ')}
                </dd>
              </div>
              <div>
                <dt>Severity (mean / max)</dt>
                <dd>
                  {formatNumber(selected.severity.mean, 2)} /{' '}
                  {formatNumber(selected.severity.max, 2)}
                </dd>
              </div>
              <div>
                <dt>Confidence (mean / max)</dt>
                <dd>
                  {formatNumber(selected.confidence.mean, 2)} /{' '}
                  {formatNumber(selected.confidence.max, 2)}
                </dd>
              </div>
              <div>
                <dt>First / last event time</dt>
                <dd>
                  {formatSeconds(selected.first_observation_time)} /{' '}
                  {formatSeconds(selected.last_observation_time)}
                </dd>
              </div>
            </dl>

            <div className="detail-section">
              <p className="detail-section-title">
                Member observations ({selected.observations.length})
              </p>
              <div className="member-table-wrap">
                <table className="member-table">
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Event type</th>
                      <th>Time</th>
                      <th>Severity</th>
                      <th>Confidence</th>
                      <th>GPS</th>
                      <th>Provenance</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.observations.map((observation) => {
                      const canInspect = findEventForObservationId(
                        observation.observation_id,
                      );
                      const canReplay =
                        observation.event_time !== null &&
                        hasReplaySession(observation.session_id);
                      return (
                        <tr key={observation.observation_id}>
                          <td>{observation.session_id}</td>
                          <td>{observation.event_class}</td>
                          <td>{formatSeconds(observation.event_time)}</td>
                          <td>{formatNumber(observation.severity_score, 1)}</td>
                          <td>{formatNumber(observation.confidence_score, 1)}</td>
                          <td className="member-coords">
                            {formatCoords(observation)}
                          </td>
                          <td>
                            {PROVENANCE_LABELS[observation.provenance] ??
                              observation.provenance}
                          </td>
                          <td className="member-actions">
                            {canInspect ? (
                              <button
                                className="trace-btn small"
                                onClick={() =>
                                  onInspectEvent(observation.observation_id)
                                }
                              >
                                Inspect source event
                              </button>
                            ) : null}
                            {canReplay ? (
                              <button
                                className="trace-btn small"
                                onClick={() =>
                                  onReplayEvent(
                                    observation.session_id,
                                    Math.max(
                                      0,
                                      (observation.event_time ?? 0) - 1.5,
                                    ),
                                  )
                                }
                              >
                                Replay at event
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <div className="issues-side">
            <section className="panel">
              <h3 className="panel-title">How this issue was formed</h3>
              <ul className="formation-list">
                <li>
                  <span>Spatial association</span>
                  <span>{roadIssuesFile.association_method.type}</span>
                </li>
                <li>
                  <span>Radius</span>
                  <span>{radius} m</span>
                </li>
                <li>
                  <span>Distance metric</span>
                  <span>{roadIssuesFile.association_method.distance_metric}</span>
                </li>
                <li>
                  <span>Members</span>
                  <span>
                    {selected.observation_count} accepted GPS{' '}
                    {pluralize(
                      selected.observation_count,
                      'observation',
                      'observations',
                    )}
                  </span>
                </li>
                <li>
                  <span>Recorded sessions</span>
                  <span>{selected.distinct_session_count}</span>
                </li>
              </ul>
              <TracePipeline stage="issue" compact />
              <p className="panel-note">
                Every member belongs to the generated RoadPulse detector output.
                Issue centers are derived from the member coordinates.
              </p>
              <p className="disclaimer">
                Proximity association — not road-network map matching.
              </p>
            </section>

            <section className="panel limitation-note">
              <h3 className="panel-title">Current data limitation</h3>
              <p className="panel-note">
                Current RoadSens demo sessions cover different locations, so no
                spatial issue contains observations from more than one recorded
                session at the {radius} m association radius. Cross-session
                corroboration remains a fleet-data capability, not a demonstrated
                result in this subset.
              </p>
            </section>

            <section className="panel future-card">
              <h3 className="panel-title">Fleet progression</h3>
              <div className="future-step current">
                <span className="future-badge">CURRENT</span>
                <span>accepted event → spatial issue</span>
              </div>
              <div className="future-step next">
                <span className="future-badge">FUTURE / NEXT</span>
                <span>
                  spatial issue → repeated-session evidence → maintenance
                  intelligence
                </span>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </main>
  );
}
