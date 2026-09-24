import { summary } from '../data';

export default function TransparencyPanel() {
  const validation = summary.validation;
  const training = summary.classifier.training_counts;

  return (
    <section className="subpanel">
      <div className="panel-head">
        <h2 className="panel-title">Detection notes &amp; model transparency</h2>
      </div>
      <ul className="transparency-list">
        <li>
          Recorded public <strong>RoadSens-4M</strong> subset — not live bus
          telemetry.
        </li>
        <li>
          <strong>Real source GPS</strong> only; no fabricated coordinates.
        </li>
        <li>
          <strong>Pothole</strong> and <strong>Bump</strong> are
          source-supported labels; <strong>Sustained Roughness</strong> is a
          derived heuristic.
        </li>
        <li>
          Four-session Pothole/Bump calibration is currently <strong>weak</strong>
          , so the classifier defaults to the majority class rather than claiming
          an unsupported Pothole.
        </li>
      </ul>

      <details className="transparency-details">
        <summary>Detector calibration detail</summary>
        <ul className="calibration-list">
          <li>
            Labelled calibration candidates: {validation.labelled_candidates}
            {' '}(Pothole {training.Pothole ?? 0}, Bump {training.Bump ?? 0})
          </li>
          <li>
            Leave-one-out accuracy: {validation.leave_one_out_accuracy.toFixed(4)}
            {' '}vs majority-class baseline{' '}
            {validation.majority_class_baseline_accuracy.toFixed(4)}
          </li>
          <li>Separation assessment: {validation.pothole_bump_separation}</li>
        </ul>
        <p className="panel-note">{validation.separation_note}</p>
      </details>

      <details className="transparency-details">
        <summary>Data provenance &amp; thresholds</summary>
        <ul className="calibration-list">
          <li>
            Dataset: {summary.dataset} · {summary.subset}
          </li>
          <li>Detector: {summary.detector}</li>
          <li>Normal-road reference session: {summary.reference_session}</li>
          <li>Candidate peak: {summary.thresholds.candidate_peak}</li>
          <li>Accept peak: {summary.thresholds.accept_peak}</li>
          <li>Turning suppression: {summary.thresholds.turning}</li>
          <li>Horizontal suppression: {summary.thresholds.horizontal}</li>
          <li>Roughness condition: {summary.thresholds.roughness}</li>
        </ul>
      </details>
    </section>
  );
}
