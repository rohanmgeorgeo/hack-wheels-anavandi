import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { CLASS_META } from '../data';
import { useBasemap } from '../basemap';
import { BASE_LAYERS } from '../mapTiles';
import { dominantClass } from '../roadIssues';
import type { RoadIssue } from '../types';

interface IssueMiniMapProps {
  issue: RoadIssue;
}

// Compact map of a single spatial issue: its member observations and centre.
export default function IssueMiniMap({ issue }: IssueMiniMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const basemap = useBasemap();

  const members = useMemo(() => issue.observations, [issue]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
    });
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      layerRef.current = null;
    };
  }, []);

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
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const dominant = dominantClass(issue);
    const colour = dominant ? CLASS_META[dominant].color : '#8b98a8';

    members.forEach((member) => {
      L.circleMarker([member.latitude, member.longitude], {
        radius: 5,
        color: colour,
        weight: 1.5,
        fillColor: colour,
        fillOpacity: 0.5,
      }).addTo(layer);
    });

    L.circleMarker([issue.center.latitude, issue.center.longitude], {
      radius: 7,
      color: '#f8fafc',
      weight: 2,
      fillColor: colour,
      fillOpacity: 0.9,
    }).addTo(layer);

    const box = L.latLngBounds(
      members.map((member) => [member.latitude, member.longitude] as [number, number]),
    );
    box.extend([issue.center.latitude, issue.center.longitude]);

    const timer = window.setTimeout(() => {
      map.invalidateSize();
      if (box.isValid()) {
        map.fitBounds(box, { padding: [24, 24], maxZoom: 18 });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [issue, members]);

  return <div className="mini-map" ref={containerRef} />;
}
