import { describe, expect, it, vi } from 'vitest';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { ApiClient, HcrApiError } from '../../src/services/http/apiClient';
import { HttpChallengeProvider } from '../../src/services/http/HttpChallengeProvider';
import { HttpScoreProvider } from '../../src/services/http/HttpScoreProvider';
import { readBackendConfig } from '../../src/services/http/config';
import type { ScoreInput } from '../../src/types/domain';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A `fetch` mock typed like the real thing, so call arguments stay checkable. */
function createFetchMock(handler: (init?: RequestInit) => Response) {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(init)),
  );
}

type FetchMock = ReturnType<typeof createFetchMock>;

function initOf(mock: FetchMock): RequestInit {
  const init = mock.mock.calls[0]?.[1];
  if (!init) {
    throw new Error('fetch was called without an init object');
  }
  return init;
}

function clientReturning(
  body: unknown,
  status = 200,
): { client: ApiClient; fetchImpl: FetchMock } {
  const fetchImpl = createFetchMock(() => jsonResponse(body, status));
  return {
    client: new ApiClient({
      baseUrl: 'https://backend.test/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
    fetchImpl,
  };
}

describe('readBackendConfig', () => {
  it('is absent by default so the app stays offline', () => {
    expect(readBackendConfig({} as ImportMetaEnv)).toBeUndefined();
    expect(
      readBackendConfig({ VITE_HCR_API_BASE_URL: '   ' } as ImportMetaEnv),
    ).toBeUndefined();
  });

  it('reads the base URL and optional token', () => {
    expect(
      readBackendConfig({
        VITE_HCR_API_BASE_URL: 'http://localhost:8080',
        VITE_HCR_API_TOKEN: 'secret',
      } as ImportMetaEnv),
    ).toEqual({ baseUrl: 'http://localhost:8080', token: 'secret' });
  });
});

describe('ApiClient', () => {
  it('normalizes a trailing slash in the base URL', async () => {
    const { client, fetchImpl } = clientReturning([]);
    await client.get('/api/v1/challenges');

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://backend.test/api/v1/challenges',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends the bearer token when configured', async () => {
    const fetchImpl = createFetchMock(() => jsonResponse([]));
    const client = new ApiClient({
      baseUrl: 'https://backend.test',
      token: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.get('/api/v1/challenges');

    const headers = initOf(fetchImpl).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret');
  });

  it('surfaces the wire error code and field', async () => {
    const { client } = clientReturning(
      {
        error: {
          code: 'PROGRAM_INVALID',
          message: 'Angle 999 is outside the range for "baseYaw".',
          retryable: false,
          field: 'block-7',
        },
      },
      422,
    );

    await expect(client.post('/api/v1/score', {})).rejects.toMatchObject({
      code: 'PROGRAM_INVALID',
      // Preserved so the workbench can still highlight the offending block.
      field: 'block-7',
      retryable: false,
    });
  });

  it('reports an unreachable server as retryable', async () => {
    const fetchImpl = createFetchMock(() => {
      throw new TypeError('Failed to fetch');
    });
    const client = new ApiClient({
      baseUrl: 'https://backend.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.get('/api/v1/challenges')).rejects.toMatchObject({
      code: 'INTERNAL',
      retryable: true,
    });
  });

  it('turns a non-JSON error body into a status-only error', async () => {
    const fetchImpl = createFetchMock(
      () => new Response('<html>502</html>', { status: 502 }),
    );
    const client = new ApiClient({
      baseUrl: 'https://backend.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const error = await client
      .get('/api/v1/challenges')
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(HcrApiError);
    expect((error as HcrApiError).retryable).toBe(true);
  });
});

describe('HttpChallengeProvider', () => {
  it('produces a challenge identical to the local provider', async () => {
    // The wire form is the *definition*; both providers must normalize it the
    // same way, or the local and remote paths would silently diverge.
    const { client } = clientReturning({
      ...defaultChallengeDefinition,
      meta: { version: 3, calibration: 'calibrated', hardwareCompatible: true },
    });

    const remote = await new HttpChallengeProvider(client).getChallenge(
      defaultChallengeDefinition.id,
    );
    const local = await new LocalChallengeProvider().getChallenge(
      defaultChallengeDefinition.id,
    );

    expect(remote.id).toBe(local.id);
    expect(remote.initialHair.voxels).toEqual(local.initialHair.voxels);
    expect(remote.targetHair.voxels).toEqual(local.targetHair.voxels);
    expect(remote.robotConfig).toEqual(local.robotConfig);
    expect(remote.scoring).toEqual(local.scoring);
  });

  it('tolerates an omitted starter workspace', async () => {
    const withoutWorkspace: Record<string, unknown> = {
      ...defaultChallengeDefinition,
    };
    delete withoutWorkspace.starterWorkspace;
    const { client } = clientReturning(withoutWorkspace);

    const challenge = await new HttpChallengeProvider(client).getChallenge(
      defaultChallengeDefinition.id,
    );
    expect(challenge.starterWorkspace).toEqual({});
  });

  it('rejects a malformed challenge rather than passing it to the engine', async () => {
    const { client } = clientReturning({
      ...defaultChallengeDefinition,
      robotConfig: { ...defaultChallengeDefinition.robotConfig, joints: [] },
    });

    await expect(
      new HttpChallengeProvider(client).getChallenge('neat-short-cap'),
    ).rejects.toThrow();
  });

  it('encodes the challenge id into the path', async () => {
    const { client, fetchImpl } = clientReturning(defaultChallengeDefinition);
    await new HttpChallengeProvider(client)
      .getChallenge('needs escaping/../x')
      .catch(() => undefined);

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://backend.test/api/v1/challenges/needs%20escaping%2F..%2Fx',
    );
  });
});

describe('HttpScoreProvider', () => {
  it('serializes voxel sets as key arrays', async () => {
    const { client, fetchImpl } = clientReturning({
      completionScore: 100,
      efficiencyScore: 100,
      timeScore: 100,
      finalScore: 100,
      programCost: 1,
    });

    const input: ScoreInput = {
      initialVoxels: new Set(['0,0,0', '1,0,0'] as const),
      targetVoxels: new Set(['0,0,0', '1,0,0'] as const),
      resultVoxels: new Set(['0,0,0'] as const),
      programMetrics: {
        sourceBlockCount: 1,
        executedCommandCount: 1,
        estimatedDurationMs: 100,
      },
      scoring: defaultChallengeDefinition.scoring,
    };

    const result = await new HttpScoreProvider(client).score(input);
    expect(result.finalScore).toBe(100);

    const body = JSON.parse(initOf(fetchImpl).body as string);
    // Sets have no JSON form; the wire carries the v1 VoxelKey strings.
    // `initialVoxels` is part of the request because completion is scored on
    // the cut, which the server cannot reconstruct from target and result.
    expect(body.initialVoxels).toEqual(['0,0,0', '1,0,0']);
    expect(body.targetVoxels).toEqual(['0,0,0', '1,0,0']);
    expect(body.resultVoxels).toEqual(['0,0,0']);
  });
});
