// Leaflet basemap layers.
//  - "dark": CARTO Dark Matter (built on OpenStreetMap data) for the dark console.
//  - "osm":  the OpenStreetMap standard tile service.
// Tiles require internet connectivity; the analytical UI renders without them.

import type { Basemap } from './basemap';

export interface TileConfig {
  url: string;
  attribution: string;
  subdomains: string;
  maxZoom: number;
}

export const BASE_LAYERS: Record<Basemap, TileConfig> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  },
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: 'abc',
    maxZoom: 19,
  },
};
