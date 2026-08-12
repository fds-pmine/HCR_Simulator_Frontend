import type { CompiledCutterGridProgramV1 } from '../cutter-grid/types';
import type { CompiledProgram } from './programTypes';

export type EditorCompilation =
  | { mode: 'servo'; compiled: CompiledProgram }
  | { mode: 'cutter-grid'; compiled: CompiledCutterGridProgramV1 };
