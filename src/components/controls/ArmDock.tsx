import { useCallback, useEffect, useState } from 'react';
import {
  Cable,
  ChevronDown,
  Home,
  LoaderCircle,
  Radio,
  Square,
  TriangleAlert,
} from 'lucide-react';
import type { Challenge } from '../../types/domain';
import type { CompiledProgram } from '../../features/blockly/programTypes';
import type { ProgrammingMode } from '../../features/blockly/programmingMode';
import type {
  CutterTrajectoryPlanV1,
  CutterTrajectoryPlanV2,
  CutterTrajectoryPlanV3,
  CutterTrajectoryPlanV4,
} from '../../features/cutter-grid/types';
import {
  armCall,
  buildArmPlan,
  buildCutterArmEndpointPlan,
  isArmAvailable,
  type ArmProgress,
  type ArmStep,
  type CutterArmEndpoint,
  type UnsupportedJoint,
} from '../../features/robot/armBridge';
import { SERVO_AXIS_ORDER } from '../../features/robot/servoMapping';
import { useLocalization } from '../../features/preferences/localization';
import { hcrBlockCopy } from '../../features/blockly/blocklyLocalization';

interface ArmDockProps {
  challenge: Challenge;
  /** Which editor wrote the program the dock should send. */
  mode: ProgrammingMode;
  /** Compiles the current workspace, or returns undefined on a program error. */
  compile: () => CompiledProgram | undefined;
  /**
   * The frozen Cutter Grid trajectory, planned on demand.
   *
   * Async because planning runs in a cancellable Worker and can take seconds —
   * the same call Run and Test go through, so pressing Send does not re-solve a
   * program that has already been planned.
   */
  cutterPlan?: () => Promise<
    CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2 | CutterTrajectoryPlanV3 | CutterTrajectoryPlanV4 | undefined
  >;
}

/**
 * Mirrors `sequencer.MAX_STEPS`.
 *
 * Duplicated rather than imported because the sequencer is CommonJS in the main
 * process and this is renderer code; `armBridge.test.ts` asserts the two agree.
 */
const ARM_STEP_BUDGET = 512;

type Link =
  | { state: 'unknown' }
  | { state: 'checking' }
  | { state: 'ok'; runtime: string }
  | { state: 'failed'; message: string };

/**
 * Connect to, and drive, the physical arm.
 *
 * Renders only in the Electron build. A browser tab cannot reach a plain-HTTP
 * device from an HTTPS page, so there is nothing here to degrade gracefully
 * into — the whole dock is absent rather than present and broken.
 */
export function ArmDock({ challenge, mode, compile, cutterPlan }: ArmDockProps) {
  const { t, locale } = useLocalization();
  const blockCopy = hcrBlockCopy(locale);
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [draft, setDraft] = useState('');
  const [link, setLink] = useState<Link>({ state: 'unknown' });
  const [progress, setProgress] = useState<ArmProgress | undefined>();
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [unsupported, setUnsupported] = useState<UnsupportedJoint[]>([]);
  const [endpoints, setEndpoints] = useState<CutterArmEndpoint[]>([]);
  const [hardwareAngles, setHardwareAngles] = useState<Record<string, number>>();

  const available = isArmAvailable();

  useEffect(() => {
    if (!available) {
      return;
    }
    void armCall((bridge) => bridge.getAddress()).then((value) => {
      setAddress(value);
      setDraft(value);
    });
  }, [available]);

  useEffect(() => {
    if (!available) {
      return;
    }
    // The unsubscribe is what keeps a re-render from stacking listeners; main
    // sends one message per step and duplicates would be visible as a jumping
    // progress readout.
    return window.hcrArm?.onProgress(setProgress);
  }, [available]);

  const guard = useCallback(async (action: () => Promise<void>) => {
    setError(undefined);
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!available) {
    return null;
  }

  const handleSaveAddress = () =>
    void guard(async () => {
      const saved = await armCall((bridge) => bridge.setAddress(draft));
      setAddress(saved);
      setDraft(saved);
      setLink({ state: 'unknown' });
    });

  const handleCheck = () =>
    void guard(async () => {
      setLink({ state: 'checking' });
      try {
        const health = await armCall((bridge) => bridge.check());
        const angles = await armCall((bridge) => bridge.readAngles());
        setLink({ state: 'ok', runtime: health.runtime });
        setHardwareAngles(angles);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setLink({ state: 'failed', message });
        throw caught;
      }
    });

  /**
   * Ask the arm for its address on the upstream network.
   *
   * Offered because the obvious way to reach the arm — joining its own access
   * point — usually costs the machine its internet connection. One call from
   * the AP yields the LAN address, and after that neither the arm nor the
   * laptop has to leave the normal network.
   */
  const handleDiscover = () =>
    void guard(async () => {
      const wifi = await armCall((bridge) => bridge.discover());
      if (!wifi.address) {
        setError(
          `The arm is not on an upstream network yet (station: ${wifi.station}). ` +
            'Add one on its Wi-Fi page, then try again.',
        );
        return;
      }
      setDraft(wifi.address);
    });

  const handleHome = () => void guard(async () => {
    const angles = await armCall((bridge) => bridge.home());
    setHardwareAngles(angles);
  });

  const send = async (steps: readonly ArmStep[]) => {
    setRunning(true);
    try {
      const result = await armCall((bridge) => bridge.run(steps));
      const angles = await armCall((bridge) => bridge.readAngles());
      setHardwareAngles(angles);
      setProgress(undefined);
      if (result.aborted) {
        setError(`Stopped after ${result.completed} of ${result.total} steps.`);
      }
    } finally {
      setRunning(false);
    }
  };

  const handleSend = () => {
    setEndpoints([]);

    if (mode === 'cutter-grid') {
      void guard(async () => {
        const trajectory = await cutterPlan?.();
        if (!trajectory) {
          return;
        }
        if (trajectory.version === 4) {
          setError('Cutter Grid V4 is simulation-only until firmware supports local synchronized PTP interpolation and the physical arm has passed hardware certification.');
          return;
        }
        if (trajectory.version === 3) {
          // Browser V3 is a visual/planning trial while the same planner is
          // being ported to Rust. Never reinterpret its synchronized path as
          // independently reachable endpoint commands for a physical arm.
          setError('Cutter Grid V3 is simulation-only until Rust planning and hardware validation are complete.');
          return;
        }
        // Endpoints, not the frozen path. The planner's trajectory needs a
        // shoulder-roll servo this arm does not have, but each block has one
        // destination and those are reachable without it — and on hardware
        // there is no hair, so the route between them carries nothing.
        const plan = buildCutterArmEndpointPlan(challenge, trajectory, {
          maxSteps: ARM_STEP_BUDGET,
        });
        setEndpoints(plan.endpoints);
        if (plan.unreachable.length > 0) {
          setError(
            `The arm cannot reach ${plan.unreachable.length} of ` +
              `${plan.endpoints.length} destinations without a shoulder-roll ` +
              'servo, so nothing was sent.',
          );
          return;
        }
        if (plan.steps.length === 0) {
          setError('This trajectory has nothing the arm can perform.');
          return;
        }
        await send(plan.steps);
      });
      return;
    }

    const compiled = compile();
    if (!compiled) {
      return;
    }
    const plan = buildArmPlan(challenge, compiled.runtimeCommands);
    setUnsupported(plan.unsupported);
    if (plan.steps.length === 0) {
      setError('This program has nothing the arm can perform.');
      return;
    }
    void guard(() => send(plan.steps));
  };

  const handleAbort = () => void guard(async () => {
    await armCall((bridge) => bridge.abort());
  });

  return (
    <div className={`arm-dock ${open ? 'arm-dock--open' : ''}`}>
      <button
        className="arm-dock__toggle"
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Cable size={15} />
        ARM
        <span className={`arm-dock__led arm-dock__led--${link.state}`} />
        <ChevronDown size={14} className={open ? 'arm-dock__chevron--up' : ''} />
      </button>

      {open ? (
        <div className="arm-dock__body">
          <label className="arm-dock__field">
            <span>IP</span>
            <input
              type="text"
              value={draft}
              spellCheck={false}
              placeholder="192.168.4.1"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleSaveAddress();
                }
              }}
              aria-label="IPv4"
            />
          </label>

          <div className="arm-dock__row">
            <button
              type="button"
              className="control-button"
              onClick={handleSaveAddress}
              disabled={busy || draft === address}
            >
              {t('saveSettings')}
            </button>
            <button
              type="button"
              className="control-button"
              onClick={handleCheck}
              disabled={busy || draft !== address}
              title="GET /health"
            >
              {link.state === 'checking' ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <Radio size={14} />
              )}
              {t('test')}
            </button>
            <button
              type="button"
              className="control-button control-button--quiet"
              onClick={handleDiscover}
              disabled={busy}
              title={t('search')}
            >
              {t('search')}
            </button>
          </div>

          {link.state === 'ok' ? (
            <>
              <p className="arm-dock__status arm-dock__status--ok">
                {t('backendConnected')} · {link.runtime}
              </p>
              {hardwareAngles ? (
                <p
                  className="arm-dock__status arm-dock__angles"
                  aria-label={t('servoAngles')}
                >
                  {formatHardwareAngles(hardwareAngles, t('servoAngles'), t('notPlanned'))}
                </p>
              ) : null}
            </>
          ) : null}

          <div className="arm-dock__row">
            <button
              type="button"
              className="control-button control-button--primary"
              onClick={handleSend}
              disabled={busy || running || link.state !== 'ok'}
            >
              {running ? <LoaderCircle className="spin" size={14} /> : <Cable size={14} />}
              {t('submit')}
            </button>
            <button
              type="button"
              className="control-button"
              onClick={handleAbort}
              disabled={!running}
            >
              <Square size={13} fill="currentColor" />
              {t('stop')}
            </button>
            <button
              type="button"
              className="control-button control-button--quiet"
              onClick={handleHome}
              disabled={busy || running}
            >
              <Home size={14} />
              Home
            </button>
          </div>

          {progress ? (
            <p className="arm-dock__status">
              {t('progress')} {progress.index + 1}/{progress.total} ·{' '}
              {describeStep(progress.step, blockCopy.wait)}
            </p>
          ) : null}

          {endpoints.length > 0 ? (
            <p className="arm-dock__status">
              {t('endEffector')}: {endpoints.length}
            </p>
          ) : null}

          {unsupported.length > 0 ? (
            <p className="arm-dock__status arm-dock__status--warn">
              <TriangleAlert size={13} />
              {t('programError')}: {unsupported.map((joint) => joint.name).join(', ')}
            </p>
          ) : null}

          {error ? (
            <p className="arm-dock__status arm-dock__status--error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One line of progress, for whichever step shape is running. */
function describeStep(step: ArmStep, waitLabel: string): string {
  if (step.type === 'home') {
    return 'Home · X/Y/Z/B/E 90°';
  }
  if (step.type === 'wait') {
    return `${waitLabel} ${step.durationMs}ms`;
  }
  if (step.type === 'move') {
    return `${step.axis} → ${step.value}°`;
  }
  return step.moves
    .map((move) => `${move.axis} ${move.value.toFixed(1)}°`)
    .join('  ');
}

function formatHardwareAngles(
  angles: Readonly<Record<string, unknown>>,
  label: string,
  unavailable: string,
): string {
  const values = SERVO_AXIS_ORDER.flatMap((axis) => {
    const reported = angles[axis] ?? angles[axis.toLowerCase()];
    const value =
      typeof reported === 'number' || typeof reported === 'string'
        ? Number(reported)
        : Number.NaN;
    return Number.isFinite(value) ? [`${axis} ${value.toFixed(1)}°`] : [];
  });
  return values.length > 0 ? `${label}: ${values.join(' · ')}` : unavailable;
}
