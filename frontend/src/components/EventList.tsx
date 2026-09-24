import { useMemo, useState } from 'react';

import { CLASS_META, formatSeconds } from '../data';
import {
  filterByClass,
  searchEvents,
  sessionOptions,
  sortEvents,
  eventTime,
} from '../eventFilters';
import type { EventClassFilter, EventSort } from '../eventFilters';
import { observationIdForEvent } from '../traceability';
import type { EventRecord } from '../types';

interface EventListProps {
  events: EventRecord[];
  selectedEventId: string | null;
  onSelectEvent: (event: EventRecord) => void;
}

const CLASS_FILTERS: Array<{ key: EventClassFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'Pothole', label: 'Pothole' },
  { key: 'Bump', label: 'Bump' },
  { key: 'Sustained Roughness', label: 'Roughness' },
];

const SORTS: Array<{ key: EventSort; label: string }> = [
  { key: 'severity', label: 'Severity (high → low)' },
  { key: 'time', label: 'Recorded time' },
  { key: 'class', label: 'Event class' },
];

export default function EventList({
  events,
  selectedEventId,
  onSelectEvent,
}: EventListProps) {
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState<EventClassFilter>('all');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [sort, setSort] = useState<EventSort>('severity');

  const sessions = useMemo(() => sessionOptions(events), [events]);

  const visible = useMemo(() => {
    let result = searchEvents(events, query);
    result = filterByClass(result, classFilter);
    if (sessionFilter !== 'all') {
      result = result.filter((event) => event.session_id === sessionFilter);
    }
    return sortEvents(result, sort);
  }, [events, query, classFilter, sessionFilter, sort]);

  return (
    <section className="panel event-list-panel">
      <div className="panel-head">
        <h3 className="panel-title">Event list</h3>
        <span className="panel-tag">
          {visible.length} of {events.length}
        </span>
      </div>

      <div className="event-filters">
        <input
          type="search"
          className="search-input"
          placeholder="Search events…"
          value={query}
          onChange={(changeEvent) => setQuery(changeEvent.target.value)}
          aria-label="Search events"
        />

        <div className="filter-row" role="group" aria-label="Event class filter">
          {CLASS_FILTERS.map((option) => (
            <button
              key={option.key}
              className={`filter-btn${classFilter === option.key ? ' active' : ''}`}
              onClick={() => setClassFilter(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="event-select-row">
          <label className="select-field">
            <span>Session</span>
            <select
              value={sessionFilter}
              onChange={(changeEvent) => setSessionFilter(changeEvent.target.value)}
            >
              <option value="all">All sessions</option>
              {sessions.map((session) => (
                <option key={session} value={session}>
                  Session {session}
                </option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span>Sort</span>
            <select
              value={sort}
              onChange={(changeEvent) =>
                setSort(changeEvent.target.value as EventSort)
              }
            >
              {SORTS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="placeholder">No events match the current filters.</p>
      ) : (
        <ul className="event-list">
          {visible.map((event) => {
            const colour = event.class ? CLASS_META[event.class].color : 'var(--text-3)';
            const id = observationIdForEvent(event) ?? `${event.session_id}:${event.start_row}`;
            const isSelected = selectedEventId === id;
            return (
              <li key={id}>
                <button
                  className={`event-row${isSelected ? ' active' : ''}`}
                  onClick={() => onSelectEvent(event)}
                >
                  <span
                    className="class-dot"
                    style={{ background: colour }}
                    aria-hidden="true"
                  />
                  <span className="event-row-main">
                    <span className="event-row-title">
                      {event.class ?? 'Unclassified'}
                    </span>
                    <span className="event-row-meta">
                      Session {event.session_id} ·{' '}
                      {formatSeconds(eventTime(event))} ·{' '}
                      {event.gps ? 'real GPS' : 'no GPS'}
                    </span>
                  </span>
                  <span className="event-row-sev">
                    {event.severity_score.toFixed(1)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
