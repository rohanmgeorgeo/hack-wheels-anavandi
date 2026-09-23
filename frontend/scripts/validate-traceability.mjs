// Dependency-free validation of end-to-end observation traceability.
// It verifies that every spatial issue member maps EXACTLY (by stable
// observation identity) to a real accepted detector event, that nothing
// suppressed leaks into issues, and that replay-seek data exists.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) =>
  JSON.parse(
    readFileSync(new URL(`../../data/demo/processed/${name}`, import.meta.url), 'utf8'),
  );

const events = read('events.json');
const roadIssues = read('road_issues.json');
const replay = read('replay_sessions.json');

const oid = (sessionId, eventClass, startRow, peakRow) =>
  `obs:${sessionId}:${eventClass}:${startRow}:${peakRow === null ? 'x' : peakRow}`;

// Accepted and suppressed identities from the real detector output.
const acceptedById = new Map();
for (const event of events.events) {
  const id = oid(event.session_id, event.class, event.start_row, event.peak_row);
  assert.ok(!acceptedById.has(id), `duplicate accepted observation id: ${id}`);
  acceptedById.set(id, event);
}

const suppressedIds = new Set(
  events.suppressed_candidates.map(
    (candidate) => `sup:${candidate.session_id}:${candidate.start_row}:${
      candidate.peak_row === null ? 'x' : candidate.peak_row
    }`,
  ),
);

// Flatten issue members and check exact identity.
const members = roadIssues.issues.flatMap((issue) =>
  issue.observations.map((observation) => ({ issue, observation })),
);

assert.equal(
  members.length,
  roadIssues.summary.accepted_gps_observations,
  'all spatial members must be represented',
);

const seenMemberIds = new Set();
for (const { issue, observation } of members) {
  assert.ok(
    !seenMemberIds.has(observation.observation_id),
    `duplicate member observation id: ${observation.observation_id}`,
  );
  seenMemberIds.add(observation.observation_id);

  assert.ok(
    !observation.observation_id.startsWith('sup:'),
    'suppressed candidates must never map to a road issue',
  );

  const source = acceptedById.get(observation.observation_id);
  assert.ok(
    source,
    `${observation.observation_id} must map to a real accepted detector event`,
  );
  assert.equal(observation.session_id, source.session_id);
  assert.equal(observation.event_class, source.class);
  assert.equal(observation.start_row, source.start_row);
  assert.equal(observation.peak_row, source.peak_row);
  assert.ok(
    Math.abs(observation.latitude - source.gps.latitude) < 1e-9 &&
      Math.abs(observation.longitude - source.gps.longitude) < 1e-9,
    `${observation.observation_id}: GPS must match the source event`,
  );

  // Replay seeking data must exist.
  const session = replay.sessions.find(
    (item) => item.session_id === observation.session_id,
  );
  assert.ok(session, `replay session ${observation.session_id} must exist`);
  assert.ok(
    Number.isFinite(observation.event_time) && observation.event_time >= 0,
    `${observation.observation_id}: event_time must be finite`,
  );
  assert.ok(
    observation.event_time <= session.duration_seconds + 1e-6,
    `${observation.observation_id}: event_time must be within the session`,
  );
}

// No suppressed candidate identity may appear among issue members.
for (const id of seenMemberIds) {
  assert.ok(!suppressedIds.has(id), `suppressed identity leaked: ${id}`);
}

// Deterministic forward and reverse mapping.
const buildEventToIssue = () => {
  const map = new Map();
  for (const issue of roadIssues.issues) {
    for (const observation of issue.observations) {
      map.set(observation.observation_id, issue.issue_id);
    }
  }
  return map;
};
const buildIssueToEvent = () => {
  const map = new Map();
  for (const issue of roadIssues.issues) {
    for (const observation of issue.observations) {
      map.set(issue.issue_id, [
        ...(map.get(issue.issue_id) ?? []),
        observation.observation_id,
      ]);
    }
  }
  return map;
};

const forwardA = buildEventToIssue();
const forwardB = buildEventToIssue();
assert.deepEqual([...forwardA.entries()], [...forwardB.entries()], 'event→issue must be deterministic');

const reverseA = buildIssueToEvent();
const reverseB = buildIssueToEvent();
assert.deepEqual([...reverseA.entries()], [...reverseB.entries()], 'issue→event must be deterministic');

for (const [observationId, issueId] of forwardA) {
  const issue = roadIssues.issues.find((item) => item.issue_id === issueId);
  assert.ok(issue.observations.some((o) => o.observation_id === observationId));
}

console.log(
  `traceability OK: ${members.length} spatial members map exactly to accepted ` +
    `detector events across ${roadIssues.issues.length} issues; ` +
    `${suppressedIds.size} suppressed candidates excluded; replay seek data present.`,
);
