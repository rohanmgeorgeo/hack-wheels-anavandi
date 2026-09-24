import { summary } from '../data';

interface Kpi {
  label: string;
  value: number;
  hint: string;
  color: string;
}

export default function SummaryMetrics() {
  const counts = summary.counts;
  const byClass = counts.accepted_by_class;

  const kpis: Kpi[] = [
    {
      label: 'Accepted',
      value: counts.accepted_total,
      hint: `from ${counts.candidates_total} candidates`,
      color: '#4cc2ff',
    },
    {
      label: 'Bump',
      value: byClass.Bump ?? 0,
      hint: 'source-supported label',
      color: '#e0a92e',
    },
    {
      label: 'Pothole',
      value: byClass.Pothole ?? 0,
      hint: '0 in this demo subset',
      color: '#d16a6a',
    },
    {
      label: 'Roughness',
      value: byClass['Sustained Roughness'] ?? 0,
      hint: 'derived heuristic',
      color: '#9d8cf0',
    },
    {
      label: 'Suppressed',
      value: counts.suppressed_total,
      hint: 'false-positive candidates',
      color: 'var(--text-3)',
    },
  ];

  return (
    <section className="kpi-strip" aria-label="Detector summary metrics">
      {kpis.map((kpi) => (
        <div className="kpi" key={kpi.label}>
          <span className="kpi-top">
            <span className="kpi-dot" style={{ backgroundColor: kpi.color }} />
            <span className="kpi-label">{kpi.label}</span>
          </span>
          <span className="kpi-value">{kpi.value}</span>
          <span className="kpi-hint">{kpi.hint}</span>
        </div>
      ))}
    </section>
  );
}
