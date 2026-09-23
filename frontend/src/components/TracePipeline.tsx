import type { PipelineStage } from '../types';

const STAGES: Array<{ key: PipelineStage; label: string }> = [
  { key: 'sensor', label: 'Sensor evidence' },
  { key: 'decision', label: 'Detector decision' },
  { key: 'observation', label: 'Accepted observation' },
  { key: 'issue', label: 'Spatial issue' },
];

interface TracePipelineProps {
  stage: PipelineStage;
  compact?: boolean;
}

export default function TracePipeline({ stage, compact }: TracePipelineProps) {
  const activeIndex = STAGES.findIndex((item) => item.key === stage);
  return (
    <ol className={`trace-pipeline${compact ? ' compact' : ''}`}>
      {STAGES.map((item, index) => {
        const state =
          index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'todo';
        return (
          <li key={item.key} className={`trace-step ${state}`}>
            <span className="trace-dot" aria-hidden="true" />
            <span className="trace-step-label">{item.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
