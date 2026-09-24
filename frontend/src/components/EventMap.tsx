import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { CLASS_META, eventKey } from '../data';
import { useBasemap } from '../basemap';
import { BASE_LAYERS } from '../mapTiles';
import type { EventRecord } from '../types';

interface EventMapProps {
  events: EventRecord[];
  selected: EventRecord | null;
  onSelect: (event: EventRecord) => void;
  showRoutes: boolean;
}

export default function EventMap({
  events,
  selected,
  onSelect,
  showRoutes,
}: EventMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Record<string, L.CircleMarker>>({});
  const basemap = useBasemap();

  const bounds = useMemo(() => {
    const box = L.latLngBounds([]);
    events.forEach((event) => {
      if (event.gps) box.extend([event.gps.latitude, event.gps.longitude]);
    });
    return box.isValid() ? box : null;
  }, [events]);

  // Initialise the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [24.3736, 88.5338],
      zoom: 14,
      zoomControl: true,
    });
    mapRef.current = map;
    markerLayerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      markerLayerRef.current = null;
      routeLayerRef.current = null;
      markersRef.current = {};
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

  // Fit the view to the real event coordinates whenever they change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bounds) return;
    const timer = window.setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bounds]);

  // Rebuild event markers.
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    markersRef.current = {};

    events.forEach((event) => {
      const gps = event.gps;
      if (!gps) return;
      const color = event.class ? CLASS_META[event.class].color : '#94a3b8';
      const radius = 5 + (Math.min(Math.max(event.severity_score, 0), 100) / 100) * 10;
      const marker = L.circleMarker([gps.latitude, gps.longitude], {
        radius,
        color,
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.35,
        className: 'event-marker',
      });
      marker.bindTooltip(
        `${event.class ?? 'Event'} · session ${event.session_id} · severity ${event.severity_score.toFixed(1)}`,
        { direction: 'top', opacity: 0.9 },
      );
      marker.on('click', () => onSelect(event));
      marker.addTo(layer);
      markersRef.current[eventKey(event)] = marker;
    });
  }, [events, onSelect]);

  // Optional event-order connections (not road-network map matching).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (routeLayerRef.current) {
      routeLayerRef.current.remove();
      routeLayerRef.current = null;
    }
    if (!showRoutes) return;

    const bySession = new Map<string, EventRecord[]>();
    events.forEach((event) => {
      if (!event.gps) return;
      const list = bySession.get(event.session_id) ?? [];
      list.push(event);
      bySession.set(event.session_id, list);
    });

    const group = L.layerGroup();
    bySession.forEach((list) => {
      if (list.length < 2) return;
      const ordered = [...list].sort((a, b) => a.start_row - b.start_row);
      const latlngs = ordered.map(
        (event) => [event.gps!.latitude, event.gps!.longitude] as [number, number],
      );
      L.polyline(latlngs, {
        color: '#38bdf8',
        weight: 1.5,
        opacity: 0.5,
        dashArray: '5 6',
      }).addTo(group);
    });
    group.addTo(map);
    routeLayerRef.current = group;
  }, [events, showRoutes]);

  // Highlight the selected marker and pan to it.
  useEffect(() => {
    if (!selected) return;
    const key = eventKey(selected);
    Object.entries(markersRef.current).forEach(([markerKey, marker]) => {
      const isSelected = markerKey === key;
      marker.setStyle({
        color: isSelected ? '#f8fafc' : marker.options.color,
        weight: isSelected ? 2.5 : 1.5,
        fillOpacity: isSelected ? 0.85 : 0.35,
      });
      if (isSelected) marker.bringToFront();
    });
    if (selected.gps && mapRef.current) {
      mapRef.current.panTo([selected.gps.latitude, selected.gps.longitude], {
        animate: true,
      });
    }
  }, [selected]);

  return <div className="map-canvas" ref={containerRef} />;
}
