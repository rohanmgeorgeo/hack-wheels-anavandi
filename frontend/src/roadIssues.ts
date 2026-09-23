// Pure, deterministic transformations over the generated road_issues.json.
// These do not recompute clustering; they only present the factual output.

import type { EventClass, RoadIssue } from './types';

/** Most frequent event class in an issue; ties broken by class name. */
export function dominantClass(issue: RoadIssue): EventClass | null {
  let best: EventClass | null = null;
  let bestCount = -1;
  for (const [eventClass, count] of Object.entries(issue.class_counts) as Array<
    [EventClass, number]
  >) {
    if (count > bestCount || (count === bestCount && best !== null && eventClass < best)) {
      best = eventClass;
      bestCount = count;
    }
  }
  return best;
}

/** Class counts as an array, ordered by count descending then class name. */
export function classCountEntries(issue: RoadIssue): Array<[EventClass, number]> {
  return (Object.entries(issue.class_counts) as Array<[EventClass, number]>).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
}

/**
 * Deterministic, explainable issue ordering:
 *   1. observation_count descending
 *   2. severity.max descending
 *   3. stable issue_id ascending
 * This is not an official maintenance ranking.
 */
export function sortIssues(issues: RoadIssue[]): RoadIssue[] {
  return [...issues].sort(
    (left, right) =>
      right.observation_count - left.observation_count ||
      right.severity.max - left.severity.max ||
      left.issue_id.localeCompare(right.issue_id),
  );
}

export type IssueFilter = 'all' | 'multi' | 'single';

export function filterIssues(issues: RoadIssue[], filter: IssueFilter): RoadIssue[] {
  if (filter === 'multi') {
    return issues.filter((issue) => issue.observation_count > 1);
  }
  if (filter === 'single') {
    return issues.filter((issue) => issue.observation_count === 1);
  }
  return issues;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}
