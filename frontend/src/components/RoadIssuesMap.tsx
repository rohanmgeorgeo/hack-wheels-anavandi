import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { CLASS_META } from '../data';
import { useBasemap } from '../basemap';
import { BASE_LAYERS } from '../mapTiles';
import { dominantClass } from '../roadIssues';
import type { RoadIssue } from '../types';

interface RoadIssuesMapProps {
  issues: RoadIssue[];
  selectedId: string | null;
  onSelect: (issue: RoadIssue) => void;
}

function issueColor(issue: RoadIssue): string {
  const dominant = dominantClass(issue);
  return dominant ? CLASS_META[dominant].color : '#94a3b8';
}

function baseRadius(issue: RoadIssue): number {
  return 9 + Math.min(issue.observation_count, 10) * 1.2;
}

export default function RoadIssuesMap({
  issues,
  selectedId,
  onSelect,
}: RoadIssuesMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Record<string, L.CircleMarker>>({});
  const baseRadiusRef = useRef<Record<string, number>>({});
  const basemap = useBasemap();

  const bounds = useMemo(() => {
    const box = L.latLngBounds([]);
    issues.forEach((issue) =>
      box.extend([issue.center.latitude, issue.center.longitude]),
    );
    return box.isValid() ? box : null;
  }, [issues]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [24.3736, 88.5338],
      zoom: 14,
      zoomControl: true,
    });
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      layerRef.current = null;
      markersRef.current = {};
      baseRadiusRef.current = {};
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bounds) return;
    const timer = window.setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bounds]);

  // Build one marker per real issue center (once; issues are static).
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    markersRef.current = {};
    baseRadiusRef.current = {};

    issues.forEach((issue) => {
      const color = issueColor(issue);
      const radius = baseRadius(issue);
      const marker = L.circleMarker(
        [issue.center.latitude, issue.center.longitude],
        {
          radius,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.75,
        },
      );
      marker.bindTooltip(
        `${issue.issue_id} · ${issue.observation_count} observation${
          issue.observation_count === 1 ? '' : 's'
        } · ${issue.distinct_session_count} recorded session${
          issue.distinct_session_count === 1 ? '' : 's'
        }`,
        { direction: 'top', opacity: 0.9 },
      );
      marker.on('click', () => onSelect(issue));
      marker.addTo(layer);
      markersRef.current[issue.issue_id] = marker;
      baseRadiusRef.current[issue.issue_id] = radius;
    });
  }, [issues, onSelect]);

  // Reflect the selected issue clearly.
  useEffect(() => {
    issues.forEach((issue) => {
      const marker = markersRef.current[issue.issue_id];
      if (!marker) return;
      const isSelected = issue.issue_id === selectedId;
      const radius = baseRadiusRef.current[issue.issue_id] ?? baseRadius(issue);
      marker.setStyle({
        color: isSelected ? '#f8fafc' : issueColor(issue),
        weight: isSelected ? 4 : 2,
        fillOpacity: isSelected ? 0.95 : 0.75,
      });
      marker.setRadius(isSelected ? radius + 3 : radius);
      if (isSelected) marker.bringToFront();
    });
  }, [issues, selectedId]);

  return <div className="map-canvas issues-map-canvas" ref={containerRef} />;
}
