import { summary } from '../data';
import type { View } from '../types';

interface HeaderProps {
  view: View;
  onViewChange: (view: View) => void;
}

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
          <button
            className={`view-tab${view === 'operations' ? ' active' : ''}`}
            onClick={() => onViewChange('operations')}
          >
            Operations
          </button>
          <button
            className={`view-tab${view === 'replay' ? ' active' : ''}`}
            onClick={() => onViewChange('replay')}
          >
            Journey Replay
          </button>
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
