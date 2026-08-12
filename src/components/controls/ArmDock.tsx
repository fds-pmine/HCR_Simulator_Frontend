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
import {
  armCall,
  buildArmPlan,
  isArmAvailable,
  type ArmProgress,
  type UnsupportedJoint,
} from '../../features/robot/armBridge';

interface ArmDockProps {
  challenge: Challenge;
  /** Compiles the current workspace, or returns undefined on a program error. */
  compile: () => CompiledProgram | undefined;
}

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
export function ArmDock({ challenge, compile }: ArmDockProps) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [draft, setDraft] = useState('');
  const [link, setLink] = useState<Link>({ state: 'unknown' });
  const [progress, setProgress] = useState<ArmProgress | undefined>();
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [unsupported, setUnsupported] = useState<UnsupportedJoint[]>([]);

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
        setLink({ state: 'ok', runtime: health.runtime });
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
    await armCall((bridge) => bridge.home());
  });

  const handleSend = () => {
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
    setRunning(true);
    void guard(async () => {
      try {
        const result = await armCall((bridge) => bridge.run(plan.steps));
        setProgress(undefined);
        if (result.aborted) {
          setError(`Stopped after ${result.completed} of ${result.total} steps.`);
        }
      } finally {
        setRunning(false);
      }
    });
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
            <span>ADDRESS</span>
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
              aria-label="Arm IPv4 address"
            />
          </label>

          <div className="arm-dock__row">
            <button
              type="button"
              className="control-button"
              onClick={handleSaveAddress}
              disabled={busy || draft === address}
            >
              Save
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
              Test
            </button>
            <button
              type="button"
              className="control-button control-button--quiet"
              onClick={handleDiscover}
              disabled={busy}
              title="Ask the arm for its address on your Wi-Fi"
            >
              Find on LAN
            </button>
          </div>

          {link.state === 'ok' ? (
            <p className="arm-dock__status arm-dock__status--ok">
              Connected — {link.runtime}
            </p>
          ) : null}

          <div className="arm-dock__row">
            <button
              type="button"
              className="control-button control-button--primary"
              onClick={handleSend}
              disabled={busy || running || link.state !== 'ok'}
            >
              {running ? <LoaderCircle className="spin" size={14} /> : <Cable size={14} />}
              Send to Arm
            </button>
            <button
              type="button"
              className="control-button"
              onClick={handleAbort}
              disabled={!running}
            >
              <Square size={13} fill="currentColor" />
              Stop
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
              Step {progress.index + 1} of {progress.total} —{' '}
              {progress.step.type === 'move'
                ? `${progress.step.axis} to ${progress.step.value}°`
                : `wait ${progress.step.durationMs}ms`}
            </p>
          ) : null}

          {unsupported.length > 0 ? (
            <p className="arm-dock__status arm-dock__status--warn">
              <TriangleAlert size={13} />
              {unsupported.map((joint) => joint.name).join(', ')} has no servo on
              this arm; those commands were not sent.
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
