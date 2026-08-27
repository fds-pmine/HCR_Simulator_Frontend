import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArmDock } from '../../src/components/controls/ArmDock';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import type { CutterTrajectoryPlanV4 } from '../../src/features/cutter-grid/types';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';

const challenge = normalizeChallenge(defaultChallengeDefinition);

describe('ArmDock V4 boundary', () => {
  afterEach(() => {
    delete window.hcrArm;
  });

  it('rejects a compact V4 plan before it reaches the Electron transport', async () => {
    const run = vi.fn();
    window.hcrArm = {
      available: true,
      getAddress: async () => ({ ok: true, value: '192.168.4.1' }),
      setAddress: async (value: string) => ({ ok: true, value }),
      check: async () => ({ ok: true, value: { runtime: 'test' } }),
      discover: async () => ({ ok: true, value: { station: 'connected' } }),
      readAngles: async () => ({ ok: true, value: {} }),
      home: async () => ({ ok: true, value: {} }),
      run: async () => {
        run();
        return { ok: true, value: { completed: 0, total: 0, aborted: false } };
      },
      abort: async () => ({ ok: true, value: true }),
      onProgress: () => () => undefined,
    } as never;
    const plan = { version: 4 } as CutterTrajectoryPlanV4;

    render(
      <ArmDock
        challenge={challenge}
        mode="cutter-grid"
        compile={() => undefined}
        cutterPlan={async () => plan}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ARM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await screen.findByText(/BACKEND CONNECTED/);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await screen.findByText(/V4 is simulation-only/);
    await waitFor(() => expect(run).not.toHaveBeenCalled());
  });

  it('shows the firmware angles and refreshes them after Home', async () => {
    const home = vi.fn(async () => ({
      ok: true as const,
      value: { X: 90, Y: 90, Z: 90, B: 90, E: 90 },
    }));
    window.hcrArm = {
      available: true,
      getAddress: async () => ({ ok: true, value: '192.168.4.1' }),
      setAddress: async (value: string) => ({ ok: true, value }),
      check: async () => ({ ok: true, value: { runtime: 'test' } }),
      discover: async () => ({ ok: true, value: { station: 'connected' } }),
      readAngles: async () => ({
        ok: true,
        // The legacy firmware serializes these as strings; hcr-fw uses JSON
        // numbers. The dock must accept both during the Electron migration.
        value: { X: '45.0', Y: '95.0', Z: '72.5', B: '125.0', E: '90.0' },
      }),
      home,
      run: async () => ({
        ok: true,
        value: { completed: 0, total: 0, aborted: false },
      }),
      abort: async () => ({ ok: true, value: true }),
      onProgress: () => () => undefined,
    } as never;

    render(
      <ArmDock
        challenge={challenge}
        mode="servo"
        compile={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ARM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await screen.findByText(/SERVO ANGLES: X 45.0° · Y 95.0°/);

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));

    await screen.findByText(
      'SERVO ANGLES: X 90.0° · Y 90.0° · Z 90.0° · B 90.0° · E 90.0°',
    );
    expect(home).toHaveBeenCalledOnce();
  });
});
