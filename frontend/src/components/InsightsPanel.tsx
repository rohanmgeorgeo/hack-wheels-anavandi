import { CLASS_META, acceptedEvents, summary } from '../data';
import { downloadCsv } from '../export';
import type { EventClass } from '../types';

const EXPORT_COLUMNS = [
  'session_id',
  'class',
  'peak_time',
  'start_time',
  'end_time',
  'severity_score',
  'confidence_score',
  'provenance',
  'latitude',
  'longitude',
  'start_row',
  'end_row',
  'peak_row',
];

const CLASSES: EventClass[] = ['Bump', 'Pothole', 'Sustained Roughness'];
const SEVERITY_BUCKETS = [0, 20, 40, 60, 80];

function Bar({ value, max, colour }: { value: number; max: number; colour: string }) {
  return (
    <div className="insight-track" aria-hidden="true">
      <div
        className="insight-fill"
        style={{
          width: `${max > 0 ? (value / max) * 100 : 0}%`,
          backgroundColor: colour,
        }}
      />
    </div>
  );
}

// Factual distributions derived only from the generated detector output.
export default function InsightsPanel() {
  const byClass = summary.counts.accepted_by_class;
  const classRows = CLASSES.map((eventClass) => ({
    label: eventClass,
    value: byClass[eventClass] ?? 0,
    colour: CLASS_META[eventClass].color,
  }));
  const classMax = Math.max(1, ...classRows.map((row) => row.value));

  const severityRows = SEVERITY_BUCKETS.map((low) => {
    const high = low === 80 ? 101 : low + 20;
    const count = acceptedEvents.filter(
      (event) => event.severity_score >= low && event.severity_score < high,
    ).length;
    return { label: `${low}–${low + 20}`, value: count };
  });
  const severityMax = Math.max(1, ...severityRows.map((row) => row.value));

  const sessions = [...new Set(acceptedEvents.map((event) => event.session_id))].sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true }),
  );
  const sessionRows = sessions.map((session) => ({
    label: `Session ${session}`,
    value: acceptedEvents.filter((event) => event.session_id === session).length,
  }));
  const sessionMax = Math.max(1, ...sessionRows.map((row) => row.value));

  const handleExport = () => {
    const rows = acceptedEvents.map((event) => ({
      session_id: event.session_id,
      class: event.class,
      peak_time: event.peak_time,
      start_time: event.start_time,
      end_time: event.end_time,
      severity_score: event.severity_score,
      confidence_score: event.confidence_score,
      provenance: event.provenance,
      latitude: event.gps?.latitude ?? '',
      longitude: event.gps?.longitude ?? '',
      start_row: event.start_row,
      end_row: event.end_row,
      peak_row: event.peak_row,
    }));
    downloadCsv('roadpulse-accepted-events.csv', rows, EXPORT_COLUMNS);
  };

  return (
    <section className="panel insights-panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">Detector result distribution</h3>
          <p className="panel-subtitle">
            Derived from the accepted detector output only.
          </p>
        </div>
        <button className="trace-btn small" onClick={handleExport}>
          Export events CSV
        </button>
      </div>

      <div className="insights-grid">
        <div className="insight-block">
          <p className="section-label">Accepted by class</p>
          {classRows.map((row) => (
            <div className="insight-row" key={row.label}>
              <span className="insight-label">{row.label}</span>
              <Bar value={row.value} max={classMax} colour={row.colour} />
              <span className="insight-value">{row.value}</span>
            </div>
          ))}
        </div>

        <div className="insight-block">
          <p className="section-label">Severity score distribution</p>
          {severityRows.map((row) => (
            <div className="insight-row" key={row.label}>
              <span className="insight-label">{row.label}</span>
              <Bar value={row.value} max={severityMax} colour="#4cc2ff" />
              <span className="insight-value">{row.value}</span>
            </div>
          ))}
        </div>

        <div className="insight-block">
          <p className="section-label">Accepted per recorded session</p>
          {sessionRows.map((row) => (
            <div className="insight-row" key={row.label}>
              <span className="insight-label">{row.label}</span>
              <Bar value={row.value} max={sessionMax} colour="#4bbf8f" />
              <span className="insight-value">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
