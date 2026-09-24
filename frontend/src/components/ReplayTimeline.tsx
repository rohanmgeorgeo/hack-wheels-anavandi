import { SUPPRESSION_LABELS } from '../data';
import type { ReplayDecision } from '../types';

interface ReplayTimelineProps {
  decisions: ReplayDecision[];
  currentTime: number;
  duration: number;
  currentDecisionT: number | null;
  onSeek: (time: number) => void;
}

function tipFor(decision: ReplayDecision): string {
  if (decision.decision === 'accepted') {
    return `${decision.t.toFixed(2)}s · Accepted · ${decision.event_type ?? 'event'}`;
  }
  const reason = decision.suppression_reason
    ? SUPPRESSION_LABELS[decision.suppression_reason]
    : 'unknown';
  return `${decision.t.toFixed(2)}s · Suppressed · ${reason}`;
}

// Real detector-event markers along the recorded timeline. Positions come from
// each decision's actual timestamp; clicking seeks the recorded replay clock.
export default function ReplayTimeline({
  decisions,
  currentTime,
  duration,
  currentDecisionT,
  onSeek,
}: ReplayTimelineProps) {
  const span = duration > 0 ? duration : 1;
  const progress = Math.min(100, Math.max(0, (currentTime / span) * 100));

  return (
    <div className="timeline" role="group" aria-label="Detector event timeline">
      <div className="timeline-track" aria-hidden="true" />
      <div
        className="timeline-fill"
        style={{ width: `${progress}%` }}
        aria-hidden="true"
      />
      {decisions.map((decision, index) => {
        const percent = Math.min(100, Math.max(0, (decision.t / span) * 100));
        const kind = decision.decision === 'accepted' ? 'accepted' : 'suppressed';
        const isCurrent =
          currentDecisionT !== null &&
          Math.abs(decision.t - currentDecisionT) < 1e-9;
        const tip = tipFor(decision);
        return (
          <button
            key={`${decision.t}-${index}`}
            type="button"
            className={`timeline-marker ${kind}${isCurrent ? ' current' : ''}`}
            style={{ left: `${percent}%` }}
            title={tip}
            data-tip={tip}
            aria-label={`Seek to ${tip}`}
            onClick={() => onSeek(decision.t)}
          />
        );
      })}
    </div>
  );
}
