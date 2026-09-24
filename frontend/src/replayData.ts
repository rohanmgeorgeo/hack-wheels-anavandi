import { useEffect, useSyncExternalStore } from 'react';

import type { ReplayFile, ReplaySession } from './types';

// Journey Replay data is loaded on demand (dynamic import) so the large
// recorded-sample payload is not part of the initial bundle. Consumers use the
// hook; imperative callers can use loadReplaySessions().

let sessions: ReplaySession[] | null = null;
let loading: Promise<ReplaySession[]> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isReady(): boolean {
  return sessions !== null;
}

export function loadReplaySessions(): Promise<ReplaySession[]> {
  if (sessions) return Promise.resolve(sessions);
  if (!loading) {
    loading = import('../../data/demo/processed/replay_sessions.json').then(
      (module) => {
        sessions = (module.default as unknown as ReplayFile).sessions;
        notify();
        return sessions;
      },
    );
  }
  return loading;
}

export function getReplaySessions(): ReplaySession[] | null {
  return sessions;
}

export function useReplaySessions(): {
  sessions: ReplaySession[];
  ready: boolean;
} {
  const ready = useSyncExternalStore(subscribe, isReady, () => false);
  useEffect(() => {
    void loadReplaySessions();
  }, []);
  return { sessions: sessions ?? [], ready };
}
