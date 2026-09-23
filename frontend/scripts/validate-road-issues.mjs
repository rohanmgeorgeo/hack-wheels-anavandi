// Dependency-free build-time validation of the generated road_issues.json.
// It checks that the data the Road Issues view consumes is internally
// consistent and factual. It does not recompute clustering.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = new URL('../../data/demo/processed/road_issues.json', import.meta.url);
const payload = JSON.parse(readFileSync(path, 'utf8'));

const { summary, issues, association_method: method } = payload;

assert.ok(Array.isArray(issues) && issues.length > 0, 'issues must be a non-empty array');
assert.equal(summary.issue_count, issues.length, 'issue_count must equal issues length');

const represented = issues.reduce((total, issue) => total + issue.observation_count, 0);
assert.equal(
  represented,
  summary.accepted_gps_observations,
  'summed observation_count must equal accepted_gps_observations',
);

let multiObservation = 0;
let multiSession = 0;

for (const issue of issues) {
  assert.ok(issue.issue_id, 'issue_id required');
  assert.equal(
    issue.observation_count,
    issue.observations.length,
    `${issue.issue_id}: observation_count must match member list`,
  );
  assert.equal(
    issue.distinct_session_count,
    issue.session_ids.length,
    `${issue.issue_id}: distinct_session_count must match session_ids`,
  );
  assert.equal(
    new Set(issue.session_ids).size,
    issue.session_ids.length,
    `${issue.issue_id}: session_ids must be unique`,
  );
  assert.ok(
    Number.isFinite(issue.center.latitude) && Number.isFinite(issue.center.longitude),
    `${issue.issue_id}: center must be finite`,
  );

  const classTotal = Object.values(issue.class_counts).reduce((a, b) => a + b, 0);
  assert.equal(
    classTotal,
    issue.observation_count,
    `${issue.issue_id}: class_counts must sum to observation_count`,
  );

  const latSum = issue.observations.reduce((a, o) => a + o.latitude, 0);
  const lonSum = issue.observations.reduce((a, o) => a + o.longitude, 0);
  const meanLat = latSum / issue.observations.length;
  const meanLon = lonSum / issue.observations.length;
  assert.ok(
    Math.abs(issue.center.latitude - meanLat) < 1e-5 &&
      Math.abs(issue.center.longitude - meanLon) < 1e-5,
    `${issue.issue_id}: center must be derived from member coordinates`,
  );

  for (const observation of issue.observations) {
    assert.ok(
      Number.isFinite(observation.latitude) && Number.isFinite(observation.longitude),
      `${issue.issue_id}: member coordinates must be real numbers`,
    );
  }

  if (issue.observation_count > 1) multiObservation += 1;
  if (issue.distinct_session_count > 1) multiSession += 1;
}

assert.equal(
  summary.multi_observation_issue_count,
  multiObservation,
  'multi_observation_issue_count must be factual',
);
assert.equal(
  summary.multi_session_issue_count,
  multiSession,
  'multi_session_issue_count must be factual',
);
assert.ok(method && method.type, 'association_method.type required');

// Deterministic, explainable ordering used by the UI.
const order = (list) =>
  [...list].sort(
    (a, b) =>
      b.observation_count - a.observation_count ||
      b.severity.max - a.severity.max ||
      a.issue_id.localeCompare(b.issue_id),
  );
const first = order(issues).map((issue) => issue.issue_id);
const second = order(issues).map((issue) => issue.issue_id);
assert.deepEqual(first, second, 'issue ordering must be deterministic');
assert.equal(new Set(first).size, issues.length, 'ordering must be a permutation');

console.log(
  `road_issues.json OK: ${issues.length} issues, ${represented} GPS observations, ` +
    `${multiObservation} multi-observation, ${multiSession} multi-session ` +
    `(radius ${method.radius_meters} m, ${method.distance_metric}).`,
);
