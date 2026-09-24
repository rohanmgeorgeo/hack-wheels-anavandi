// Exact, deterministic observation identity shared across the three views.
//
// The identity format matches the Python observation store exactly:
//   obs:<session_id>:<event_class>:<start_row>:<peak_row| x>
// A link between an event and a spatial issue is created ONLY when this stable
// identity matches exactly. There is no nearest-neighbour or fuzzy matching.

import { acceptedEvents, roadIssues } from './data';
import type { EventRecord, ReplayDecision, RoadIssue } from './types';

export function observationId(
  sessionId: string,
  eventClass: string,
  startRow: number,
  peakRow: number | null,
): string {
  return `obs:${sessionId}:${eventClass}:${startRow}:${peakRow === null ? 'x' : peakRow}`;
}

export function observationIdForEvent(event: EventRecord): string | null {
  if (!event.class) return null;
  return observationId(event.session_id, event.class, event.start_row, event.peak_row);
}

export function observationIdForReplayDecision(
  sessionId: string,
  decision: ReplayDecision,
): string | null {
  if (decision.decision !== 'accepted' || !decision.event_type) return null;
  return observationId(
    sessionId,
    decision.event_type,
    decision.start_row,
    decision.peak_row,
  );
}

const eventByObservationId = new Map<string, EventRecord>();
for (const event of acceptedEvents) {
  const id = observationIdForEvent(event);
  if (id) eventByObservationId.set(id, event);
}

const issueByObservationId = new Map<string, RoadIssue>();
const issueByIssueId = new Map<string, RoadIssue>();
for (const issue of roadIssues) {
  issueByIssueId.set(issue.issue_id, issue);
  for (const observation of issue.observations) {
    issueByObservationId.set(observation.observation_id, issue);
  }
}

export function findEventForObservationId(
  observationIdValue: string,
): EventRecord | null {
  return eventByObservationId.get(observationIdValue) ?? null;
}

export function findIssueForObservationId(
  observationIdValue: string,
): RoadIssue | null {
  return issueByObservationId.get(observationIdValue) ?? null;
}

export function findIssueForEvent(event: EventRecord): RoadIssue | null {
  const id = observationIdForEvent(event);
  return id ? (issueByObservationId.get(id) ?? null) : null;
}

export function findIssueForReplayDecision(
  sessionId: string,
  decision: ReplayDecision,
): RoadIssue | null {
  const id = observationIdForReplayDecision(sessionId, decision);
  return id ? (issueByObservationId.get(id) ?? null) : null;
}

export function findIssueById(issueId: string): RoadIssue | null {
  return issueByIssueId.get(issueId) ?? null;
}
