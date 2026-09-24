import { useEffect } from 'react';

interface TourWelcomeProps {
  onStart: () => void;
  onDismiss: () => void;
}

// First-visit welcome prompt. Compact centered panel on desktop, comfortable
// modal on mobile.
export default function TourWelcome({ onStart, onDismiss }: TourWelcomeProps) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onDismiss]);

  return (
    <div className="tour-root">
      <div className="tour-backdrop" />
      <div
        className="tour-welcome"
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to RoadPulse"
      >
        <span className="tour-eyebrow">RoadPulse</span>
        <h2 className="tour-welcome-title">
          Every routine bus trip can become a road-condition survey.
        </h2>
        <p className="tour-body">
          RoadPulse analyzes recorded bus sensor data, separates likely road
          disturbances from vehicle motion, preserves accepted observations with
          real GPS, and groups nearby observations into spatial road issues.
        </p>
        <p className="tour-note">
          Current demo uses recorded RoadSens-4M data — not live bus telemetry.
        </p>
        <div className="tour-footer">
          <button className="tour-btn" onClick={onDismiss}>
            Explore on my own
          </button>
          <button className="tour-btn primary" onClick={onStart}>
            Start 30-second tour
          </button>
        </div>
      </div>
    </div>
  );
}
