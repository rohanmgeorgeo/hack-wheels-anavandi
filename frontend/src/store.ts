// Tiny localStorage-backed preference store shared by theme and basemap.
export interface PreferenceStore<T extends string> {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
}

export function createPreferenceStore<T extends string>(
  key: string,
  fallback: T,
  valid: readonly T[],
  onChange?: (value: T) => void,
): PreferenceStore<T> {
  let value = fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored && (valid as readonly string[]).includes(stored)) {
      value = stored as T;
    }
  } catch {
    // Ignore storage failures.
  }

  const listeners = new Set<() => void>();
  onChange?.(value);

  return {
    get: () => value,
    set: (next) => {
      value = next;
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Ignore.
      }
      onChange?.(next);
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
