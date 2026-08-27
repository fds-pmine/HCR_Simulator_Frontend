import { afterEach, describe, expect, it } from 'vitest';
import {
  loadLessonProgress,
  loadStoredLessonState,
  saveCompletedLesson,
  saveStoredLessonState,
} from '../../src/features/tutorial/lessonProgress';

const STORAGE_KEY = 'hcr.lesson-progress.v1';

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

describe('lesson progress storage', () => {
  it('persists the current section and quiz status independently', () => {
    saveStoredLessonState('grid-1', { sectionIndex: 18, quizPassed: false });
    expect(loadStoredLessonState('grid-1')).toEqual({
      sectionIndex: 18,
      quizPassed: false,
    });

    saveStoredLessonState('grid-1', { sectionIndex: 18, quizPassed: true });
    expect(loadStoredLessonState('grid-1')).toEqual({
      sectionIndex: 18,
      quizPassed: true,
    });
  });

  it('keeps completed lessons while other lesson positions change', () => {
    saveCompletedLesson('grid-1');
    saveStoredLessonState('grid-2', { sectionIndex: 7, quizPassed: false });
    saveCompletedLesson('grid-1');

    const progress = loadLessonProgress();
    expect([...progress.completed]).toEqual(['grid-1']);
    expect(progress.lessons['grid-2']).toEqual({
      sectionIndex: 7,
      quizPassed: false,
    });
  });

  it('fails closed when stored data is malformed', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      completed: ['grid-1', 42, 'grid-1'],
      lessons: {
        'grid-1': { sectionIndex: -4, quizPassed: 'yes' },
        broken: null,
      },
    }));

    const progress = loadLessonProgress();
    expect([...progress.completed]).toEqual(['grid-1']);
    expect(progress.lessons['grid-1']).toEqual({
      sectionIndex: 0,
      quizPassed: false,
    });
    expect(progress.lessons.broken).toBeUndefined();
  });
});

