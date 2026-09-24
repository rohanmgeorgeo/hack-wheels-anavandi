import { useCallback, useEffect, useRef, useState } from 'react';

import { downloadJson } from '../export';
import {
  deleteSession,
  getSessionExport,
  isIndexedDbAvailable,
  listSessions,
  saveSession,
} from '../fleetStorage';
import type { FleetJourney, GpsSample, MotionSample } from '../fleetStorage';

type SensorState = 'idle' | 'active' | 'denied' | 'unavailable';

interface LiveMotion {
  ax: number | null;
  ay: number | null;
  az: number | null;
  agx: number | null;
  agy: number | null;
  agz: number | null;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  t: number;
}

interface LiveGps {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  t: number;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

function formatDateTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

function formatValue(value: number | null, digits = 4): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable';
  return value.toFixed(digits);
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className="reading">
      <span className="reading-label">{label}</span>
      <span className={`reading-value${value === 'Unavailable' ? ' dim' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function StatusRow({
  label,
  ready,
  readyText,
  offText,
}: {
  label: string;
  ready: boolean;
  readyText: string;
  offText: string;
}) {
  return (
    <div className="readiness-row">
      <span className="readiness-label">{label}</span>
      <span className={`status-chip ${ready ? 'ready' : 'off'}`}>
        {ready ? `✓ ${readyText}` : `— ${offText}`}
      </span>
    </div>
  );
}

export default function FleetDeviceView() {
  const readiness = useRef({
    secure: typeof window !== 'undefined' ? window.isSecureContext : false,
    motion: typeof DeviceMotionEvent !== 'undefined',
    geolocation:
      typeof navigator !== 'undefined' && 'geolocation' in navigator,
    storage: isIndexedDbAvailable(),
  }).current;

  const [vehicleId, setVehicleId] = useState('');
  const [active, setActive] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [motionState, setMotionState] = useState<SensorState>('idle');
  const [geoState, setGeoState] = useState<SensorState>('idle');
  const [motionCount, setMotionCount] = useState(0);
  const [gpsCount, setGpsCount] = useState(0);
  const [motionNoData, setMotionNoData] = useState(false);
  const [latestMotion, setLatestMotion] = useState<LiveMotion | null>(null);
  const [latestGps, setLatestGps] = useState<LiveGps | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<FleetJourney | null>(null);
  const [sessions, setSessions] = useState<FleetJourney[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const motionSamplesRef = useRef<MotionSample[]>([]);
  const gpsSamplesRef = useRef<GpsSample[]>([]);
  const motionCountRef = useRef(0);
  const gpsCountRef = useRef(0);
  const latestMotionRef = useRef<LiveMotion | null>(null);
  const latestGpsRef = useRef<LiveGps | null>(null);
  const motionHandlerRef = useRef<((event: DeviceMotionEvent) => void) | null>(
    null,
  );
  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const journeyIdRef = useRef<string | null>(null);
  const motionNoDataRef = useRef(false);

  const refreshSessions = useCallback(async () => {
    if (!isIndexedDbAvailable()) {
      setSessions([]);
      return;
    }
    try {
      setSessions(await listSessions());
    } catch {
      setSessions([]);
    }
  }, []);

  const flush = useCallback(() => {
    setMotionCount(motionCountRef.current);
    setGpsCount(gpsCountRef.current);
    setLatestMotion(latestMotionRef.current);
    setLatestGps(latestGpsRef.current);
    if (startedAtRef.current) {
      setDurationMs(Date.now() - startedAtRef.current);
    }
    // Detect desktops that expose the API but never emit motion events.
    if (
      motionHandlerRef.current !== null &&
      motionCountRef.current === 0 &&
      startedAtRef.current !== null &&
      Date.now() - startedAtRef.current > 2500 &&
      !motionNoDataRef.current
    ) {
      motionNoDataRef.current = true;
      setMotionNoData(true);
    }
  }, []);

  const attachMotion = useCallback(() => {
    const handler = (event: DeviceMotionEvent) => {
      const acceleration = event.acceleration;
      const withGravity = event.accelerationIncludingGravity;
      const rotation = event.rotationRate;
      const sample: MotionSample = {
        journeyId: journeyIdRef.current ?? '',
        t: performance.now(),
        ax: acceleration?.x ?? null,
        ay: acceleration?.y ?? null,
        az: acceleration?.z ?? null,
        agx: withGravity?.x ?? null,
        agy: withGravity?.y ?? null,
        agz: withGravity?.z ?? null,
        alpha: rotation?.alpha ?? null,
        beta: rotation?.beta ?? null,
        gamma: rotation?.gamma ?? null,
      };
      motionSamplesRef.current.push(sample);
      motionCountRef.current += 1;
      if (motionNoDataRef.current) {
        motionNoDataRef.current = false;
        setMotionNoData(false);
      }
      latestMotionRef.current = {
        ax: sample.ax,
        ay: sample.ay,
        az: sample.az,
        agx: sample.agx,
        agy: sample.agy,
        agz: sample.agz,
        alpha: sample.alpha,
        beta: sample.beta,
        gamma: sample.gamma,
        t: sample.t,
      };
    };
    motionHandlerRef.current = handler;
    window.addEventListener('devicemotion', handler);
    setMotionState('active');
  }, []);

  const onFix = useCallback((position: GeolocationPosition) => {
    const t = performance.now();
    gpsCountRef.current += 1;
    const sample: GpsSample = {
      journeyId: journeyIdRef.current ?? '',
      t,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: Number.isFinite(position.coords.accuracy)
        ? position.coords.accuracy
        : null,
    };
    gpsSamplesRef.current.push(sample);
    latestGpsRef.current = {
      latitude: sample.latitude,
      longitude: sample.longitude,
      accuracy: sample.accuracy,
      t,
    };
    setGeoState('active');
    setLocationError(null);
  }, []);

  const onGeoError = useCallback((error: GeolocationPositionError) => {
    setGeoState(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
    setLocationError(
      error.code === error.PERMISSION_DENIED
        ? 'Location unavailable — this test session cannot provide geotagged samples.'
        : 'Location lookup failed on this device.',
    );
  }, []);

  const startSession = useCallback(async () => {
    if (active) return;
    setSummary(null);
    setStorageMessage(null);
    setLocationError(null);
    setLatestMotion(null);
    setLatestGps(null);
    motionSamplesRef.current = [];
    gpsSamplesRef.current = [];
    motionCountRef.current = 0;
    gpsCountRef.current = 0;
    latestMotionRef.current = null;
    latestGpsRef.current = null;
    motionNoDataRef.current = false;
    setMotionNoData(false);
    setMotionCount(0);
    setGpsCount(0);

    const journeyId = `fleet-${Date.now()}`;
    journeyIdRef.current = journeyId;
    startedAtRef.current = Date.now();
    setDurationMs(0);

    if (typeof DeviceMotionEvent === 'undefined') {
      setMotionState('unavailable');
    } else {
      try {
        const requestPermission = (
          DeviceMotionEvent as unknown as {
            requestPermission?: () => Promise<'granted' | 'denied'>;
          }
        ).requestPermission;
        if (typeof requestPermission === 'function') {
          const result = await requestPermission();
          if (result === 'granted') {
            attachMotion();
          } else {
            setMotionState('denied');
          }
        } else {
          attachMotion();
        }
      } catch {
        setMotionState('unavailable');
      }
    }

    if (readiness.geolocation) {
      setGeoState('active');
      try {
        watchIdRef.current = navigator.geolocation.watchPosition(
          onFix,
          onGeoError,
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
        );
      } catch {
        setGeoState('unavailable');
      }
    } else {
      setGeoState('unavailable');
    }

    setActive(true);
    timerRef.current = window.setInterval(flush, 250);
  }, [
    active,
    attachMotion,
    flush,
    onFix,
    onGeoError,
    readiness.geolocation,
  ]);

  const stopSession = useCallback(async () => {
    if (motionHandlerRef.current) {
      window.removeEventListener('devicemotion', motionHandlerRef.current);
      motionHandlerRef.current = null;
    }
    if (watchIdRef.current !== null && readiness.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const endedAt = Date.now();
    const started = startedAtRef.current ?? endedAt;
    const journey: FleetJourney = {
      id: journeyIdRef.current ?? `fleet-${started}`,
      vehicleId: vehicleId.trim() || 'BUS-07',
      startedAt: started,
      endedAt,
      durationMs: endedAt - started,
      motionSampleCount: motionCountRef.current,
      gpsFixCount: gpsCountRef.current,
      locationAvailable: gpsCountRef.current > 0,
      storageStatus: 'saved',
    };

    setActive(false);
    setDurationMs(endedAt - started);
    flush();

    if (isIndexedDbAvailable()) {
      try {
        await saveSession(journey, motionSamplesRef.current, gpsSamplesRef.current);
        setStorageMessage('Session saved to the local device database.');
      } catch {
        journey.storageStatus = 'error';
        setStorageMessage('Could not save to the local database on this device.');
      }
    } else {
      journey.storageStatus = 'error';
      setStorageMessage('IndexedDB is unavailable — session was not persisted.');
    }

    setSummary(journey);
    await refreshSessions();
  }, [flush, readiness.geolocation, refreshSessions, vehicleId]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteSession(id);
        if (expandedId === id) setExpandedId(null);
        await refreshSessions();
      } catch {
        setStorageMessage('Could not delete the session on this device.');
      }
    },
    [expandedId, refreshSessions],
  );

  const handleExport = useCallback(async (id: string) => {
    try {
      const data = await getSessionExport(id);
      downloadJson(`roadpulse-fleet-${id}.json`, data);
    } catch {
      setStorageMessage('Could not export the session on this device.');
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
    return () => {
      if (motionHandlerRef.current) {
        window.removeEventListener('devicemotion', motionHandlerRef.current);
      }
      if (watchIdRef.current !== null && readiness.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
    };
  }, [readiness.geolocation, refreshSessions]);

  const pipeline = [
    'Official fleet phone',
    'Accelerometer + motion + GPS',
    'Local offline buffer',
    'Future secure synchronization',
    'RoadPulse processing',
    'Road-condition dashboard',
  ];

  return (
    <main className="app-main fleet-view">
      <div className="panel fleet-intro">
        <h2 className="panel-title">Fleet Device</h2>
        <p className="panel-subtitle">Bus-side smartphone sensing prototype</p>
        <p className="fleet-lead">
          RoadPulse can use the accelerometer, gyroscope/motion sensors and GPS
          already available on an official smartphone carried inside the bus — no
          additional sensing hardware is required.
        </p>
        <p className="disclosure-note">
          The verified RoadPulse detector currently processes recorded RoadSens
          data. This Fleet Device page demonstrates the smartphone acquisition and
          local storage layer. Live phone samples are not currently passed through
          the calibrated detector.
        </p>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">How it works</h3>
        </div>
        <ol className="fleet-pipeline">
          {pipeline.map((step, index) => (
            <li key={step} className="fleet-pipeline-step">
              <span>{step}</span>
              {index < pipeline.length - 1 ? (
                <span className="fleet-pipeline-arrow" aria-hidden="true">
                  ↓
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="panel-note">
          Mobile sensing means the sensing platform moves with the bus. The driver
          should not need to classify or report road damage manually.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Device readiness</h3>
          <span className="panel-tag">detected in this browser</span>
        </div>
        <div className="readiness-grid">
          <StatusRow
            label="Secure connection"
            ready={readiness.secure}
            readyText="HTTPS / secure context"
            offText="not a secure context"
          />
          <StatusRow
            label="Motion API"
            ready={readiness.motion}
            readyText="available"
            offText="unavailable"
          />
          <StatusRow
            label="Location API"
            ready={readiness.geolocation}
            readyText="available"
            offText="unavailable"
          />
          <StatusRow
            label="Local storage"
            ready={readiness.storage}
            readyText="ready (IndexedDB)"
            offText="unavailable"
          />
        </div>
        {!readiness.motion ? (
          <p className="panel-note">
            Motion sensors may not be exposed on this device. Open the deployed
            HTTPS RoadPulse site on a supported smartphone to test sensor
            acquisition.
          </p>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Test sensor session</h3>
          {active ? (
            <span className="active-badge" aria-live="polite">
              ● SENSOR SESSION ACTIVE
            </span>
          ) : null}
        </div>
        <div className="fleet-controls">
          <label className="field">
            <span>Vehicle ID</span>
            <input
              type="text"
              value={vehicleId}
              placeholder="BUS-07"
              onChange={(changeEvent) => setVehicleId(changeEvent.target.value)}
              aria-label="Vehicle ID"
              disabled={active}
            />
          </label>
          {active ? (
            <button className="fleet-action stop" onClick={stopSession}>
              STOP &amp; SAVE SESSION
            </button>
          ) : (
            <button className="fleet-action start" onClick={startSession}>
              START TEST SESSION
            </button>
          )}
        </div>
        <p className="panel-note">
          Prototype control: Start is provided for judging/testing. A fleet
          deployment could initialize sensing automatically through the
          fleet-managed application rather than requiring driver interaction.
        </p>
        {storageMessage ? (
          <p className="fleet-storage-message">{storageMessage}</p>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Live device readings</h3>
          <span className="panel-tag">raw phone axes</span>
        </div>

        <div className="live-summary">
          <div className="counter">
            <span className="counter-value">{formatDuration(durationMs)}</span>
            <span className="counter-label">duration</span>
          </div>
          <div className="counter">
            <span className="counter-value">{motionCount}</span>
            <span className="counter-label">motion samples</span>
          </div>
          <div className="counter">
            <span className="counter-value">{gpsCount}</span>
            <span className="counter-label">GPS fixes</span>
          </div>
        </div>

        <p className="section-label">Raw device motion</p>
        {motionState === 'denied' ? (
          <p className="panel-note">
            Motion permission was denied — no motion acquisition in this session.
          </p>
        ) : motionState === 'unavailable' ? (
          <p className="panel-note">
            Motion sensors are unavailable on this device — no motion acquisition.
          </p>
        ) : motionNoData ? (
          <p className="panel-note">
            Motion sensors may not be exposed on this device. Open the deployed
            HTTPS RoadPulse site on a supported smartphone to test sensor
            acquisition.
          </p>
        ) : null}
        <div className="reading-grid">
          <Reading
            label="Acceleration X"
            value={formatValue(latestMotion?.ax ?? null)}
          />
          <Reading
            label="Acceleration Y"
            value={formatValue(latestMotion?.ay ?? null)}
          />
          <Reading
            label="Acceleration Z"
            value={formatValue(latestMotion?.az ?? null)}
          />
          <Reading
            label="Accel. incl. gravity X"
            value={formatValue(latestMotion?.agx ?? null)}
          />
          <Reading
            label="Accel. incl. gravity Y"
            value={formatValue(latestMotion?.agy ?? null)}
          />
          <Reading
            label="Accel. incl. gravity Z"
            value={formatValue(latestMotion?.agz ?? null)}
          />
          <Reading
            label="Rotation α"
            value={formatValue(latestMotion?.alpha ?? null)}
          />
          <Reading
            label="Rotation β"
            value={formatValue(latestMotion?.beta ?? null)}
          />
          <Reading
            label="Rotation γ"
            value={formatValue(latestMotion?.gamma ?? null)}
          />
          <Reading
            label="Latest sample timestamp"
            value={
              latestMotion ? `${latestMotion.t.toFixed(0)} ms` : 'Unavailable'
            }
          />
        </div>

        <p className="section-label">
          GPS
          {geoState === 'denied'
            ? ' · permission denied'
            : geoState === 'unavailable'
              ? ' · unavailable'
              : geoState === 'active'
                ? ' · acquiring'
                : ''}
        </p>
        {locationError ? (
          <p className="panel-note">{locationError}</p>
        ) : null}
        <div className="reading-grid">
          <Reading
            label="Latitude"
            value={
              latestGps ? latestGps.latitude.toFixed(6) : 'Unavailable'
            }
          />
          <Reading
            label="Longitude"
            value={
              latestGps ? latestGps.longitude.toFixed(6) : 'Unavailable'
            }
          />
          <Reading
            label="Accuracy"
            value={
              latestGps && latestGps.accuracy !== null
                ? `${latestGps.accuracy.toFixed(1)} m`
                : 'Unavailable'
            }
          />
          <Reading
            label="Latest fix timestamp"
            value={latestGps ? `${latestGps.t.toFixed(0)} ms` : 'Unavailable'}
          />
        </div>
        <p className="detail-footnote">
          These are raw phone axes. They are not RoadPulse’s calibrated
          gravity-relative analytical features (vertical impact, horizontal
          motion, roughness), which are produced by a separate processing stage.
        </p>
      </section>

      {summary ? (
        <section className="panel">
          <div className="panel-head">
            <h3 className="panel-title">Session summary</h3>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Session ID</dt>
              <dd>{summary.id}</dd>
            </div>
            <div>
              <dt>Vehicle ID</dt>
              <dd>{summary.vehicleId}</dd>
            </div>
            <div>
              <dt>Start time</dt>
              <dd>{formatDateTime(summary.startedAt)}</dd>
            </div>
            <div>
              <dt>End time</dt>
              <dd>{summary.endedAt ? formatDateTime(summary.endedAt) : '—'}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{formatDuration(summary.durationMs)}</dd>
            </div>
            <div>
              <dt>Motion samples</dt>
              <dd>{summary.motionSampleCount}</dd>
            </div>
            <div>
              <dt>GPS fixes</dt>
              <dd>{summary.gpsFixCount}</dd>
            </div>
            <div>
              <dt>Location available</dt>
              <dd>{summary.locationAvailable ? 'Yes' : 'No'}</dd>
            </div>
            <div>
              <dt>Storage status</dt>
              <dd>
                {summary.storageStatus === 'saved'
                  ? 'Saved locally (IndexedDB)'
                  : 'Not persisted'}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Phone database</h3>
          <span className="panel-tag">IndexedDB</span>
        </div>
        <p className="panel-note">
          Stores captured sessions locally so temporary internet loss does not
          have to stop sensing. Sessions are kept on this device/browser only.
        </p>
        <div className="context-blocks">
          <div className="context-block">
            <h3>Current RoadPulse analytics</h3>
            <p>
              <strong>SQLite</strong> — stores processed journeys, observations
              and spatial issues in the current local analytical prototype.
            </p>
          </div>
          <div className="context-block">
            <h3>Central fleet storage — future</h3>
            <p>
              <strong>PostgreSQL + PostGIS (future option)</strong> for
              production fleet-scale storage and geospatial queries. Not
              implemented in this prototype.
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Saved on this device</h3>
          <span className="panel-tag">{sessions.length}</span>
        </div>
        {sessions.length === 0 ? (
          <p className="placeholder">
            No saved test sessions yet. Start a test session to store one locally.
          </p>
        ) : (
          <ul className="session-list">
            {sessions.map((session) => (
              <li key={session.id} className="session-item">
                <div className="session-item-head">
                  <div>
                    <span className="session-vehicle">
                      {session.vehicleId}
                    </span>
                    <span className="session-id">{session.id}</span>
                  </div>
                  <span className="session-date">
                    {formatDateTime(session.startedAt)}
                  </span>
                </div>
                <div className="session-stats">
                  <span>{formatDuration(session.durationMs)}</span>
                  <span>{session.motionSampleCount} motion</span>
                  <span>{session.gpsFixCount} GPS</span>
                </div>
                <div className="session-actions">
                  <button
                    className="trace-btn small"
                    onClick={() =>
                      setExpandedId((current) =>
                        current === session.id ? null : session.id,
                      )
                    }
                  >
                    View summary
                  </button>
                  <button
                    className="trace-btn small"
                    onClick={() => void handleExport(session.id)}
                  >
                    Export JSON
                  </button>
                  <button
                    className="trace-btn small danger"
                    onClick={() => void handleDelete(session.id)}
                  >
                    Delete
                  </button>
                </div>
                {expandedId === session.id ? (
                  <dl className="detail-list session-detail">
                    <div>
                      <dt>Start</dt>
                      <dd>{formatDateTime(session.startedAt)}</dd>
                    </div>
                    <div>
                      <dt>End</dt>
                      <dd>
                        {session.endedAt ? formatDateTime(session.endedAt) : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Location available</dt>
                      <dd>{session.locationAvailable ? 'Yes' : 'No'}</dd>
                    </div>
                    <div>
                      <dt>Storage</dt>
                      <dd>{session.storageStatus}</dd>
                    </div>
                  </dl>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Who uses RoadPulse?</h3>
        </div>
        <div className="context-blocks">
          <div className="context-block">
            <h3>Bus side</h3>
            <p>
              Official fleet smartphone / managed device → passively collects
              motion and GPS. Passengers do not need to install RoadPulse.
            </p>
          </div>
          <div className="context-block">
            <h3>Operations side</h3>
            <p>
              Transport authority / road-maintenance team → uses Operations,
              Journey Replay and Road Issues. Drivers do not manually report
              potholes.
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">How does RoadPulse get on the phone?</h3>
        </div>
        <p className="panel-note">
          For a pilot, the transport operator can open/install the RoadPulse
          Fleet Device client on an official smartphone assigned to the bus. A
          production deployment could distribute the sensing client through
          managed fleet devices or a packaged mobile application.
        </p>
      </section>
    </main>
  );
}
