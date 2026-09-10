// `?raw` rather than reading from disk, for the reason sceneTokens.test.ts
// gives: under jsdom the module URL is rewritten to an http scheme and
// `readFileSync` refuses it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import CSS from '../../src/styles.css?raw';
import { NARROW_STAGE } from '../../src/features/simulation/simulationStore';

/**
 * Below a certain width the stage stops being a canvas with panels floating
 * over it and becomes a column of rows, and only one of the two panels fits
 * the work-surface row. CSS lays the column out; the store decides which panel
 * is in it. Both need the same idea of "below", and neither can see the other's
 * copy of the number — so this is the seam that would rot silently: a panel the
 * topbar reports as open, stacked underneath one CSS has already placed there.
 */

/** The body of the `@media` block starting at `open`, by brace counting. */
function mediaBlock(open: number): string {
  let depth = 0;
  for (let at = open; at < CSS.length; at += 1) {
    if (CSS[at] === '{') depth += 1;
    else if (CSS[at] === '}') {
      depth -= 1;
      if (depth === 0) return CSS.slice(open, at);
    }
  }
  throw new Error('unbalanced braces in styles.css');
}

/** Every `max-width` the stylesheet lays the stage out as a column at. */
function columnLayoutWidths(): number[] {
  const widths = new Set<number>();
  for (const match of CSS.matchAll(/@media ([^{]+)\{/g)) {
    const body = mediaBlock(match.index + match[0].length - 1);
    // The rule has to be `.stage` itself: `flex-direction: column` appears
    // inside plenty of cards and panels that are not the stage.
    if (!/\.stage\s*\{[^}]*flex-direction:\s*column/.test(body)) continue;
    const width = /max-width:\s*(\d+)px/.exec(match[1]);
    if (width) widths.add(Number(width[1]));
  }
  return [...widths];
}

async function storeWith(matches: boolean) {
  vi.resetModules();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const { useWorkbenchStore } = await import(
    '../../src/features/simulation/simulationStore'
  );
  return useWorkbenchStore;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the narrow-stage breakpoint', () => {
  it('is the same width in the stylesheet and in the store', () => {
    const widths = columnLayoutWidths();
    expect(widths, 'no @media block restacks .stage into a column').toHaveLength(
      1,
    );
    expect(NARROW_STAGE).toBe(`(max-width: ${widths[0]}px)`);
  });
});

describe('the workbench panels on a narrow stage', () => {
  it('opens on the scene, so the first thing a phone shows is the robot', async () => {
    const store = await storeWith(true);
    expect(store.getState().leftPanelOpen).toBe(false);
    expect(store.getState().rightPanelOpen).toBe(false);
  });

  it('lets only one panel hold the work-surface row', async () => {
    const store = await storeWith(true);

    store.getState().toggleLeftPanel();
    expect(store.getState()).toMatchObject({
      leftPanelOpen: true,
      rightPanelOpen: false,
    });

    store.getState().toggleRightPanel();
    expect(store.getState()).toMatchObject({
      leftPanelOpen: false,
      rightPanelOpen: true,
    });
  });

  it('closes a panel without opening the other one', async () => {
    const store = await storeWith(true);
    store.getState().toggleLeftPanel();
    store.getState().toggleLeftPanel();
    expect(store.getState()).toMatchObject({
      leftPanelOpen: false,
      rightPanelOpen: false,
    });
  });

  it('gives the stage back when a run starts', async () => {
    const store = await storeWith(true);
    store.getState().toggleLeftPanel();
    store.getState().revealStage();
    expect(store.getState()).toMatchObject({
      leftPanelOpen: false,
      rightPanelOpen: false,
    });
  });
});

describe('the workbench panels on a wide stage', () => {
  it('opens with both panels out, as it always has', async () => {
    const store = await storeWith(false);
    expect(store.getState().leftPanelOpen).toBe(true);
    expect(store.getState().rightPanelOpen).toBe(true);
  });

  it('leaves the panels independent — they are in different columns', async () => {
    const store = await storeWith(false);
    store.getState().toggleLeftPanel();
    store.getState().toggleLeftPanel();
    expect(store.getState()).toMatchObject({
      leftPanelOpen: true,
      rightPanelOpen: true,
    });
  });

  it('does not close anything on Run — nothing was covering the scene', async () => {
    const store = await storeWith(false);
    store.getState().revealStage();
    expect(store.getState()).toMatchObject({
      leftPanelOpen: true,
      rightPanelOpen: true,
    });
  });
});
