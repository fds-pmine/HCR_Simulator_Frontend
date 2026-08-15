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
