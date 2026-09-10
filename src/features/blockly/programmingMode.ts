export type ProgrammingMode = 'servo' | 'cutter-grid';

export const PROGRAMMING_MODE_LABEL: Readonly<
  Record<ProgrammingMode, string>
> = {
  servo: 'Servo Angles',
  'cutter-grid': 'Cutter Grid',
};

export function canSwitchProgrammingMode(status: string): boolean {
  return status === 'idle';
}

/**
 * Every mode, for callers that must act on all of them.
 *
 * Derived from the label map rather than written out again, so a third mode
 * cannot be added to one list and forgotten in the other.
 */
export const PROGRAMMING_MODES = Object.keys(
  PROGRAMMING_MODE_LABEL,
) as readonly ProgrammingMode[];
