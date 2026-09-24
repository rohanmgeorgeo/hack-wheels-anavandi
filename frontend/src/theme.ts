import { useSyncExternalStore } from 'react';

import { createPreferenceStore } from './store';

export type Theme = 'dark' | 'light';

const THEMES: Theme[] = ['dark', 'light'];

function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem('roadpulse-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Ignore.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

const store = createPreferenceStore<Theme>(
  'roadpulse-theme',
  initialTheme(),
  THEMES,
  (theme) => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = theme;
    }
  },
);

export function setTheme(theme: Theme): void {
  store.set(theme);
}

export function useTheme(): Theme {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
