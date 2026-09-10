import type { Challenge } from '../../types/domain';
import { cutterGridChallengeSignature } from '../cutter-grid/signature';
import { PROGRAMMING_MODES, type ProgrammingMode } from './programmingMode';

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

  /**
   * Drop this challenge in every mode.
   *
   * What a caller opening a fresh attempt actually means. Forgetting one mode
   * leaves the other holding the program it was written in, and the two modes
   * are one keystroke apart in the workbench.
   */
  forgetChallenge(challenge: Challenge): void {
    for (const mode of PROGRAMMING_MODES) this.forget(challenge, mode);
  }

  clear(): void {
    this.#states.clear();
  }
}

export const programmingWorkspaceMemory = new ProgrammingWorkspaceMemory();
