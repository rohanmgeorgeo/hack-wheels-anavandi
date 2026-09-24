// URL deep-linking for view + selection state. Uses the History API only
// (no router dependency). Query params: view, event, issue, session.

import { useEffect } from 'react';

import type { View } from './types';

const VIEWS: View[] = ['operations', 'replay', 'issues'];

export interface UrlState {
  view: View;
  event: string | null;
  issue: string | null;
  session: string | null;
}

export function readUrlState(): Partial<UrlState> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  return {
    view:
      viewParam && VIEWS.includes(viewParam as View)
        ? (viewParam as View)
        : undefined,
    event: params.get('event'),
    issue: params.get('issue'),
    session: params.get('session'),
  };
}

export function useUrlSync(state: UrlState): void {
  useEffect(() => {
    const params = new URLSearchParams();
    if (state.view !== 'operations') params.set('view', state.view);
    if (state.event) params.set('event', state.event);
    if (state.issue) params.set('issue', state.issue);
    if (state.session) params.set('session', state.session);
    const search = params.toString();
    const url = `${window.location.pathname}${search ? `?${search}` : ''}`;
    try {
      window.history.replaceState(null, '', url);
    } catch {
      // Ignore history failures (e.g. sandboxed/file contexts).
    }
  }, [state.view, state.event, state.issue, state.session]);
}
