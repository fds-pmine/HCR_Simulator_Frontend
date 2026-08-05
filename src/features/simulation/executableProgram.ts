import type { CompiledProgram } from '../blockly/programTypes';
import type { CompiledScalpProgram } from '../scalp-path';

/** A program the simulator can execute while preserving the frozen hcr.v1 IR. */
export type ExecutableProgram = CompiledProgram | CompiledScalpProgram;

export function isScalpProgram(
  compiled: ExecutableProgram,
): compiled is CompiledScalpProgram {
  return 'trajectoryPlan' in compiled;
}
