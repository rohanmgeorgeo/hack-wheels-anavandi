// Pure client-side filtering/sorting for the Operations event list.
// Operates only on real accepted detector events.

import type { EventClass, EventRecord } from './types';

export type EventSort = 'severity' | 'time' | 'class';
export type EventClassFilter = 'all' | EventClass;

const CLASS_ORDER: EventClass[] = ['Pothole', 'Bump', 'Sustained Roughness'];

export function eventTime(event: EventRecord): number | null {
  return event.peak_time ?? event.start_time;
}

export function searchEvents(events: EventRecord[], query: string): EventRecord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return events;
  return events.filter((event) => {
    const haystack = [
      event.class ?? '',
      event.session_id,
      event.provenance,
      event.peak_row !== null ? String(event.peak_row) : '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function filterByClass(
  events: EventRecord[],
  filter: EventClassFilter,
): EventRecord[] {
  if (filter === 'all') return events;
  return events.filter((event) => event.class === filter);
}

export function sortEvents(events: EventRecord[], sort: EventSort): EventRecord[] {
  const copy = [...events];
  if (sort === 'severity') {
    copy.sort(
      (a, b) =>
        b.severity_score - a.severity_score ||
        a.session_id.localeCompare(b.session_id) ||
        a.start_row - b.start_row,
    );
  } else if (sort === 'time') {
    copy.sort(
      (a, b) =>
        a.session_id.localeCompare(b.session_id) ||
        (eventTime(a) ?? 0) - (eventTime(b) ?? 0),
    );
  } else {
    copy.sort(
      (a, b) =>
        CLASS_ORDER.indexOf(a.class ?? 'Bump') -
          CLASS_ORDER.indexOf(b.class ?? 'Bump') ||
        b.severity_score - a.severity_score ||
        a.session_id.localeCompare(b.session_id),
    );
  }
  return copy;
}

export function sessionOptions(events: EventRecord[]): string[] {
  return [...new Set(events.map((event) => event.session_id))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}
