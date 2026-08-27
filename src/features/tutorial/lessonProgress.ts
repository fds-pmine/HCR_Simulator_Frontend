const STORAGE_KEY = 'hcr.lesson-progress.v1';

export interface StoredLessonState {
  sectionIndex: number;
  quizPassed: boolean;
}

export interface LessonProgress {
  completed: ReadonlySet<string>;
  lessons: Readonly<Record<string, StoredLessonState>>;
}

interface SerializedLessonProgress {
  completed: string[];
  lessons: Record<string, StoredLessonState>;
}

const EMPTY_PROGRESS: SerializedLessonProgress = {
  completed: [],
  lessons: {},
};

export function loadLessonProgress(): LessonProgress {
  const stored = readSerialized();
  return {
    completed: new Set(stored.completed),
    lessons: stored.lessons,
  };
}

export function loadStoredLessonState(lessonId: string): StoredLessonState {
  return loadLessonProgress().lessons[lessonId] ?? {
    sectionIndex: 0,
    quizPassed: false,
  };
}

export function saveStoredLessonState(
  lessonId: string,
  next: StoredLessonState,
): void {
  const current = readSerialized();
  writeSerialized({
    ...current,
    lessons: {
      ...current.lessons,
      [lessonId]: normalizeLessonState(next),
    },
  });
}

export function saveCompletedLesson(lessonId: string): void {
  const current = readSerialized();
  if (current.completed.includes(lessonId)) return;
  writeSerialized({
    ...current,
    completed: [...current.completed, lessonId],
  });
}

function readSerialized(): SerializedLessonProgress {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return cloneEmpty();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return cloneEmpty();

    const completed = Array.isArray(parsed.completed)
      ? [...new Set(parsed.completed.filter((id): id is string => typeof id === 'string'))]
      : [];
    const lessons: Record<string, StoredLessonState> = {};
    if (isRecord(parsed.lessons)) {
      for (const [lessonId, value] of Object.entries(parsed.lessons)) {
        if (!isRecord(value)) continue;
        lessons[lessonId] = normalizeLessonState({
          sectionIndex: value.sectionIndex,
          quizPassed: value.quizPassed,
        });
      }
    }
    return { completed, lessons };
  } catch {
    return cloneEmpty();
  }
}

function writeSerialized(progress: SerializedLessonProgress): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage may be unavailable or full. The live React state still works.
  }
}

function normalizeLessonState(value: {
  sectionIndex: unknown;
  quizPassed: unknown;
}): StoredLessonState {
  return {
    sectionIndex:
      typeof value.sectionIndex === 'number' && Number.isInteger(value.sectionIndex)
        ? Math.max(0, value.sectionIndex)
        : 0,
    quizPassed: value.quizPassed === true,
  };
}

function cloneEmpty(): SerializedLessonProgress {
  return { completed: [...EMPTY_PROGRESS.completed], lessons: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

