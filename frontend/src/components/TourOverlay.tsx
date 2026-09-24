import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties } from 'react';

import { TOUR_STEPS } from '../tourSteps';

interface TourOverlayProps {
  index: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onFinish: () => void;
  onAction: (action: 'showExample') => void;
}

const PAD = 12;
const GAP = 14;
const PANEL_WIDTH = 360;
const DESKTOP_MIN = 1000;

// Lightweight guided-tour overlay: a subtle dim backdrop, a highlight ring on
// the target element, and a compact panel (beside the target on desktop, a
// bottom sheet on smaller screens).
export default function TourOverlay({
  index,
  onNext,
  onBack,
  onSkip,
  onFinish,
  onAction,
}: TourOverlayProps) {
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [isDesktop, setIsDesktop] = useState(
    () => window.innerWidth >= DESKTOP_MIN,
  );
  const [viewport, setViewport] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));

  useLayoutEffect(() => {
    let raf = 0;
    let timer = 0;
    const measure = () => {
      const target = document.querySelector(step.target);
      setRect(target ? target.getBoundingClientRect() : null);
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      setIsDesktop(window.innerWidth >= DESKTOP_MIN);
    };
    raf = requestAnimationFrame(measure);
    // Re-measure after a possible view switch/layout change.
    timer = window.setTimeout(measure, 140);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [index, step.target]);

  useEffect(() => {
    panelRef.current?.focus();
  }, [index]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onSkip();
      }
    },
    [onSkip],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const panelStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isDesktop || !rect) return undefined;
    const { w, h } = viewport;
    const width = Math.min(PANEL_WIDTH, w - PAD * 2);
    const approxHeight = 280;
    const clampLeft = (value: number) =>
      Math.min(Math.max(PAD, value), Math.max(PAD, w - width - PAD));

    // Wide targets (header, full-width maps): prefer below/above, else overlay.
    if (rect.width > w * 0.6) {
      if (rect.bottom + GAP + approxHeight <= h) {
        return { top: rect.bottom + GAP, left: clampLeft(rect.left), width };
      }
      if (rect.top - GAP - approxHeight >= PAD) {
        return {
          top: rect.top - GAP - approxHeight,
          left: clampLeft(rect.left),
          width,
        };
      }
      return {
        top: PAD,
        left: clampLeft(rect.left),
        width,
      };
    }

    let left: number;
    if (rect.right + GAP + width <= w - PAD) {
      left = rect.right + GAP;
    } else if (rect.left - GAP - width >= PAD) {
      left = rect.left - GAP - width;
    } else {
      left = clampLeft(rect.left);
    }
    const top = Math.min(Math.max(PAD, rect.top), Math.max(PAD, h - approxHeight));
    return { left, top, width };
  }, [isDesktop, rect, viewport]);

  const highlightStyle = rect
    ? {
        left: rect.left - 6,
        top: rect.top - 6,
        width: rect.width + 12,
        height: rect.height + 12,
      }
    : undefined;

  return (
    <div className="tour-root">
      <div className="tour-backdrop" />
      {rect ? (
        <div className="tour-highlight" style={highlightStyle} aria-hidden="true" />
      ) : null}
      <div
        className={`tour-panel${isDesktop ? '' : ' sheet'}`}
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        aria-label="How RoadPulse works"
        tabIndex={-1}
        ref={panelRef}
      >
        <div className="tour-panel-top">
          <span className="tour-progress">
            {index + 1} / {TOUR_STEPS.length}
          </span>
          <div className="tour-dots" aria-hidden="true">
            {TOUR_STEPS.map((item, dotIndex) => (
              <span
                key={item.id}
                className={`tour-dot${
                  dotIndex === index ? ' active' : dotIndex < index ? ' done' : ''
                }`}
              />
            ))}
          </div>
          <button className="tour-skip" onClick={onSkip}>
            Skip tour
          </button>
        </div>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        {step.extra ? <p className="tour-extra">{step.extra}</p> : null}
        {step.note ? <p className="tour-note">{step.note}</p> : null}
        {step.action === 'showExample' ? (
          <button className="tour-action" onClick={() => onAction('showExample')}>
            Show example in replay
          </button>
        ) : null}
        <div className="tour-footer">
          <button className="tour-btn" onClick={onBack} disabled={index === 0}>
            Back
          </button>
          {last ? (
            <button className="tour-btn primary" onClick={onFinish}>
              Finish tour
            </button>
          ) : (
            <button className="tour-btn primary" onClick={onNext}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
