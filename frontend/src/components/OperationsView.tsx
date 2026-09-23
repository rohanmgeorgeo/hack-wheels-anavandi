import { useMemo, useState } from 'react';

import EventDetails from './EventDetails';
import EventMap from './EventMap';
import FalsePositivePanel from './FalsePositivePanel';
import Legend from './Legend';
import SummaryMetrics from './SummaryMetrics';
import TransparencyPanel from './TransparencyPanel';
import { acceptedEvents, gpsEvents } from '../data';
import type { EventRecord } from '../types';

export default function OperationsView() {
  const defaultEvent = useMemo<EventRecord | null>(() => {
    const ranked = [...gpsEvents].sort(
      (a, b) => b.severity_score - a.severity_score,
    );
    return ranked[0] ?? acceptedEvents[0] ?? null;
  }, []);

  const [selected, setSelected] = useState<EventRecord | null>(defaultEvent);
  const [showRoutes, setShowRoutes] = useState(true);

  return (
    <main className="app-main">
      <SummaryMetrics />

      <div className="content-grid">
        <section className="panel map-panel">
          <div className="panel-head map-head">
            <div>
              <h2 className="panel-title">GPS Event View</h2>
              <p className="panel-subtitle">
                Accepted events with real source GPS. {gpsEvents.length} of{' '}
                {acceptedEvents.length} accepted events are plotted.
              </p>
            </div>
            <label className="route-toggle">
              <input
                type="checkbox"
                checked={showRoutes}
                onChange={(changeEvent) => setShowRoutes(changeEvent.target.checked)}
              />
              <span>Event-order connections</span>
            </label>
          </div>

          <EventMap
            events={gpsEvents}
            selected={selected}
            onSelect={setSelected}
            showRoutes={showRoutes}
          />

          <div className="map-footer">
            <Legend />
            <p className="map-caption">
              Connections are straight lines between detected events in the same
              session, ordered by row. This is <strong>not</strong> road-segment
              map matching. Events without GPS are never plotted.
            </p>
          </div>
        </section>

        <aside className="side-column">
          <EventDetails event={selected} />
        </aside>
      </div>

      <div className="bottom-grid">
        <FalsePositivePanel />
        <TransparencyPanel />
      </div>
    </main>
  );
}
