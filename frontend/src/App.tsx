import { useCallback, useEffect, useMemo, useState } from 'react';

import DemoStatusBar from './components/DemoStatusBar';
import Header from './components/Header';
import JourneyReplay from './components/JourneyReplay';
import OperationsView from './components/OperationsView';
import RoadIssuesView from './components/RoadIssuesView';
import TourOverlay from './components/TourOverlay';
import TourWelcome from './components/TourWelcome';
import { loadReplaySessions, useReplaySessions } from './replayData';
import { observationIdForEvent } from './traceability';
import { TOUR_STEPS } from './tourSteps';
import { hasSeenTour, markTourSeen, resetTourPreference } from './tourStorage';
import { readUrlState, useUrlSync } from './urlState';
import type {
  EventRecord,
  IssueTrace,
  ReplaySeekRequest,
  ReplaySession,
  View,
} from './types';

export default function App() {
  const initialUrl = useMemo(() => readUrlState(), []);
  const { sessions: replaySessions, ready: replayReady } = useReplaySessions();
  const [view, setView] = useState<View>(initialUrl.view ?? 'operations');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    initialUrl.event ?? null,
  );
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(
    initialUrl.issue ?? null,
  );
  const [issueTrace, setIssueTrace] = useState<IssueTrace | null>(null);
  const [replaySessionId, setReplaySessionId] = useState<string>(
    initialUrl.session ?? '',
  );
  const [replaySeek, setReplaySeek] = useState<ReplaySeekRequest | null>(null);
  const [demoActive, setDemoActive] = useState(false);

  const [showWelcome, setShowWelcome] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  // First visit: offer the guided tour once (persisted in localStorage).
  useEffect(() => {
    if (!hasSeenTour()) setShowWelcome(true);
  }, []);

  // Resolve the replay session once the recorded data has loaded.
  useEffect(() => {
    if (!replayReady || replaySessions.length === 0) return;
    setReplaySessionId((current) => {
      if (current && replaySessions.some((s) => s.session_id === current)) {
        return current;
      }
      const candidate = initialUrl.session;
      if (candidate && replaySessions.some((s) => s.session_id === candidate)) {
        return candidate;
      }
      return replaySessions[0].session_id;
    });
  }, [replayReady, replaySessions, initialUrl.session]);


  // Development-only reset hook; never exposed as a visible control.
  useEffect(() => {
    const isDev =
      (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
    if (!isDev) return;
    (window as unknown as { roadpulseResetTour?: () => void }).roadpulseResetTour =
      () => {
        resetTourPreference();
        setTourStep(0);
        setTourActive(false);
        setShowWelcome(true);
      };
  }, []);

  // Keep the URL in sync so views/selections are shareable and refresh-safe.
  useUrlSync({
    view,
    event: selectedEventId,
    issue: selectedIssueId,
    session: replaySessionId,
  });

  // Keyboard shortcuts: 1/2/3 switch views (ignored while a dialog is open).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '1') setView('operations');
      else if (event.key === '2') setView('replay');
      else if (event.key === '3') setView('issues');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Open the exact spatial issue that contains an observation (no fuzzy match).
  const openIssue = useCallback((issueId: string, trace: IssueTrace) => {
    setSelectedIssueId(issueId);
    setIssueTrace(trace);
    setView('issues');
  }, []);

  // Select an Operations event by its stable observation identity.
  const selectEvent = useCallback((event: EventRecord) => {
    setSelectedEventId(observationIdForEvent(event));
  }, []);

  const inspectEvent = useCallback((observationId: string) => {
    setSelectedEventId(observationId);
    setView('operations');
  }, []);

  const replayAt = useCallback(
    (sessionId: string, time: number, speed?: number) => {
      setReplaySessionId(sessionId);
      setReplaySeek({ sessionId, time, speed, nonce: Date.now() });
      setView('replay');
    },
    [],
  );

  // A seek request is a one-shot navigation command. JourneyReplay reports
  // consumption so it can never re-apply on a later normal remount.
  const clearReplaySeek = useCallback(() => {
    setReplaySeek(null);
  }, []);

  const startDemo = useCallback(() => {
    const run = (sessions: ReplaySession[]) => {
      const target =
        sessions.find((session) => session.session_id === '4')?.session_id ??
        sessions[0]?.session_id ??
        '';
      setReplaySessionId(target);
      setReplaySeek({ sessionId: target, time: 0, speed: 4, nonce: Date.now() });
      setDemoActive(true);
      setView('replay');
    };
    if (replaySessions.length > 0) run(replaySessions);
    else void loadReplaySessions().then(run);
  }, [replaySessions]);

  const applyTourStep = useCallback((stepIndex: number) => {
    const step = TOUR_STEPS[stepIndex];
    setTourStep(stepIndex);
    setView(step.view);
  }, []);

  const startTour = useCallback(() => {
    markTourSeen();
    setShowWelcome(false);
    setTourActive(true);
    applyTourStep(0);
  }, [applyTourStep]);

  const finishTour = useCallback(() => {
    markTourSeen();
    setTourActive(false);
  }, []);

  const skipTour = useCallback(() => {
    markTourSeen();
    setTourActive(false);
    setShowWelcome(false);
  }, []);

  const dismissWelcome = useCallback(() => {
    markTourSeen();
    setShowWelcome(false);
  }, []);

  const tourNext = useCallback(() => {
    applyTourStep(Math.min(TOUR_STEPS.length - 1, tourStep + 1));
  }, [applyTourStep, tourStep]);

  const tourBack = useCallback(() => {
    applyTourStep(Math.max(0, tourStep - 1));
  }, [applyTourStep, tourStep]);

  // Tour-safe action: seek to a real accepted decision in the recorded session.
  const tourAction = useCallback(
    (action: 'showExample') => {
      if (action !== 'showExample') return;
      const run = (sessions: ReplaySession[]) => {
        const session =
          sessions.find((item) => item.session_id === replaySessionId) ??
          sessions[0];
        if (!session) return;
        const example =
          session.decisions.find(
            (decision) => decision.decision === 'accepted',
          ) ?? session.decisions[0];
        if (!example) return;
        replayAt(session.session_id, Math.max(0, example.t));
      };
      if (replaySessions.length > 0) run(replaySessions);
      else void loadReplaySessions().then(run);
    },
    [replayAt, replaySessionId, replaySessions],
  );

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header
        view={view}
        onViewChange={setView}
        onStartDemo={startDemo}
        onStartTour={startTour}
      />

      <div id="main" className="app-views">
      {view === 'operations' ? (
        <OperationsView
          selectedEventId={selectedEventId}
          onSelectEvent={selectEvent}
          onViewIssue={openIssue}
        />
      ) : null}

      {view === 'replay' ? (
        <JourneyReplay
          sessionId={replaySessionId}
          onSessionChange={setReplaySessionId}
          seekRequest={replaySeek}
          onSeekConsumed={clearReplaySeek}
          onViewIssue={openIssue}
          demoActive={demoActive}
          onDismissDemo={() => setDemoActive(false)}
        />
      ) : null}

      {view === 'issues' ? (
        <RoadIssuesView
          selectedIssueId={selectedIssueId}
          onSelectIssue={setSelectedIssueId}
          onInspectEvent={inspectEvent}
          onReplayEvent={replayAt}
          trace={issueTrace}
        />
      ) : null}
      </div>

      <DemoStatusBar />

      <footer className="app-footer">
        <p>
          Dashboard data and analysis render fully offline from local detector
          output. OpenStreetMap map tiles require internet connectivity; if they
          are unavailable, the analytical panels still render.
        </p>
      </footer>

      {tourActive ? (
        <TourOverlay
          index={tourStep}
          onNext={tourNext}
          onBack={tourBack}
          onSkip={skipTour}
          onFinish={finishTour}
          onAction={tourAction}
        />
      ) : null}

      {showWelcome && !tourActive ? (
        <TourWelcome onStart={startTour} onDismiss={dismissWelcome} />
      ) : null}
    </div>
  );
}
