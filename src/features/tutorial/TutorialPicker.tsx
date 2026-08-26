import { ArrowLeft, Boxes, GraduationCap, Repeat2, SlidersHorizontal } from 'lucide-react';

export function TutorialPicker({
  onPickCutterGrid,
  onPickServo,
  onPickControlModes,
  onBack,
}: {
  onPickCutterGrid: () => void;
  onPickServo: () => void;
  onPickControlModes: () => void;
  onBack: () => void;
}) {
  return (
    <main className="menu-screen">
      <div className="menu-screen__aura" aria-hidden="true" />
      <button className="ghost-button menu-screen__back" type="button" onClick={onBack}>
        <ArrowLeft size={15} />
        Menu
      </button>

      <header className="menu-screen__head">
        <p className="phase-kicker"><GraduationCap size={13} /> TUTORIALS</p>
        <h1>Choose how to control the arm</h1>
        <p className="menu-screen__lede">
          Start with Cutter Grid, use Grid → Servo Angles to see how spatial
          intent becomes joint control, then learn direct angles in depth.
        </p>
      </header>

      <ol className="lesson-list tutorial-track-list">
        <li>
          <button type="button" className="lesson-row lesson-row--cutter-grid" onClick={onPickCutterGrid}>
            <span className="lesson-row__index"><Boxes size={16} /></span>
            <span className="lesson-row__text">
              <strong>Cutter Grid tutorial</strong>
              <small>Build and test a certified five-block cut using fixed 3D axes.</small>
            </span>
            <span className="lesson-row__meta">8 steps</span>
          </button>
        </li>
        <li>
          <button type="button" className="lesson-row tutorial-track--bridge" onClick={onPickControlModes}>
            <span className="lesson-row__index"><Repeat2 size={16} /></span>
            <span className="lesson-row__text">
              <strong>Grid → Servo Angles</strong>
              <small>Compare spatial paths with joint commands on the same live workbench.</small>
            </span>
            <span className="lesson-row__meta">9 steps</span>
          </button>
        </li>
        <li>
          <button type="button" className="lesson-row" onClick={onPickServo}>
            <span className="lesson-row__index"><SlidersHorizontal size={16} /></span>
            <span className="lesson-row__text">
              <strong>Servo Angles tutorial</strong>
              <small>Learn absolute angles, collision stops, Test, and Repeat.</small>
            </span>
            <span className="lesson-row__meta">8 steps</span>
          </button>
        </li>
      </ol>
    </main>
  );
}
