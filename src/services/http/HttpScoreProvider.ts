import type { ScoreInput, ScoreResult } from '../../types/domain';
import type { ScoreProvider } from '../contracts';
import type { ApiClient } from './apiClient';

/**
 * Scores a finished run on the backend.
 *
 * Note what this is **not**: authoritative. It posts the voxel sets the browser
 * computed, so it inherits whatever the client believed. It exists for parity
 * with the local provider, so the workbench keeps working unchanged against a
 * remote deployment.
 *
 * Assessment and competitive scoring go the other way — the client submits its
 * Program IR and the server replays it (`hcr-backend/docs/02-DETERMINISM.md` §3).
 * A client that could assert its own score would make that replay decorative.
 */
export class HttpScoreProvider implements ScoreProvider {
  constructor(private readonly client: ApiClient) {}

  async score(input: ScoreInput): Promise<ScoreResult> {
    return this.client.post<ScoreResult>('/api/v1/score', {
      // Sets have no JSON form; the wire carries the v1 `VoxelKey` strings.
      initialVoxels: [...input.initialVoxels],
      targetVoxels: [...input.targetVoxels],
      resultVoxels: [...input.resultVoxels],
      programMetrics: input.programMetrics,
      scoring: input.scoring,
    });
  }
}
