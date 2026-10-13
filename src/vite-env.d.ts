/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the HCR backend, e.g. `http://localhost:18623`.
   *
   * Unset by default, which keeps the simulator entirely offline.
   */
  readonly VITE_HCR_API_BASE_URL?: string;
  /** Force Cutter Grid planning to stay in the local TypeScript Worker. */
  readonly VITE_CUTTER_GRID_PLANNER_MODE?: 'offline';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  hcrApp?: {
    available: true;
    close: () => Promise<void>;
  };
}
