import type { CutterGridDirection } from './types';

export const CUTTER_GRID_BLOCK_TYPES: Readonly<
  Record<CutterGridDirection, string>
> = {
  right: 'hcr_cutter_grid_move_right',
  left: 'hcr_cutter_grid_move_left',
  up: 'hcr_cutter_grid_move_up',
  down: 'hcr_cutter_grid_move_down',
  forward: 'hcr_cutter_grid_move_forward',
  backward: 'hcr_cutter_grid_move_backward',
};

export const CUTTER_GRID_BLOCK_FIELDS = {
  distance: 'DISTANCE',
} as const;

export function cutterGridDirectionForBlock(
  blockType: string,
): CutterGridDirection | undefined {
  return (
    Object.entries(CUTTER_GRID_BLOCK_TYPES).find(
      ([, type]) => type === blockType,
    )?.[0] as CutterGridDirection | undefined
  );
}
