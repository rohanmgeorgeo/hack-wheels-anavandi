import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import DecisionCard from './DecisionCard';
import ReplayChart from './ReplayChart';
import ReplayMap from './ReplayMap';
import ReplayTimeline from './ReplayTimeline';
import TracePipeline from './TracePipeline';
import BasemapToggle from './BasemapToggle';
import { CLASS_META, SUPPRESSION_LABELS } from '../data';
import { useReplaySessions } from '../replayData';
import { findIssueForReplayDecision } from '../traceability';
import type { IssueTrace, ReplayDecision, ReplaySeekRequest } from '../types';

const SPEEDS = [1, 4, 10];
const WINDOW_SECONDS = 5;
const FEED_LIMIT = 8;

interface JourneyReplayProps {
  sessionId: string;
  onSessionChange: (sessionId: string) => void;
  seekRequest: ReplaySeekRequest | null;
  onSeekConsumed: () => void;
  onViewIssue: (issueId: string, trace: IssueTrace) => void;
  demoActive: boolean;
  onDismissDemo: () => void;
}

export default function JourneyReplay({
  sessionId,
  onSessionChange,
  seekRequest,
  onSeekConsumed,
  onViewIssue,
  demoActive,
  onDismissDemo,
}: JourneyReplayProps) {
  const { sessions: replaySessions, ready: sessionsReady } = useReplaySessions();
  const session = useMemo(
    () =>
      replaySessions.find((item) => item.session_id === sessionId) ??
      replaySessions[0],
    [sessionId, replaySessions],
  );

  const samples = session?.samples ?? [];
  const decisions = session?.decisions ?? [];
  const duration = session?.duration_seconds ?? 0;

  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [completed, setCompleted] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  // Reset the replay whenever the recorded session changes.
  useEffect(() => {
    setCurrentTime(0);
    setPlaying(false);
    setCompleted(false);
  }, [sessionId]);

  // Apply an explicit seek request (e.g. "Replay at event" or Demo Flow) once.
  // This seeks the recorded clock; it does not run live processing. The request
  // is consumed immediately so it cannot re-apply on a later normal remount.
  useEffect(() => {
    if (!seekRequest || seekRequest.sessionId !== sessionId) return;
    setPlaying(false);
    setCompleted(false);
    setCurrentTime(Math.min(seekRequest.time, duration));
    if (seekRequest.speed !== undefined) setSpeed(seekRequest.speed);
    onSeekConsumed();
  }, [seekRequest, sessionId, duration, onSeekConsumed]);

  // Replay clock: advance recorded time by real elapsed time * speed.
  useEffect(() => {
    if (!playing) {
      lastTsRef.current = null;
      return;
    }
    const tick = (ts: number) => {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const delta = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setCurrentTime((prev) => Math.min(duration, prev + delta * speed));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, speed, duration]);

  useEffect(() => {
    if (playing && duration > 0 && currentTime >= duration) {
      setPlaying(false);
      setCompleted(true);
    }
  }, [playing, currentTime, duration]);

  const revealedCount = useMemo(() => {
    let count = 0;
    for (const decision of decisions) {
      if (decision.t <= currentTime) count += 1;
      else break;
    }
    return count;
  }, [decisions, currentTime]);

  const latest = revealedCount > 0 ? decisions[revealedCount - 1] : null;

  const latestIssue = useMemo(
    () => (latest ? findIssueForReplayDecision(sessionId, latest) : null),
    [latest, sessionId],
  );

  const handleViewLatestIssue = useCallback(() => {
    if (!latest || !latestIssue) return;
    onViewIssue(latestIssue.issue_id, {
      issueId: latestIssue.issue_id,
      source: 'replay',
      sessionId,
      eventTime: latest.t,
    });
  }, [latest, latestIssue, onViewIssue, sessionId]);

  const acceptedSoFar = useMemo(
    () =>
      decisions
        .slice(0, revealedCount)
        .filter((decision) => decision.decision === 'accepted').length,
    [decisions, revealedCount],
  );
  const suppressedSoFar = revealedCount - acceptedSoFar;
  const totalAccepted = useMemo(
    () => decisions.filter((decision) => decision.decision === 'accepted').length,
    [decisions],
  );
  const totalSuppressed = decisions.length - totalAccepted;

  // Briefly show the real candidate before revealing its real resolution.
  const [candidateStage, setCandidateStage] = useState(false);
  useEffect(() => {
    if (!latest) {
      setCandidateStage(false);
      return;
    }
    setCandidateStage(true);
    const timer = window.setTimeout(() => setCandidateStage(false), 700);
    return () => window.clearTimeout(timer);
  }, [latest]);

  const sampleIndex = useMemo(() => {
    let lo = 0;
    let hi = samples.length - 1;
    let answer = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].t <= currentTime) {
        answer = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return answer;
  }, [samples, currentTime]);

  const currentSample = sampleIndex >= 0 ? samples[sampleIndex] : null;

  const sessionBounds = useMemo<
    [[number, number], [number, number]] | null
  >(() => {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const sample of samples) {
      if (sample.latitude === null || sample.longitude === null) continue;
      if (sample.latitude < minLat) minLat = sample.latitude;
      if (sample.latitude > maxLat) maxLat = sample.latitude;
      if (sample.longitude < minLng) minLng = sample.longitude;
      if (sample.longitude > maxLng) maxLng = sample.longitude;
    }
    if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null;
    return [
      [minLat, minLng],
      [maxLat, maxLng],
    ];
  }, [samples]);

  const track = useMemo<Array<[number, number]>>(() => {
    if (sampleIndex < 0) return [];
    const step = Math.max(1, Math.floor(samples.length / 500));
    const points: Array<[number, number]> = [];
    for (let index = 0; index <= sampleIndex; index += step) {
      const sample = samples[index];
      if (sample.latitude !== null && sample.longitude !== null) {
        points.push([sample.latitude, sample.longitude]);
      }
    }
    const last = samples[sampleIndex];
    if (last.latitude !== null && last.longitude !== null) {
      points.push([last.latitude, last.longitude]);
    }
    return points;
  }, [samples, sampleIndex]);

  const position: [number, number] | null =
    currentSample &&
    currentSample.latitude !== null &&
    currentSample.longitude !== null
      ? [currentSample.latitude, currentSample.longitude]
      : null;

  const revealedGpsEvents = useMemo(
    () =>
      decisions
        .slice(0, revealedCount)
        .filter(
          (decision) =>
            decision.decision === 'accepted' &&
            decision.latitude !== null &&
            decision.longitude !== null,
        ),
    [decisions, revealedCount],
  );

  const feed = useMemo(
    () =>
      decisions
        .slice(0, revealedCount)
        .slice(-FEED_LIMIT)
        .reverse(),
    [decisions, revealedCount],
  );

  const handlePlayPause = () => {
    if (completed) {
      setCurrentTime(0);
      setCompleted(false);
      setPlaying(true);
      return;
    }
    setPlaying((prev) => !prev);
  };

  const handleRestart = () => {
    setPlaying(false);
    setCurrentTime(0);
    setCompleted(false);
  };

  const handleSeek = (value: number) => {
    setPlaying(false);
    setCompleted(false);
    setCurrentTime(value);
  };

  // Seek the recorded clock to a real decision timestamp (timeline / feed / demo).
  const handleSeekToDecision = (decision: ReplayDecision) => {
    setPlaying(false);
    setCompleted(false);
    setCurrentTime(Math.min(duration, Math.max(0, decision.t)));
  };

  const firstDecision = decisions[0] ?? null;
  const firstAcceptedDecision =
    decisions.find((decision) => decision.decision === 'accepted') ?? null;

  const jumpToDecision = (direction: 'next' | 'prev') => {
    if (direction === 'next') {
      const next = decisions.find((decision) => decision.t > currentTime + 1e-6);
      if (next) handleSeekToDecision(next);
    } else {
      const previous = [...decisions]
        .reverse()
        .find((decision) => decision.t < currentTime - 1e-6);
      if (previous) handleSeekToDecision(previous);
    }
  };

  const handleDemoStep = (decision: ReplayDecision | null) => {
    if (decision) handleSeekToDecision(decision);
  };

  const handleDemoTrace = () => {
    if (latestIssue) handleViewLatestIssue();
  };

  // Replay keyboard: space toggles play/pause, arrows scrub ±1s.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'SELECT' ||
        tag === 'TEXTAREA' ||
        tag === 'BUTTON'
      ) {
        return;
      }
      if (target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === ' ') {
        event.preventDefault();
        if (completed) {
          setCurrentTime(0);
          setCompleted(false);
          setPlaying(true);
        } else {
          setPlaying((prev) => !prev);
        }
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setPlaying(false);
        setCurrentTime((prev) => Math.max(0, prev - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setPlaying(false);
        setCurrentTime((prev) => Math.min(duration, prev + 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [completed, duration]);

  const statusLabel = completed
    ? 'Replay complete'
    : playing
      ? 'Playing'
      : currentTime > 0
        ? 'Paused'
        : 'Ready';

  if (!sessionsReady) {
    return (
      <main className="app-main replay">
        <div className="panel">
          <p className="placeholder">Loading recorded replay data…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-main replay">
      {demoActive ? (
        <div className="panel demo-strip">
          <div className="demo-strip-head">
            <span className="demo-badge">DEMO FLOW</span>
            <span className="demo-title">
              Follow one real recorded observation end to end
            </span>
            <button className="demo-dismiss" onClick={onDismissDemo}>
              Dismiss
            </button>
          </div>
          <ol className="demo-steps">
            <li className="demo-step">
              <span className="demo-step-num">1</span>
              <span>Sensor evidence</span>
            </li>
            <li className="demo-step">
              <span className="demo-step-num">2</span>
              <button
                className="demo-step-btn"
                onClick={() => handleDemoStep(firstDecision)}
                disabled={!firstDecision}
              >
                Detector decision
              </button>
            </li>
            <li className="demo-step">
              <span className="demo-step-num">3</span>
              <button
                className="demo-step-btn"
                onClick={() => handleDemoStep(firstAcceptedDecision)}
                disabled={!firstAcceptedDecision}
              >
                Accepted observation
              </button>
            </li>
            <li className="demo-step">
              <span className="demo-step-num">4</span>
              <button
                className="demo-step-btn"
                onClick={handleDemoTrace}
                disabled={!latestIssue}
              >
                Spatial issue
              </button>
            </li>
          </ol>
          <p className="demo-note">
            Also show one suppressed candidate — RoadPulse does not turn every
            shake into a road issue.
          </p>
          <TracePipeline
            stage={latest && latest.decision === 'accepted' ? 'observation' : 'decision'}
            compact
          />
        </div>
      ) : null}

      <div className="panel replay-console">
        <div className="console-top">
          <div>
            <h2 className="console-title">Recorded RoadSens Journey Replay</h2>
            <span className="console-note">
              Recorded replay · real detector decisions · not live bus
              processing
            </span>
          </div>
          <label className="replay-session">
            <span>Session</span>
            <select
              value={sessionId}
              onChange={(changeEvent) => onSessionChange(changeEvent.target.value)}
            >
              {replaySessions.map((item) => {
                const accepted = item.decisions.filter(
                  (decision) => decision.decision === 'accepted',
                ).length;
                const suppressed = item.decisions.length - accepted;
                return (
                  <option key={item.session_id} value={item.session_id}>
                    Session {item.session_id} · {accepted} accepted ·{' '}
                    {suppressed} suppressed · {item.duration_seconds.toFixed(1)}s
                  </option>
                );
              })}
            </select>
          </label>
        </div>

        <div className="console-bottom">
          <div className="control-row">
            <button className="control-btn primary" onClick={handlePlayPause}>
              {playing ? 'Pause' : completed ? 'Replay again' : 'Play'}
            </button>
            <button className="control-btn" onClick={handleRestart}>
              Restart
            </button>
            <button
              className="control-btn"
              onClick={() => jumpToDecision('prev')}
              title="Previous detector event"
            >
              Prev event
            </button>
            <button
              className="control-btn"
              onClick={() => jumpToDecision('next')}
              title="Next detector event"
            >
              Next event
            </button>
            <div className="speed-group" role="group" aria-label="Replay speed">
              {SPEEDS.map((option) => (
                <button
                  key={option}
                  className={`speed-btn${speed === option ? ' active' : ''}`}
                  onClick={() => setSpeed(option)}
                >
                  {option}x
                </button>
              ))}
            </div>
          </div>
          <span className={`replay-status${completed ? ' completed' : ''}`}>
            {statusLabel}
          </span>
        </div>

        <div className="replay-progress">
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.01}
            value={currentTime}
            onChange={(changeEvent) =>
              handleSeek(Number(changeEvent.target.value))
            }
            aria-label="Replay position"
          />
          <ReplayTimeline
            decisions={decisions}
            currentTime={currentTime}
            duration={duration}
            currentDecisionT={latest ? latest.t : null}
            onSeek={handleSeek}
          />
          <div className="progress-meta">
            <span>{currentTime.toFixed(2)} s</span>
            <span>{duration.toFixed(2)} s</span>
          </div>
        </div>
      </div>

      <div className="replay-body">
        <div className="panel replay-signals" data-tour="replay-signals">
          <div className="panel-head">
            <h3 className="panel-title">Sensor &amp; evidence traces</h3>
            <span className="panel-tag">rolling {WINDOW_SECONDS}s window</span>
          </div>
          <ReplayChart
            samples={samples}
            currentTime={currentTime}
            windowSeconds={WINDOW_SECONDS}
          />
          <p className="panel-note">
            Values are the recorded gravity-relative vertical acceleration,
            unsigned horizontal acceleration magnitude, yaw/turning evidence and
            rolling vibration RMS.
          </p>
        </div>

        <div className="replay-side">
          <DecisionCard
            decision={latest}
            candidateStage={candidateStage}
            linkedIssue={latestIssue}
            onViewIssue={latestIssue ? handleViewLatestIssue : null}
          />

          <div className="panel replay-counters">
            <div className="counter">
              <span className="counter-value">{acceptedSoFar}</span>
              <span className="counter-label">accepted so far</span>
              <span className="counter-total">of {totalAccepted}</span>
            </div>
            <div className="counter">
              <span className="counter-value">{suppressedSoFar}</span>
              <span className="counter-label">suppressed so far</span>
              <span className="counter-total">of {totalSuppressed}</span>
            </div>
            <div className="counter">
              <span className="counter-value">{revealedGpsEvents.length}</span>
              <span className="counter-label">GPS revealed</span>
              <span className="counter-total">real source coordinates</span>
            </div>
          </div>

          <div className="panel replay-feed">
            <div className="panel-head">
              <h3 className="panel-title">Decision feed</h3>
              <span className="panel-tag">latest first</span>
            </div>
            {feed.length === 0 ? (
              <p className="placeholder">No decisions yet.</p>
            ) : (
              <ul>
                {feed.map((decision, index) => (
                  <li key={`${decision.t}-${decision.start_row}-${index}`}>
                    <button
                      className={`feed-item ${decision.decision}`}
                      onClick={() => handleSeekToDecision(decision)}
                      title={`Seek to ${decision.t.toFixed(2)}s`}
                    >
                      <span className="feed-time">
                        {decision.t.toFixed(2)}s
                      </span>
                      <span className="feed-icon">
                        {decision.decision === 'accepted' ? '✓' : '✕'}
                      </span>
                      <span className="feed-label">
                        {decision.decision === 'accepted'
                          ? decision.event_type
                            ? CLASS_META[decision.event_type].label
                            : 'Accepted'
                          : `Suppressed · ${
                              decision.suppression_reason
                                ? SUPPRESSION_LABELS[decision.suppression_reason]
                                : ''
                            }`}
                      </span>
                      {decision.decision === 'accepted' ? (
                        <span className="feed-sev">
                          sev {decision.severity.toFixed(1)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="panel replay-map-panel" data-tour="replay-map">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Revealed accepted GPS events</h3>
            <p className="panel-subtitle">
              {revealedGpsEvents.length} accepted event
              {revealedGpsEvents.length === 1 ? '' : 's'} with real source GPS
              revealed so far.
            </p>
          </div>
        </div>
        <ReplayMap
          sessionId={sessionId}
          bounds={sessionBounds}
          track={track}
          position={position}
          events={revealedGpsEvents}
        />
        <div className="map-footer replay-map-footer">
          <BasemapToggle />
          <p className="map-caption replay-caption">
            Track and markers use real recorded RoadSens GPS coordinates. Markers
            appear when their recorded event time is reached. Not road-network map
            matching.
          </p>
        </div>
      </div>
    </main>
  );
}
