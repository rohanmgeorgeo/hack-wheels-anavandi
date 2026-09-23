import { summary } from '../data';

export default function Header() {
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
      <div className="header-badges">
        <span className="badge badge-accent">Prototype</span>
        <span className="badge">Public {summary.dataset} data</span>
        <span className="badge badge-muted">Subset: {summary.subset}</span>
      </div>
    </header>
  );
}
