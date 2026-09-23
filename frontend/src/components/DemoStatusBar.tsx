import {
  acceptedEvents,
  roadIssuesSummary,
  summary,
  suppressedCandidates,
} from '../data';

// Compact status strip. Every value is derived from the imported JSON, not
// hard-coded.
export default function DemoStatusBar() {
  const items = [
    { label: 'DATA', value: summary.dataset },
    { label: 'DETECTOR', value: 'Explainable deterministic pipeline' },
    {
      label: 'OBSERVATIONS',
      value: `${acceptedEvents.length} accepted / ${suppressedCandidates.length} suppressed`,
    },
    {
      label: 'GPS',
      value: `${roadIssuesSummary.accepted_gps_observations} accepted observations`,
    },
    {
      label: 'SPATIAL',
      value: `${roadIssuesSummary.issue_count} issues / ${roadIssuesSummary.multi_observation_issue_count} multi-observation`,
    },
    {
      label: 'CROSS-SESSION',
      value: `${roadIssuesSummary.multi_session_issue_count} in current subset`,
    },
  ];

  return (
    <div className="status-bar" aria-label="Demo status">
      {items.map((item) => (
        <div className="status-item" key={item.label}>
          <span className="status-label">{item.label}</span>
          <span className="status-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
