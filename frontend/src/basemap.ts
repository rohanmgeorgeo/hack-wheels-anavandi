import { useSyncExternalStore } from 'react';

import { createPreferenceStore } from './store';

export type Basemap = 'dark' | 'osm';

const BASEMAPS: Basemap[] = ['dark', 'osm'];

const store = createPreferenceStore<Basemap>('roadpulse-basemap', 'dark', BASEMAPS);

export function setBasemap(basemap: Basemap): void {
  store.set(basemap);
}

export function useBasemap(): Basemap {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
