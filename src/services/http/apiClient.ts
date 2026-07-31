/**
 * Minimal client for the `hcr.v1` HTTP binding.
 *
 * Wire contract: `hcr-backend/docs/01-CONTRACT.md`. Errors arrive as
 * `{ error: { code, message, field?, retryable } }` with a non-2xx status.
 */

/** Stable machine codes the backend can return. */
export type HcrErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CHALLENGE_NOT_FOUND'
  | 'PROGRAM_INVALID'
  | 'PROGRAM_TOO_LARGE'
  | 'WEIGHTS_INVALID'
  | 'ITEM_REF_INVALID'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_TERMINATED'
  | 'BANK_EXHAUSTED'
  | 'DEVICE_OFFLINE'
  | 'DEVICE_BUSY'
  | 'REPLAY_TIMEOUT'
  | 'RATE_LIMITED'
  | 'INTERNAL';

interface WireError {
  code: HcrErrorCode;
  message: string;
  retryable: boolean;
  field?: string;
}

/**
 * A failure reported by the backend.
 *
 * `field` is preserved because the workbench uses it to highlight the offending
 * Blockly block — losing it would reduce a precise, actionable error to a toast.
 */
export class HcrApiError extends Error {
  constructor(
    readonly code: HcrErrorCode,
    message: string,
    readonly options: {
      status?: number;
      field?: string;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'HcrApiError';
  }

  get field(): string | undefined {
    return this.options.field;
  }

  get retryable(): boolean {
    return this.options.retryable ?? false;
  }
}

export interface ApiClientOptions {
  /** Base URL, e.g. `https://example.com` or `http://localhost:8080`. */
  baseUrl: string;
  /** Bearer token, when the deployment requires authentication. */
  token?: string;
  /** Injected for tests; defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Abort a request that takes longer than this. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    // Normalize so callers can pass a trailing slash or not.
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(body === undefined
            ? {}
            : { 'Content-Type': 'application/json' }),
          ...(this.options.token
            ? { Authorization: `Bearer ${this.options.token}` }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      // A network failure or timeout is retryable; a protocol error is not.
      throw new HcrApiError('INTERNAL', describeNetworkFailure(cause), {
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw await toApiError(response);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new HcrApiError('INTERNAL', 'The server returned a malformed response.', {
        status: response.status,
      });
    }
  }
}

async function toApiError(response: Response): Promise<HcrApiError> {
  let wire: WireError | undefined;
  try {
    const payload = (await response.json()) as { error?: WireError };
    wire = payload.error;
  } catch {
    // Fall through to a status-only error below.
  }

  if (!wire) {
    return new HcrApiError(
      'INTERNAL',
      `The server responded with status ${response.status}.`,
      { status: response.status, retryable: response.status >= 500 },
    );
  }

  return new HcrApiError(wire.code, wire.message, {
    status: response.status,
    field: wire.field,
    retryable: wire.retryable,
  });
}

function describeNetworkFailure(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return 'The request timed out.';
  }
  return 'Could not reach the server.';
}
