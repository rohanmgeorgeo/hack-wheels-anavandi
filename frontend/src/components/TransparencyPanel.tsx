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
          <strong>Pothole</strong> and <strong>Bump</strong> are
          source-supported RoadSens-4M labels.
        </li>
        <li>
          <strong>Sustained Roughness</strong> is a derived heuristic based on
          persistent vibration, not a dataset label.
        </li>
        <li>
          Current four-session demo calibration has <strong>weak</strong>{' '}
          Pothole/Bump separation, so the classifier defaults to the majority
          class rather than claiming an unsupported Pothole.
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
    </section>
  );
}
