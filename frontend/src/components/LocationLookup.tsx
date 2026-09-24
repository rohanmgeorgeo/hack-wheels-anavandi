import { useEffect, useState } from 'react';

import { reverseGeocode } from '../nominatim';

interface LocationLookupProps {
  latitude: number;
  longitude: number;
}

// Optional OpenStreetMap (Nominatim) nearest-place label. Never blocks the UI.
export default function LocationLookup({
  latitude,
  longitude,
}: LocationLookupProps) {
  const [label, setLabel] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setLabel(null);
    reverseGeocode(latitude, longitude).then((result) => {
      if (cancelled) return;
      setLabel(result);
      setState(result ? 'done' : 'error');
    });
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude]);

  return (
    <div className="location-lookup">
      <span className="location-lookup-label">Nearest OSM place</span>
      <span className="location-lookup-value">
        {state === 'loading' ? 'Looking up…' : (label ?? 'Unavailable offline')}
      </span>
      <span className="location-lookup-note">
        OpenStreetMap Nominatim · requires internet
      </span>
    </div>
  );
}
