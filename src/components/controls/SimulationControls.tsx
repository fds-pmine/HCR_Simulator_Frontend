import {
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Send,
  SkipForward,
  Square,
  Zap,
} from 'lucide-react';
import type { SimulationStatus } from '../../features/simulation/SimulationEngine';

/** The optional "enter this program into the round" action. */
export interface SubmitAction {
  onSubmit: () => void;
  disabled: boolean;
  busy: boolean;
}

interface SimulationControlsProps {
  status: SimulationStatus;
  onRun: () => void;
  onPause: () => void;
  onResume: () => void;
  onStep: () => void;
  onStop: () => void;
  onReset: () => void;
  onTest: () => void;
  testing: boolean;
  submit?: SubmitAction;
}

export function SimulationControls({
  status,
  onRun,
  onPause,
  onResume,
  onStep,
  onStop,
  onReset,
  onTest,
  testing,
  submit,
}: SimulationControlsProps) {
  const running = status === 'running';
  const paused = status === 'paused';
  const canRun = ['idle', 'completed', 'stopped', 'error'].includes(status);

  return (
    <div className="control-dock" aria-label="Simulation controls">
      {/*
        Test leads because in a timed round it is the button that matters: it
        evaluates the program headlessly in milliseconds instead of animating it
        in real time, so iteration speed stops depending on the machine.
        `06-MULTIPLAYER.md` §4.
      */}
      <button
        className="control-button control-button--accent"
        type="button"
        onClick={onTest}
        disabled={!canRun || testing}
        data-testid="test-button"
        title="Evaluate instantly, without animating"
      >
        {testing ? <LoaderCircle className="spin" size={16} /> : <Zap size={16} />}
        Test
      </button>
      <button
        className="control-button control-button--primary"
        type="button"
        onClick={onRun}
        disabled={!canRun}
        data-testid="run-button"
      >
        <Play size={16} fill="currentColor" />
        Run
      </button>
      {paused ? (
        <button
          className="control-button"
          type="button"
          onClick={onResume}
          data-testid="resume-button"
        >
          <Play size={16} />
          Resume
        </button>
      ) : (
        <button
          className="control-button"
          type="button"
          onClick={onPause}
          disabled={!running}
          data-testid="pause-button"
        >
          <Pause size={16} />
          Pause
        </button>
      )}
      <button
        className="control-button"
        type="button"
        onClick={onStep}
        disabled={status !== 'idle' && !paused}
        data-testid="step-button"
      >
        <SkipForward size={16} />
        Step
      </button>
      <button
        className="control-button"
        type="button"
        onClick={onStop}
        disabled={!running && !paused}
        data-testid="stop-button"
      >
        <Square size={15} fill="currentColor" />
        Stop
      </button>
      <span className="control-dock__divider" />
      <button
        className="control-button control-button--quiet"
        type="button"
        onClick={onReset}
        disabled={status === 'loading'}
        data-testid="reset-button"
      >
        <RotateCcw size={16} />
        Reset
      </button>
      {submit ? (
        <>
          <span className="control-dock__divider" />
          <button
            className="control-button control-button--submit"
            type="button"
            onClick={submit.onSubmit}
            disabled={submit.disabled || submit.busy}
            data-testid="submit-button"
          >
            {submit.busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Send size={16} />
            )}
            Submit
          </button>
        </>
      ) : null}
    </div>
  );
}
