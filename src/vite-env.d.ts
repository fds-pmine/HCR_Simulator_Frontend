/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the HCR backend, e.g. `http://localhost:8080`.
   *
   * Unset by default, which keeps the simulator entirely offline.
   */
  readonly VITE_HCR_API_BASE_URL?: string;
  /** Bearer token, when the deployment requires authentication. */
  readonly VITE_HCR_API_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
