import { useMemo } from 'react';

import type { ReplaySample } from '../types';

type ChannelKey =
  | 'vertical_acceleration'
  | 'horizontal_acceleration'
  | 'yaw_rate'
  | 'rolling_rms';

interface Channel {
  key: ChannelKey;
  label: string;
  unit: string;
  color: string;
  signed: boolean;
}

const CHANNELS: Channel[] = [
  {
    key: 'vertical_acceleration',
    label: 'Vertical impact (gravity-relative)',
    unit: 'm/s²',
    color: '#f87171',
    signed: true,
  },
  {
    key: 'horizontal_acceleration',
    label: 'Horizontal motion (unsigned magnitude)',
    unit: 'm/s²',
    color: '#38bdf8',
    signed: false,
  },
  {
    key: 'yaw_rate',
    label: 'Yaw / turning evidence',
    unit: 'rad/s',
    color: '#fbbf24',
    signed: true,
  },
  {
    key: 'rolling_rms',
    label: 'Rolling vibration RMS',
    unit: 'm/s²',
    color: '#a78bfa',
    signed: false,
  },
];

const WIDTH = 1000;
const HEIGHT = 56;
const PAD = 6;

function lowerBound(samples: ReplaySample[], t: number): number {
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface ReplayChartProps {
  samples: ReplaySample[];
  currentTime: number;
  windowSeconds: number;
}

export default function ReplayChart({
  samples,
  currentTime,
  windowSeconds,
}: ReplayChartProps) {
  const ranges = useMemo(() => {
    const out: Record<string, { min: number; max: number }> = {};
    for (const channel of CHANNELS) {
      let min = Infinity;
      let max = -Infinity;
      for (const sample of samples) {
        const value = sample[channel.key];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = -1;
        max = 1;
      }
      if (channel.signed) {
        const magnitude = Math.max(Math.abs(min), Math.abs(max), 1e-6);
        out[channel.key] = { min: -magnitude, max: magnitude };
      } else {
        out[channel.key] = { min: 0, max: Math.max(max, 1e-6) };
      }
    }
    return out;
  }, [samples]);

  const startT = currentTime - windowSeconds;
  const startIndex = lowerBound(samples, startT);
  const endIndex = lowerBound(samples, currentTime + 1e-9);
  const windowSamples = samples.slice(startIndex, endIndex);
  const currentSample = endIndex > 0 ? samples[endIndex - 1] : null;

  return (
    <div className="traces">
      {CHANNELS.map((channel) => {
        const range = ranges[channel.key];
        const span = range.max - range.min || 1;
        const points = windowSamples
          .map((sample) => {
            const x = ((sample.t - startT) / windowSeconds) * WIDTH;
            const y =
              HEIGHT - PAD - ((sample[channel.key] - range.min) / span) * (HEIGHT - 2 * PAD);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ');

        const last = windowSamples.length
          ? windowSamples[windowSamples.length - 1]
          : null;
        const lastX = last ? ((last.t - startT) / windowSeconds) * WIDTH : WIDTH;
        const lastY = last
          ? HEIGHT - PAD - ((last[channel.key] - range.min) / span) * (HEIGHT - 2 * PAD)
          : HEIGHT / 2;
        const value = currentSample ? currentSample[channel.key] : null;

        return (
          <div className="trace" key={channel.key}>
            <div className="trace-head">
              <span className="trace-label" style={{ color: channel.color }}>
                {channel.label}
              </span>
              <span className="trace-value">
                {value === null ? '—' : `${value.toFixed(3)} ${channel.unit}`}
              </span>
            </div>
            <svg
              className="trace-svg"
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={channel.label}
            >
              {channel.signed ? (
                <line
                  className="trace-zero"
                  x1={0}
                  y1={HEIGHT / 2}
                  x2={WIDTH}
                  y2={HEIGHT / 2}
                />
              ) : null}
              <polyline
                className="trace-line"
                points={points}
                fill="none"
                stroke={channel.color}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              {last ? <circle cx={lastX} cy={lastY} r={3} fill={channel.color} /> : null}
              <line
                className="trace-playhead"
                x1={WIDTH}
                y1={0}
                x2={WIDTH}
                y2={HEIGHT}
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
