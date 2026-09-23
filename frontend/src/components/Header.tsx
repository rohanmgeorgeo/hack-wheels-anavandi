import { summary } from '../data';
import type { View } from '../types';

interface HeaderProps {
  view: View;
  onViewChange: (view: View) => void;
  onStartDemo: () => void;
}

const TABS: Array<{ key: View; label: string }> = [
  { key: 'operations', label: 'Operations' },
  { key: 'replay', label: 'Journey Replay' },
  { key: 'issues', label: 'Road Issues' },
];

export default function Header({ view, onViewChange, onStartDemo }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span className="brand-pin" />
        </div>
        <div className="brand-text">
          <h1>RoadPulse</h1>
          <p className="tagline">Passive Road Intelligence from Public Buses</p>
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
      </div>
      <span className="header-context">Prototype · {summary.dataset}</span>
    </header>
  );
}
