// Single source of truth: the Python detector outputs are imported at build
// time straight from data/demo/processed. No events, coordinates or statistics
// are hard-coded or duplicated here.

import eventsRaw from '../../data/demo/processed/events.json';
import summaryRaw from '../../data/demo/processed/detector_summary.json';

import type {
  DetectorSummary,
  EventClass,
  EventRecord,
  EventsFile,
} from './types';

export const eventsFile = eventsRaw as unknown as EventsFile;
export const summary = summaryRaw as unknown as DetectorSummary;

/** Accepted events only (events.json already contains accepted events). */
export const acceptedEvents: EventRecord[] = eventsFile.events;

/** Candidates the detector suppressed, with an explicit reason. */
export const suppressedCandidates: EventRecord[] = eventsFile.suppressed_candidates;

/** Accepted events that carry real source GPS. Events without GPS are excluded. */
export const gpsEvents: EventRecord[] = acceptedEvents.filter(
  (event) => event.gps !== null,
);

export interface ClassMeta {
  label: string;
  color: string;
  rgb: string;
  description: string;
}

export const CLASS_META: Record<EventClass, ClassMeta> = {
  Pothole: {
    label: 'Pothole',
    color: '#f87171',
    rgb: '248, 113, 113',
    description: 'Source-supported RoadSens label.',
  },
  Bump: {
    label: 'Bump / Speed Breaker',
    color: '#fbbf24',
    rgb: '251, 191, 36',
    description: 'Source-supported RoadSens label.',
  },
  'Sustained Roughness': {
    label: 'Sustained Roughness',
    color: '#a78bfa',
    rgb: '167, 139, 250',
    description: 'Derived heuristic based on persistent vibration.',
  },
};

export function classMeta(eventClass: EventClass | null): ClassMeta | null {
  if (!eventClass) return null;
  return CLASS_META[eventClass] ?? null;
}

/** Stable identity for an event record across the JSON payload. */
export function eventKey(event: EventRecord): string {
  return `${event.session_id}:${event.class}:${event.start_row}:${event.peak_row ?? 'x'}`;
}

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function formatSeconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)} s`;
}

export function formatTimeRange(start: number | null, end: number | null): string {
  if (start === null || end === null) return '—';
  return `${start.toFixed(2)} s – ${end.toFixed(2)} s`;
}

export function formatCoords(gps: { latitude: number; longitude: number }): string {
  return `${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}`;
}
