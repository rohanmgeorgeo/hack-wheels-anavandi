import { setBasemap, useBasemap } from '../basemap';

// Compact dark/OSM basemap switch shown in map footers.
export default function BasemapToggle() {
  const basemap = useBasemap();
  return (
    <div className="segmented" role="group" aria-label="Basemap">
      <button
        className={`segmented-item${basemap === 'dark' ? ' active' : ''}`}
        onClick={() => setBasemap('dark')}
      >
        Dark
      </button>
      <button
        className={`segmented-item${basemap === 'osm' ? ' active' : ''}`}
        onClick={() => setBasemap('osm')}
      >
        OSM
      </button>
    </div>
  );
}
