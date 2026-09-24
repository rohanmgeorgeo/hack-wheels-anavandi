// Local, browser-side store for test sensing sessions captured on a fleet
// device. Uses IndexedDB directly (no dependency). This is the phone-side
// acquisition buffer only; the verified RoadPulse detector remains unchanged.

export interface FleetJourney {
  id: string;
  vehicleId: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  motionSampleCount: number;
  gpsFixCount: number;
  locationAvailable: boolean;
  storageStatus: 'saved' | 'error';
}

export interface MotionSample {
  id?: number;
  journeyId: string;
  t: number;
  ax: number | null;
  ay: number | null;
  az: number | null;
  agx: number | null;
  agy: number | null;
  agz: number | null;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}

export interface GpsSample {
  id?: number;
  journeyId: string;
  t: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

const DB_NAME = 'roadpulse-fleet';
const DB_VERSION = 1;
const STORES = ['journeys', 'motion_samples', 'gps_samples'] as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function openFleetDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB is unavailable'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('journeys')) {
          db.createObjectStore('journeys', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('motion_samples')) {
          const store = db.createObjectStore('motion_samples', {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('journeyId', 'journeyId', { unique: false });
        }
        if (!db.objectStoreNames.contains('gps_samples')) {
          const store = db.createObjectStore('gps_samples', {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('journeyId', 'journeyId', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveSession(
  journey: FleetJourney,
  motion: MotionSample[],
  gps: GpsSample[],
): Promise<void> {
  const db = await openFleetDb();
  const tx = db.transaction([...STORES], 'readwrite');
  tx.objectStore('journeys').put(journey);
  const motionStore = tx.objectStore('motion_samples');
  motion.forEach((sample) => motionStore.add(sample));
  const gpsStore = tx.objectStore('gps_samples');
  gps.forEach((sample) => gpsStore.add(sample));
  await transactionDone(tx);
}

export async function listSessions(): Promise<FleetJourney[]> {
  const db = await openFleetDb();
  const tx = db.transaction('journeys', 'readonly');
  const request = tx.objectStore('journeys').getAll();
  const result = await new Promise<FleetJourney[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as FleetJourney[]);
    request.onerror = () => reject(request.error);
  });
  return result.sort((a, b) => b.startedAt - a.startedAt);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await openFleetDb();
  const tx = db.transaction([...STORES], 'readwrite');
  tx.objectStore('journeys').delete(id);
  for (const storeName of ['motion_samples', 'gps_samples'] as const) {
    const index = tx.objectStore(storeName).index('journeyId');
    const request = index.openCursor(IDBKeyRange.only(id));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  }
  await transactionDone(tx);
}

export async function getSessionExport(id: string): Promise<{
  journey: FleetJourney | null;
  motion: MotionSample[];
  gps: GpsSample[];
}> {
  const db = await openFleetDb();
  const tx = db.transaction([...STORES], 'readonly');
  const journeyRequest = tx.objectStore('journeys').get(id);
  const journey = await new Promise<FleetJourney | null>((resolve, reject) => {
    journeyRequest.onsuccess = () =>
      resolve((journeyRequest.result as FleetJourney) ?? null);
    journeyRequest.onerror = () => reject(journeyRequest.error);
  });

  const readByIndex = (storeName: 'motion_samples' | 'gps_samples') =>
    new Promise<unknown[]>((resolve, reject) => {
      const index = tx.objectStore(storeName).index('journeyId');
      const request = index.getAll(IDBKeyRange.only(id));
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });

  const motion = (await readByIndex('motion_samples')) as MotionSample[];
  const gps = (await readByIndex('gps_samples')) as GpsSample[];
  return { journey, motion, gps };
}
