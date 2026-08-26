import type { Challenge } from '../../types/domain';
import { cutterGridChallengeSignature } from '../cutter-grid/signature';
import type { ProgrammingMode } from './programmingMode';

export function programmingWorkspaceKey(
  challenge: Challenge,
  mode: ProgrammingMode,
): string {
  return `${cutterGridChallengeSignature(challenge)}:${mode}`;
}

/** Page-lifetime Blockly state, isolated by the full challenge signature and mode. */
export class ProgrammingWorkspaceMemory {
  readonly #states = new Map<string, Record<string, unknown>>();

  load(challenge: Challenge, mode: ProgrammingMode): Record<string, unknown> | undefined {
    return this.#states.get(programmingWorkspaceKey(challenge, mode));
  }

  save(
    challenge: Challenge,
    mode: ProgrammingMode,
    state: Record<string, unknown>,
  ): void {
    this.#states.set(programmingWorkspaceKey(challenge, mode), state);
  }

  forget(challenge: Challenge, mode: ProgrammingMode): void {
    this.#states.delete(programmingWorkspaceKey(challenge, mode));
  }

  clear(): void {
    this.#states.clear();
  }
}

export const programmingWorkspaceMemory = new ProgrammingWorkspaceMemory();
