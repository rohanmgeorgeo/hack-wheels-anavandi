import { summary } from '../data';
import type { View } from '../types';

interface HeaderProps {
  view: View;
  onViewChange: (view: View) => void;
}

const TABS: Array<{ key: View; label: string }> = [
  { key: 'operations', label: 'Operations' },
  { key: 'replay', label: 'Journey Replay' },
  { key: 'issues', label: 'Road Issues' },
];

export default function Header({ view, onViewChange }: HeaderProps) {
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

      <div className="header-right">
        <nav className="view-tabs" aria-label="Dashboard views">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className={`view-tab${view === tab.key ? ' active' : ''}`}
              onClick={() => onViewChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="header-badges">
          <span className="badge badge-accent">Prototype</span>
          <span className="badge">Public {summary.dataset} data</span>
          <span className="badge badge-muted">Subset: {summary.subset}</span>
        </div>
      </div>
    </header>
  );
}
