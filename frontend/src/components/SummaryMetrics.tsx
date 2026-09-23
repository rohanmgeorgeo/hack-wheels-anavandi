import { summary } from '../data';

interface MetricCard {
  label: string;
  value: number;
  hint: string;
  accent: string;
}

export default function SummaryMetrics() {
  const counts = summary.counts;
  const byClass = counts.accepted_by_class;

  const cards: MetricCard[] = [
    {
      label: 'Accepted road events',
      value: counts.accepted_total,
      hint: `from ${counts.candidates_total} detector candidates`,
      accent: '#38bdf8',
    },
    {
      label: 'Bump / Speed Breaker',
      value: byClass.Bump ?? 0,
      hint: 'source-supported label',
      accent: '#fbbf24',
    },
    {
      label: 'Pothole',
      value: byClass.Pothole ?? 0,
      hint: '0 accepted in this demo subset',
      accent: '#f87171',
    },
    {
      label: 'Sustained Roughness',
      value: byClass['Sustained Roughness'] ?? 0,
      hint: 'derived heuristic',
      accent: '#a78bfa',
    },
    {
      label: 'False-positive candidates suppressed',
      value: counts.suppressed_total,
      hint: 'turning · horizontal motion · noise',
      accent: '#34d399',
    },
  ];

  return (
    <section className="metrics" aria-label="Detector summary metrics">
      {cards.map((card) => (
        <article className="metric-card" key={card.label}>
          <span className="metric-bar" style={{ backgroundColor: card.accent }} />
          <div className="metric-body">
            <span className="metric-value">{card.value}</span>
            <span className="metric-label">{card.label}</span>
            <span className="metric-hint">{card.hint}</span>
          </div>
        </article>
      ))}
    </section>
  );
}
