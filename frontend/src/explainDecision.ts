// Deterministic, non-generative explanations for a recorded detector decision.
// Every statement is derived only from the decision's own stored outcome/evidence
// and the real detector thresholds in detector_summary.json. Nothing is invented.

import { summary } from './data';
import type { ReplayDecision } from './types';

export interface DecisionCheck {
  ok: boolean;
  text: string;
}

export interface DecisionExplanation {
  outcome: 'accepted' | 'suppressed';
  checks: DecisionCheck[];
  thresholds: Array<{ label: string; value: number }>;
}

const REASON_TEXT: Record<string, string> = {
  turning: 'Turning evidence exceeded the suppression condition.',
  horizontal_motion:
    'Horizontal-motion evidence exceeded the suppression condition.',
  noise: 'Insufficient signal — treated as noise, below the accept condition.',
};

export function explainDecision(decision: ReplayDecision): DecisionExplanation {
  const thresholds = summary.thresholds;

  if (decision.decision === 'accepted') {
    if (decision.event_type === 'Sustained Roughness') {
      return {
        outcome: 'accepted',
        checks: [
          {
            ok: true,
            text: 'Persistent rolling-vibration evidence sustained across the window.',
          },
        ],
        thresholds: [
          { label: 'Roughness condition', value: thresholds.roughness },
        ],
      };
    }
    return {
      outcome: 'accepted',
      checks: [
        { ok: true, text: 'Peak vertical impact exceeded the accept condition.' },
        {
          ok: true,
          text: 'Horizontal-motion evidence did not trigger suppression.',
        },
        { ok: true, text: 'Turning evidence did not trigger suppression.' },
      ],
      thresholds: [
        { label: 'Accept peak', value: thresholds.accept_peak },
        { label: 'Candidate peak', value: thresholds.candidate_peak },
        { label: 'Horizontal suppression', value: thresholds.horizontal },
        { label: 'Turning suppression', value: thresholds.turning },
      ],
    };
  }

  const reason = decision.suppression_reason;
  const checks: DecisionCheck[] = [
    {
      ok: false,
      text: reason
        ? (REASON_TEXT[reason] ?? 'Suppressed by the detector.')
        : 'Suppressed by the detector.',
    },
  ];

  let reasonThresholds: Array<{ label: string; value: number }> = [];
  if (reason === 'turning') {
    reasonThresholds = [{ label: 'Turning suppression', value: thresholds.turning }];
  } else if (reason === 'horizontal_motion') {
    reasonThresholds = [
      { label: 'Horizontal suppression', value: thresholds.horizontal },
    ];
  } else {
    reasonThresholds = [
      { label: 'Accept peak', value: thresholds.accept_peak },
      { label: 'Candidate peak', value: thresholds.candidate_peak },
    ];
  }

  return { outcome: 'suppressed', checks, thresholds: reasonThresholds };
}
