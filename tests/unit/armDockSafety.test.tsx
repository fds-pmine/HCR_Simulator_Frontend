import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArmDock } from '../../src/components/controls/ArmDock';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import type { CompiledProgram, RobotCommand } from '../../src/features/blockly/programTypes';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';

const challenge = normalizeChallenge(defaultChallengeDefinition);
const move = (jointId: string, angleDeg: number): RobotCommand => ({
  type: 'set-joint-angle', jointId, angleDeg, sourceBlockId: jointId,
});

function mockBridge() {
  const run = vi.fn(async () => ({
    ok: true as const, value: { completed: 0, total: 0, aborted: false },
  }));
  const abort = vi.fn(async () => ({ ok: true as const, value: true }));
  window.hcrArm = {
    available: true,
    getAddress: async () => ({ ok: true, value: '192.168.4.1' }),
    setAddress: async (value) => ({ ok: true, value }),
    check: async () => ({ ok: true, value: { runtime: 'test' } }),
    discover: async () => ({ ok: true, value: { station: 'connected' } }),
    readAngles: async () => ({ ok: true, value: {} }),
    home: async () => ({ ok: true, value: {} }),
    run,
    abort,
    onProgress: () => () => undefined,
  };
  return { run, abort };
}

describe('ArmDock safety', () => {
  afterEach(() => { delete window.hcrArm; });

  it.each([
    {
      commands: [move('baseYaw', 100), move('shoulderRoll', 10)],
      message: /joints the physical arm cannot perform/,
    },
    {
      commands: [move('shoulder', 70), move('elbow', 65), move('wrist', 140), move('baseYaw', 111)],
      message: /would contact the head while moving baseYaw/,
    },
  ])('refuses unsafe Send before IPC: $message', async ({ commands, message }) => {
    const { run } = mockBridge();
    const compiled: CompiledProgram = {
      program: { nodes: commands, sourceBlockCount: commands.length },
      runtimeCommands: commands,
      executedCommandCount: commands.length,
    };
    render(<ArmDock challenge={challenge} mode="servo" compile={() => compiled} />);
    fireEvent.click(screen.getByRole('button', { name: 'ARM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await screen.findByText(/BACKEND CONNECTED/);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(run).not.toHaveBeenCalled();
  });

  it('lets a newly mounted renderer stop an existing main-process run', async () => {
    const { abort } = mockBridge();
    render(<ArmDock challenge={challenge} mode="servo" compile={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'ARM' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop' })); });
    expect(abort).toHaveBeenCalledOnce();
  });
});
