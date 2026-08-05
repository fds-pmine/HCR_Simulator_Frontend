/** The two player-selectable Blockly languages. Both compile to hcr.v1 IR. */
export type ProgrammingMode = 'servo' | 'scalp-path';

export const PROGRAMMING_MODE_LABEL: Readonly<Record<ProgrammingMode, string>> = {
  servo: 'Servo Angles',
  'scalp-path': 'Scalp Path',
};
