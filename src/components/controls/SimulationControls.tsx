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
import { useLocalization } from '../../features/preferences/localization';

/** The optional "enter this program into the round" action. */
export interface SubmitAction {
  onSubmit: () => void;
  disabled: boolean;
  busy: boolean;
  title?: string;
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
  const { t } = useLocalization();
  const running = status === 'running';
  const paused = status === 'paused';
  const canRun = ['idle', 'completed', 'stopped', 'error'].includes(status);
  // Step leaves the run paused, and a paused run refuses a fresh `run`. That
  // greyed Test out one press after the lesson told the learner to use Step,
  // with nothing on screen naming Reset as the way back. Test now accepts a
  // paused run and resets it itself.
  const canTest = canRun || paused;

  return (
    <div className="control-dock" aria-label={t('simulationControls')}>
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
        disabled={!canTest || testing}
        data-testid="test-button"
        title={`${t('evaluateInstantly')} — ${t('runVsTest')}`}
      >
        {testing ? <LoaderCircle className="spin" size={16} /> : <Zap size={16} />}
        {t('test')}
      </button>
      <button
        className="control-button control-button--primary"
        type="button"
        onClick={onRun}
        disabled={!canRun}
        data-testid="run-button"
        title={t('runVsTest')}
      >
        <Play size={16} fill="currentColor" />
        {t('run')}
      </button>
      {paused ? (
        <button
          className="control-button"
          type="button"
          onClick={onResume}
          data-testid="resume-button"
        >
          <Play size={16} />
          {t('resume')}
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
          {t('pause')}
        </button>
      )}
      <button
        className="control-button"
        type="button"
        onClick={onStep}
        // Same states `Run` accepts, plus resuming a pause. Finishing a
        // program should not leave Step greyed out until you press Reset.
        disabled={!canRun && !paused}
        data-testid="step-button"
      >
        <SkipForward size={16} />
        {t('step')}
      </button>
      <button
        className="control-button"
        type="button"
        onClick={onStop}
        disabled={!running && !paused}
        data-testid="stop-button"
      >
        <Square size={15} fill="currentColor" />
        {t('stop')}
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
        {t('reset')}
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
            title={submit.title}
          >
            {submit.busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Send size={16} />
            )}
            {t('submit')}
          </button>
        </>
      ) : null}
    </div>
  );
}
