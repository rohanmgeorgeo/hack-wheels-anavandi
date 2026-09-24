// Reverse geocoding via the OpenStreetMap Nominatim API.
// Optional enhancement: results are cached in memory + localStorage, requests
// are rate-limited to respect the Nominatim usage policy, and any failure
// degrades silently (the analytical UI never depends on this).

const STORAGE_PREFIX = 'roadpulse-geocode:';
const cache = new Map<string, string | null>();
let lastRequestAt = 0;

function readStored(key: string): string | null | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return undefined;
    return raw === '__null__' ? null : raw;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + key,
      value === null ? '__null__' : value,
    );
  } catch {
    // Ignore.
  }
}

export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const stored = readStored(key);
  if (stored !== undefined) {
    cache.set(key, stored);
    return stored;
  }

  // Nominatim policy: at most ~1 request per second.
  const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestAt = Date.now();

  try {
    const url =
      'https://nominatim.openstreetmap.org/reverse' +
      `?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as { display_name?: string };
    const label = data.display_name
      ? data.display_name.split(',').slice(0, 3).join(',').trim()
      : null;
    cache.set(key, label);
    writeStored(key, label);
    return label;
  } catch {
    cache.set(key, null);
    return null;
  }
}
