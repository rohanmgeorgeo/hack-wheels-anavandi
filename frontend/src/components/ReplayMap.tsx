import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { CLASS_META } from '../data';
import { useBasemap } from '../basemap';
import { BASE_LAYERS } from '../mapTiles';
import type { ReplayDecision } from '../types';

interface ReplayMapProps {
  sessionId: string;
  bounds: [[number, number], [number, number]] | null;
  track: Array<[number, number]>;
  position: [number, number] | null;
  events: ReplayDecision[];
}

export default function ReplayMap({
  sessionId,
  bounds,
  track,
  position,
  events,
}: ReplayMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const eventLayerRef = useRef<L.LayerGroup | null>(null);
  const trackLineRef = useRef<L.Polyline | null>(null);
  const positionRef = useRef<L.CircleMarker | null>(null);
  const basemap = useBasemap();

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [24.3736, 88.5338],
      zoom: 14,
      zoomControl: true,
    });
    mapRef.current = map;
    eventLayerRef.current = L.layerGroup().addTo(map);
    trackLineRef.current = L.polyline([], {
      color: '#4cc2ff',
      weight: 2,
      opacity: 0.55,
    }).addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      eventLayerRef.current = null;
      trackLineRef.current = null;
      positionRef.current = null;
    };
  }, []);

  // Basemap layer (dark CARTO or OpenStreetMap standard), swapped on change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) {
      map.removeLayer(tileRef.current);
      tileRef.current = null;
    }
    const config = BASE_LAYERS[basemap];
    tileRef.current = L.tileLayer(config.url, {
      maxZoom: config.maxZoom,
      subdomains: config.subdomains,
      attribution: config.attribution,
    }).addTo(map);
    tileRef.current.bringToBack();
  }, [basemap]);

  // Fit the recorded journey extent once per session (stable frame).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bounds) return;
    const timer = window.setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sessionId, bounds]);

  // Rebuild revealed accepted-event markers (never includes GPS-less events).
  useEffect(() => {
    const layer = eventLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    events.forEach((event) => {
      if (event.latitude === null || event.longitude === null) return;
      const color = event.event_type ? CLASS_META[event.event_type].color : '#94a3b8';
      L.circleMarker([event.latitude, event.longitude], {
        radius: 7,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.7,
      })
        .bindTooltip(
          `${event.event_type ?? 'Event'} · t=${event.t.toFixed(2)} s · severity ${event.severity.toFixed(1)}`,
          { direction: 'top', opacity: 0.9 },
        )
        .addTo(layer);
    });
  }, [events]);

  // Grow the recorded GPS track and move the current-position marker.
  useEffect(() => {
    if (trackLineRef.current) trackLineRef.current.setLatLngs(track);
    const map = mapRef.current;
    if (!map) return;
    if (!position) {
      if (positionRef.current) {
        positionRef.current.remove();
        positionRef.current = null;
      }
      return;
    }
    if (!positionRef.current) {
      positionRef.current = L.circleMarker(position, {
        radius: 6,
        color: '#e2e8f0',
        weight: 2,
        fillColor: '#38bdf8',
        fillOpacity: 1,
      }).addTo(map);
    } else {
      positionRef.current.setLatLng(position);
    }
  }, [track, position]);

  return <div className="map-canvas replay-map-canvas" ref={containerRef} />;
}
