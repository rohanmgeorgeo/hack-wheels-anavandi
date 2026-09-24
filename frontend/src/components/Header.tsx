import { summary } from '../data';
import { setBasemap } from '../basemap';
import { setTheme, useTheme } from '../theme';
import type { View } from '../types';

interface HeaderProps {
  view: View;
  onViewChange: (view: View) => void;
  onStartDemo: () => void;
  onStartTour: () => void;
}

const TABS: Array<{ key: View; label: string }> = [
  { key: 'operations', label: 'Operations' },
  { key: 'replay', label: 'Journey Replay' },
  { key: 'issues', label: 'Road Issues' },
];

export default function Header({
  view,
  onViewChange,
  onStartDemo,
  onStartTour,
}: HeaderProps) {
  const theme = useTheme();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <header className="app-header" data-tour="app-header">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span className="brand-pin" />
        </div>
        <div className="brand-text">
          <h1>RoadPulse</h1>
          <p className="tagline">Passive Road Intelligence</p>
        </div>
      </div>

      <nav className="app-nav" aria-label="Dashboard views">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`app-nav-item${view === tab.key ? ' active' : ''}`}
            onClick={() => onViewChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="header-actions">
        <button className="demo-btn" onClick={onStartDemo}>
          Demo Flow
        </button>
        <button className="tour-launch" onClick={onStartTour}>
          Tour
        </button>
        <button
          className="tour-launch"
          onClick={() => {
            setTheme(nextTheme);
            setBasemap(nextTheme === 'light' ? 'osm' : 'dark');
          }}
          aria-label={`Switch to ${nextTheme} theme`}
          title={`Switch to ${nextTheme} theme`}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
      <span className="header-context">Recorded · {summary.dataset}</span>
    </header>
  );
}
