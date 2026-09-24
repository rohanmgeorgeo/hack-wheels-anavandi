// Guided-tour preference persistence. localStorage only; no user data, no backend.

const TOUR_KEY = 'roadpulse-tour-completed-v1';

export function hasSeenTour(): boolean {
  try {
    return window.localStorage.getItem(TOUR_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTourSeen(): void {
  try {
    window.localStorage.setItem(TOUR_KEY, '1');
  } catch {
    // Ignore storage failures (private mode, etc.).
  }
}

/** Reset helper for development/debugging. Not exposed in the UI. */
export function resetTourPreference(): void {
  try {
    window.localStorage.removeItem(TOUR_KEY);
  } catch {
    // Ignore.
  }
}
