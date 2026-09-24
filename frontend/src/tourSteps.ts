// The five-step "How RoadPulse Works" tour. All factual counts are derived from
// the generated data, never hard-coded.

import { acceptedEvents, roadIssuesSummary } from './data';
import type { View } from './types';

const acceptedTotal = acceptedEvents.length;
const gpsTotal = roadIssuesSummary.accepted_gps_observations;
const issueCount = roadIssuesSummary.issue_count;
const multiObservation = roadIssuesSummary.multi_observation_issue_count;
const crossSession = roadIssuesSummary.multi_session_issue_count;

export interface TourStep {
  id: string;
  view: View;
  target: string;
  title: string;
  body: string;
  extra?: string;
  note?: string;
  action?: 'showExample';
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'idea',
    view: 'operations',
    target: '[data-tour="app-header"]',
    title: 'Every bus trip can become a road survey',
    body:
      'RoadPulse uses recorded bus sensor data to identify unusual road ' +
      'disturbances without requiring dedicated road-survey vehicles.',
    note:
      'This prototype replays recorded RoadSens-4M data — not live bus telemetry.',
  },
  {
    id: 'sensors',
    view: 'replay',
    target: '[data-tour="replay-signals"]',
    title: 'First, understand the motion',
    body:
      'RoadPulse derives gravity-relative vertical acceleration, horizontal ' +
      'vehicle-motion evidence, turning/yaw evidence, and rolling vibration RMS.',
    extra:
      'Vertical peaks can indicate road impacts. Horizontal or turning ' +
      'evidence may indicate the bus itself.',
  },
  {
    id: 'decision',
    view: 'replay',
    target: '[data-tour="replay-decision"]',
    title: 'Not every shake is road damage',
    body:
      'Each candidate is checked for contradictory vehicle-motion evidence. ' +
      'RoadPulse can accept a road disturbance or suppress likely turning, ' +
      'horizontal-motion, or noise false positives.',
    extra:
      'This is one of RoadPulse’s core ideas: did the road cause the ' +
      'disturbance, or did the bus?',
    action: 'showExample',
  },
  {
    id: 'gps',
    view: 'replay',
    target: '[data-tour="replay-map"]',
    title: 'Accepted observations become geolocated evidence',
    body:
      'When an accepted observation has real source GPS, RoadPulse can place it ' +
      'on the map. Observations without source GPS are preserved analytically ' +
      'but are never assigned fabricated coordinates.',
    extra: `${gpsTotal} of ${acceptedTotal} accepted observations have real GPS.`,
  },
  {
    id: 'issues',
    view: 'issues',
    target: '[data-tour="issues-map"]',
    title: 'From events to road intelligence',
    body:
      'Nearby accepted GPS observations are associated into spatial issues ' +
      'using a 10 m Haversine proximity rule.',
    extra:
      `Current demo: ${issueCount} spatial issues · ${multiObservation} contain ` +
      `multiple observations · ${crossSession} contain observations from ` +
      'multiple recorded sessions.',
    note:
      'Multi-observation does not mean multi-bus. With real fleet deployment, ' +
      'repeated journeys over the same roads could add cross-session ' +
      'corroboration and support maintenance intelligence.',
  },
];
