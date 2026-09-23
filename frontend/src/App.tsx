import { useCallback, useState } from 'react';

import DemoStatusBar from './components/DemoStatusBar';
import Header from './components/Header';
import JourneyReplay from './components/JourneyReplay';
import OperationsView from './components/OperationsView';
import RoadIssuesView from './components/RoadIssuesView';
import { replaySessions } from './data';
import { observationIdForEvent } from './traceability';
import type { EventRecord, IssueTrace, ReplaySeekRequest, View } from './types';

export default function App() {
  const [view, setView] = useState<View>('operations');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [issueTrace, setIssueTrace] = useState<IssueTrace | null>(null);
  const [replaySessionId, setReplaySessionId] = useState<string>(
    replaySessions[0]?.session_id ?? '',
  );
  const [replaySeek, setReplaySeek] = useState<ReplaySeekRequest | null>(null);
  const [demoActive, setDemoActive] = useState(false);

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
    const target =
      replaySessions.find((session) => session.session_id === '4')?.session_id ??
      replaySessions[0]?.session_id ??
      '';
    setReplaySessionId(target);
    setReplaySeek({ sessionId: target, time: 0, speed: 4, nonce: Date.now() });
    setDemoActive(true);
    setView('replay');
  }, []);

  return (
    <div className="app">
      <Header view={view} onViewChange={setView} onStartDemo={startDemo} />

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

      <DemoStatusBar />

      <footer className="app-footer">
        <p>
          Dashboard data and analysis render fully offline from local detector
          output. OpenStreetMap map tiles require internet connectivity; if they
          are unavailable, the analytical panels still render.
        </p>
      </footer>
    </div>
  );
}
