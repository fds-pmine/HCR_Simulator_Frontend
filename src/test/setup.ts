import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

if (typeof globalThis.localStorage?.setItem !== 'function') {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    },
  });
}

beforeEach(() => {
  globalThis.localStorage?.setItem(
    'hcr.research-preferences.v1',
    JSON.stringify({
      programAndScores: true,
      language: false,
      utcOffset: false,
      decided: true,
    }),
  );
});
