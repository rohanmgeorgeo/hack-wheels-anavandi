import { useState } from 'react';

import Header from './components/Header';
import JourneyReplay from './components/JourneyReplay';
import OperationsView from './components/OperationsView';
import RoadIssuesView from './components/RoadIssuesView';
import type { View } from './types';

export default function App() {
  const [view, setView] = useState<View>('operations');

  return (
    <div className="app">
      <Header view={view} onViewChange={setView} />

      {view === 'operations' ? <OperationsView /> : null}
      {view === 'replay' ? <JourneyReplay /> : null}
      {view === 'issues' ? <RoadIssuesView /> : null}

      <footer className="app-footer">
        <p>
          Dashboard data and analysis render fully offline from local detector
          output. OpenStreetMap map tiles require internet connectivity; if they
          are unavailable, the analytical panels still render.
        </p>
      </footer>
    </div>
  );
}
