import { describe, expect, it } from 'vitest';
import {
  RUCKIG_LOCAL_WORKER_ASSETS,
  RuckigLocalWorkerLoadError,
  loadRuckigLocalWorkerModule,
  type RuckigLocalEmscriptenFactory,
} from '../../src/features/cutter-grid/ruckigLocalWorker';
import type { RuckigLocalWasmModule } from '../../src/features/cutter-grid/ruckigLocalWasm';

const workerLocation = {
  href: 'https://simulator.example/practice/planner.worker.js',
  origin: 'https://simulator.example',
} as const;

describe('local Ruckig Worker loader', () => {
  it('passes only the pinned same-origin wasm URL to the generated factory', async () => {
    let located: string | undefined;
    const expectedModule = {} as RuckigLocalWasmModule;
    const factory: RuckigLocalEmscriptenFactory = async ({ locateFile }) => {
      located = locateFile(RUCKIG_LOCAL_WORKER_ASSETS.wasmFileName);
      return expectedModule;
    };

    await expect(loadRuckigLocalWorkerModule({ factory, workerLocation })).resolves.toBe(expectedModule);
    expect(located).toBe('https://simulator.example/vendor/ruckig/hcr_ruckig_local.wasm');
  });

  it('rejects a generated module requesting any unpinned asset', async () => {
    const factory: RuckigLocalEmscriptenFactory = async ({ locateFile }) => {
      locateFile('https://cloud.example/solver.wasm');
      return {} as RuckigLocalWasmModule;
    };

    await expect(loadRuckigLocalWorkerModule({ factory, workerLocation })).rejects.toBeInstanceOf(
      RuckigLocalWorkerLoadError,
    );
  });

  it('fails closed when the Worker does not provide a same-origin location', async () => {
    const factory: RuckigLocalEmscriptenFactory = async () => ({} as RuckigLocalWasmModule);
    await expect(loadRuckigLocalWorkerModule({
      factory,
      workerLocation: {
        href: 'https://simulator.example/practice/planner.worker.js',
        origin: 'https://other.example',
      },
    })).rejects.toBeInstanceOf(RuckigLocalWorkerLoadError);
  });
});
