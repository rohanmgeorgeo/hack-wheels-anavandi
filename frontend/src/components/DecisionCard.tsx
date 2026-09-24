import {
  CLASS_META,
  EVIDENCE_LABELS,
  formatNumber,
  SUPPRESSION_LABELS,
} from '../data';
import { explainDecision } from '../explainDecision';
import type { ReplayDecision, RoadIssue } from '../types';

interface DecisionCardProps {
  decision: ReplayDecision | null;
  candidateStage: boolean;
  linkedIssue?: RoadIssue | null;
  onViewIssue?: (() => void) | null;
}

const REASON_DESCRIPTIONS: Record<string, string> = {
  turning: 'Sustained yaw / rotational activity.',
  horizontal_motion:
    'Lateral/longitudinal shake without matching vertical impact.',
  noise: 'Isolated vertical spike below the accept threshold.',
};

export default function DecisionCard({
  decision,
  candidateStage,
  linkedIssue = null,
  onViewIssue = null,
}: DecisionCardProps) {
  if (!decision) {
    return (
      <div className="panel decision-card" data-tour="replay-decision">
        <h2 className="panel-title">Latest detector decision</h2>
        <p className="placeholder">Start replay to inspect detector decisions.</p>
      </div>
    );
  }

  const evidence = Object.entries(decision.evidence) as Array<[string, number]>;
  const meta = decision.event_type ? CLASS_META[decision.event_type] : null;
  const resolved = !candidateStage;
  const accepted = decision.decision === 'accepted';
  const explanation = explainDecision(decision);

  const stateClass = !resolved
    ? 'decision-candidate'
    : accepted
      ? 'decision-accepted'
      : 'decision-suppressed';
  const stateLabel = !resolved
    ? 'CANDIDATE DETECTED'
    : accepted
      ? '✓ ACCEPTED'
      : '✕ SUPPRESSED';

  return (
    <div className="panel decision-card" data-tour="replay-decision">
      <div className="panel-head">
        <h2 className="panel-title">Latest detector decision</h2>
        <span className="panel-tag">t = {decision.t.toFixed(2)} s</span>
      </div>

      <div className={`decision-state ${stateClass}`}>{stateLabel}</div>

      {resolved ? (
        <div className="why-block">
          <p className="section-label">
            {accepted ? 'Why accepted' : 'Why suppressed'}
          </p>
          <ul className="why-list">
            {explanation.checks.map((check, index) => (
              <li key={index} className={check.ok ? 'ok' : 'no'}>
                <span className="why-icon" aria-hidden="true">
                  {check.ok ? '✓' : '✕'}
                </span>
                <span>{check.text}</span>
              </li>
            ))}
          </ul>
          {explanation.thresholds.length > 0 ? (
            <details className="why-details">
              <summary>Technical thresholds</summary>
              <ul className="evidence-list">
                {explanation.thresholds.map((threshold) => (
                  <li key={threshold.label}>
                    <span>{threshold.label}</span>
                    <span className="evidence-value">
                      {formatNumber(threshold.value, 4)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="detail-footnote">
                Values from detector_summary.json.
              </p>
            </details>
          ) : null}
        </div>
      ) : null}

      <ul className="evidence-list decision-evidence">
        {evidence.map(([key, value]) => (
          <li key={key}>
            <span>{EVIDENCE_LABELS[key] ?? key}</span>
            <span className="evidence-value">{formatNumber(value, 3)}</span>
          </li>
        ))}
      </ul>

      {resolved && accepted ? (
        <div className="decision-result">
          {meta ? (
            <span className="class-chip" style={{ color: meta.color }}>
              <span className="class-dot" style={{ background: meta.color }} />
              {meta.label}
            </span>
          ) : null}
          <div className="decision-scores">
            <span>
              Severity <strong>{formatNumber(decision.severity, 1)}</strong>
            </span>
            <span>
              Confidence <strong>{formatNumber(decision.confidence, 1)}</strong>
            </span>
          </div>
          <span className="decision-provenance">
            {decision.provenance === 'derived_heuristic'
              ? 'Provenance: derived heuristic (persistent vibration)'
              : 'Provenance: detected impact (threshold + classifier)'}
          </span>
          {linkedIssue && onViewIssue ? (
            <button className="trace-btn" onClick={onViewIssue}>
              View spatial issue
            </button>
          ) : null}
        </div>
      ) : null}

      {resolved && !accepted ? (
        <div className="decision-result">
          <span className="decision-reason">
            Reason:{' '}
            {decision.suppression_reason
              ? SUPPRESSION_LABELS[decision.suppression_reason]
              : 'Unknown'}
          </span>
          <span className="decision-provenance">
            {decision.suppression_reason
              ? REASON_DESCRIPTIONS[decision.suppression_reason]
              : ''}
          </span>
          <span className="decision-provenance">
            Suppressed candidates do not become road observations.
          </span>
        </div>
      ) : null}

      <p className="disclaimer">
        Actual detector decision for this recorded candidate. Severity and
        confidence are prototype analytical scores, not official road-safety
        ratings.
      </p>
    </div>
  );
}
