import { StrictMode, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/app/providers';
import type { AppServices } from '../../src/app/servicesContext';
import { CutterGridLessonRun } from '../../src/features/tutorial/CutterGridLessonRun';
import { CUTTER_GRID_LESSONS } from '../../src/features/tutorial/cutterGridLessons';
import { HttpUsageProvider } from '../../src/services/http/HttpUsageProvider';
import { ApiClient } from '../../src/services/http/apiClient';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
import { saveResearchPreferences } from '../../src/features/preferences/researchPreferences';
import {
  recordingUsageProvider,
  unusedMatchProvider,
  unusedSessionProvider,
} from '../../src/test/stubServices';

// The workbench is a WebGL canvas and a Blockly workspace; neither is what these
// tests are about. Rendering the lesson card it is handed keeps the panel — and
// its Next button — in the DOM.
vi.mock('../../src/components/layout/SimulationWorkbench', () => ({
  SimulationWorkbench: ({ tutorial }: { tutorial?: { panel?: ReactNode } }) => (
    <div>{tutorial?.panel}</div>
  ),
}));

const lesson = CUTTER_GRID_LESSONS[0];

function servicesWith(usageProvider: AppServices['usageProvider']): AppServices {
  return {
    challengeProvider: new LocalChallengeProvider(),
    scoreProvider: new LocalScoreProvider(),
    matchProvider: unusedMatchProvider(),
    sessionProvider: unusedSessionProvider(),
    usageProvider,
  };
}

/**
 * The lessons are the part of the app that never talks to a server, so nothing
 * about them reached the usage log at all: a lesson does not submit, and
 * submissions were the only thing the log could see. These are the events that
 * make the course visible — and the one that matters most is the last, because
 * giving up is the case where nobody presses anything.
 */
describe('lesson usage reporting', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it('reports opening a lesson, passing a section, and leaving unfinished', async () => {
    const usage = recordingUsageProvider();
    const { unmount } = render(
      <AppProviders services={servicesWith(usage)}>
        <CutterGridLessonRun
          lessonId={lesson.id}
          onExit={() => {}}
          onSolved={() => {}}
        />
      </AppProviders>,
    );

    const next = await screen.findByTestId('next-grid-section');
    expect(usage.events).toEqual([
      {
        lessonId: lesson.id,
        mode: 'cutter-grid',
        section: 0,
        tests: 0,
        outcome: 'opened',
      },
    ]);

    fireEvent.click(next);
    expect(usage.events[1]).toEqual({
      lessonId: lesson.id,
      mode: 'cutter-grid',
      section: 0,
      tests: 0,
      activity: lesson.sections[0].activity,
      outcome: 'section-passed',
    });

    // Leaving, a while later — see the remount guard below for why the clock
    // has to move for this to count as a learner walking away.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    unmount();
    vi.restoreAllMocks();
    expect(usage.events.at(-1)).toEqual({
      lessonId: lesson.id,
      mode: 'cutter-grid',
      section: 1,
      tests: 0,
      outcome: 'abandoned',
    });
  });

  it('does not report a development remount as somebody giving up', async () => {
    // `main.tsx` runs the app in StrictMode, which mounts every component twice
    // in development — setup, cleanup, setup — and hot reload does the same on
    // every save. Reported as written, that is an `abandoned` row for a lesson
    // nobody left, sitting between two `opened` rows for one nobody opened
    // twice. It showed up the first time this was pointed at a real server.
    const usage = recordingUsageProvider();
    render(
      <StrictMode>
        <AppProviders services={servicesWith(usage)}>
          <CutterGridLessonRun
            lessonId={lesson.id}
            onExit={() => {}}
            onSolved={() => {}}
          />
        </AppProviders>
      </StrictMode>,
    );
    await screen.findByTestId('next-grid-section');

    expect(usage.events.map((event) => event.outcome)).toEqual(['opened']);
  });

  it('reports a section once, however often it is walked back over', async () => {
    // Sections already passed stay open to review, so a learner re-reading one
    // walks the same gate repeatedly. Counting those as passes would count
    // clicks and call them learners.
    const usage = recordingUsageProvider();
    render(
      <AppProviders services={servicesWith(usage)}>
        <CutterGridLessonRun
          lessonId={lesson.id}
          onExit={() => {}}
          onSolved={() => {}}
        />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByTestId('next-grid-section'));
    fireEvent.click(screen.getByTestId('previous-grid-section'));
    fireEvent.click(screen.getByTestId('next-grid-section'));

    const passes = usage.events.filter(
      (event) => event.outcome === 'section-passed',
    );
    expect(passes).toHaveLength(1);
    expect(passes[0].section).toBe(0);
  });
});

describe('reporting lesson usage to a backend', () => {
  const event = {
    lessonId: lesson.id,
    section: 3,
    outcome: 'section-passed',
    mode: 'cutter-grid',
  } as const;

  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it('sends nothing at all when research consent was declined', () => {
    // Lesson progress says how somebody learned, which is what makes it research
    // data. Nothing about a lesson is operationally necessary — it needs no
    // server to run — so declining has to mean no request, not an unused flag.
    saveResearchPreferences({
      programAndScores: false,
      language: false,
      utcOffset: false,
      decided: true,
    });
    const fetchImpl = vi.fn();
    new HttpUsageProvider(
      new ApiClient({ baseUrl: 'https://api.example', fetchImpl }),
    ).recordLessonEvent(event);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts the event with the reporting player when consent was granted', () => {
    saveResearchPreferences({
      programAndScores: true,
      language: false,
      utcOffset: false,
      decided: true,
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ recorded: true }), { status: 200 }),
    );
    new HttpUsageProvider(
      new ApiClient({ baseUrl: 'https://api.example', fetchImpl }),
    ).recordLessonEvent(event);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example/api/v1/usage/lessons');
    expect(JSON.parse(String(init.body))).toEqual(event);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-HCR-Player']).toMatch(/^u-/);
    expect(headers['X-HCR-Research-Program-And-Scores']).toBe('granted');
  });

  it('never lets a failed report reach the lesson', async () => {
    saveResearchPreferences({
      programAndScores: true,
      language: false,
      utcOffset: false,
      decided: true,
    });
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const provider = new HttpUsageProvider(
      new ApiClient({ baseUrl: 'https://api.example', fetchImpl }),
    );

    // Synchronous, and the rejection is handled: an unhandled one here would
    // surface as an error in whichever section the learner happened to be on.
    expect(() => provider.recordLessonEvent(event)).not.toThrow();
    await Promise.resolve();
  });
});
