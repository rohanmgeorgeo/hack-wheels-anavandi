import { CLASS_META } from '../data';
import type { EventClass } from '../types';

const ORDER: EventClass[] = ['Pothole', 'Bump', 'Sustained Roughness'];

export default function Legend() {
  return (
    <div className="legend" aria-label="Event class legend">
      <span className="legend-title">Event classes</span>
      <ul>
        {ORDER.map((eventClass) => {
          const meta = CLASS_META[eventClass];
          return (
            <li key={eventClass}>
              <span
                className="legend-dot"
                style={{ backgroundColor: meta.color }}
              />
              <span className="legend-label">{meta.label}</span>
            </li>
          );
        })}
      </ul>
      <span className="legend-note">Marker size scales with severity score.</span>
    </div>
  );
}
