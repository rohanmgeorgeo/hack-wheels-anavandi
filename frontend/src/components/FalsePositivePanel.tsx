import { summary } from '../data';

const REASON_META: Record<string, { label: string; description: string; color: string }> = {
  turning: {
    label: 'Turning',
    description: 'Sustained yaw / rotational activity.',
    color: '#e0a92e',
  },
  horizontal_motion: {
    label: 'Horizontal motion',
    description: 'Lateral/longitudinal shake without matching vertical impact.',
    color: '#4cc2ff',
  },
  noise: {
    label: 'Noise',
    description: 'Isolated vertical spike below the accept threshold.',
    color: 'var(--text-3)',
  },
};

export default function FalsePositivePanel() {
  const reasons = summary.counts.suppressed_by_reason;
  const total = summary.counts.suppressed_total;
  const max = Math.max(1, ...Object.values(reasons));

  return (
    <section className="subpanel">
      <div className="panel-head">
        <h2 className="panel-title">False-positive suppression</h2>
        <span className="panel-tag">{total} suppressed</span>
      </div>
      <ul className="reason-list">
        {Object.entries(REASON_META).map(([key, meta]) => {
          const count = reasons[key] ?? 0;
          return (
            <li key={key} className="reason-row">
              <div className="reason-row-head">
                <span className="reason-name">{meta.label}</span>
                <span className="reason-count">{count}</span>
              </div>
              <div className="reason-track">
                <div
                  className="reason-fill"
                  style={{
                    width: `${(count / max) * 100}%`,
                    backgroundColor: meta.color,
                  }}
                />
              </div>
              <span className="reason-desc">{meta.description}</span>
            </li>
          );
        })}
      </ul>
      <p className="panel-note">
        Candidates are preserved for audit but rejected when vehicle-motion or
        noise evidence contradicts a road-impact interpretation.
      </p>
    </section>
  );
}
