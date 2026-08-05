export const SCALP_BLOCK_TYPES = {
  moveForward: 'hcr_scalp_move_forward',
  turn: 'hcr_scalp_turn',
  setToolMode: 'hcr_scalp_set_tool_mode',
} as const;

export const SCALP_BLOCK_FIELDS = {
  steps: 'STEPS',
  direction: 'DIRECTION',
  mode: 'MODE',
} as const;
