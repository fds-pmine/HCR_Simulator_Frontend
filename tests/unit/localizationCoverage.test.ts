import { describe, expect, it } from 'vitest';
import { CUTTER_GRID_LESSONS } from '../../src/features/tutorial/cutterGridLessons';
import { LESSONS } from '../../src/data/challenges/lessons';
import { localizeCutterGridLesson } from '../../src/features/tutorial/cutterGridLessonLocalization';
import { localizeServoLesson } from '../../src/features/tutorial/servoLessonLocalization';
import { missingMessageKeys, type AppLocale } from '../../src/features/preferences/localization';
import { CUTTER_GRID_TUTORIAL_STEPS } from '../../src/features/tutorial/cutterGridTutorial';
import { CONTROL_MODES_TUTORIAL_STEPS } from '../../src/features/tutorial/controlModesTutorial';
import { LESSONS as SERVO_TUTORIAL_STEPS } from '../../src/features/tutorial/lessons';
import { localizeTutorialStep } from '../../src/features/tutorial/tutorialStepLocalization';

const locales = ['zh-CN','zh-TW','zh-HK','ja','ko','es','fr','ru','de'] as const;
const internationalLocales = locales.filter((locale) => !locale.startsWith('zh'));

describe('localization coverage', () => {
  it.each(locales)('%s has no static English fallback', (locale) => {
    expect(missingMessageKeys(locale)).toEqual([]);
  });

  it.each(internationalLocales)('%s localizes every lesson field', (locale) => {
    for (const source of CUTTER_GRID_LESSONS) {
      const translated = localizeCutterGridLesson(source, locale as AppLocale);
      expect(translated.name).not.toBe(source.name);
      expect(translated.description).not.toBe(source.description);
      expect(translated.goal).not.toBe(source.goal);
      expect(translated.assessments.multipleChoice.question).not.toBe(source.assessments.multipleChoice.question);
      expect(translated.sections.every((section, index) => section.body !== source.sections[index].body)).toBe(true);
    }
    for (const source of LESSONS) {
      const translated = localizeServoLesson(source, locale as AppLocale);
      expect(translated.name).not.toBe(source.name);
      expect(translated.description).not.toBe(source.description);
      expect(translated.goal).not.toBe(source.goal);
      expect(translated.assessments.multipleChoice.question).not.toBe(source.assessments.multipleChoice.question);
      expect(translated.sections.every((section, index) => section.body !== source.sections[index].body)).toBe(true);
    }
  });

  it.each(internationalLocales)('%s localizes every tutorial step', (locale) => {
    const steps = [...CUTTER_GRID_TUTORIAL_STEPS, ...CONTROL_MODES_TUTORIAL_STEPS, ...SERVO_TUTORIAL_STEPS];
    for (const source of steps) {
      const translated = localizeTutorialStep(source, locale as AppLocale);
      expect(translated.title).not.toBe(source.title);
      expect(translated.body).not.toBe(source.body);
      if (source.hint) expect(translated.hint).not.toBe(source.hint);
    }
  });

  it.each(internationalLocales)('%s teaches the current certified Cutter Grid route', (locale) => {
    const localized = (id: string) =>
      localizeTutorialStep(
        CUTTER_GRID_TUTORIAL_STEPS.find((step) => step.id === id)!,
        locale as AppLocale,
      );

    expect(localized('grid-up').body).toContain('6');
    expect(localized('grid-up').body).not.toContain('7');
    expect(localized('grid-forward').body).toContain('2');
    expect(localized('grid-forward').body).toContain('8');
    const completeRouteBody = localized('grid-complete-route').body;
    expect(completeRouteBody.match(/→/g)).toHaveLength(8);
    expect(completeRouteBody).toContain('11');
    expect(completeRouteBody).not.toContain('7');
  });

  it.each(internationalLocales)('%s retains the all-90 hardware bridge contract', (locale) => {
    for (const id of ['bridge-home-angle', 'bridge-telemetry', 'bridge-done']) {
      const source = CONTROL_MODES_TUTORIAL_STEPS.find((step) => step.id === id)!;
      expect(localizeTutorialStep(source, locale as AppLocale).body).toContain('90');
    }
  });

  it.each(internationalLocales)('%s retains operation-critical Grid lesson values', (locale) => {
    const requiredValues: Readonly<Record<string, readonly string[]>> = {
      'cutter-grid-distance': ['1', '12', '3', '4', '−3', '2', '0'],
      'cutter-grid-repeat': ['500', '1', '20'],
      'cutter-grid-wait': ['0', '5000', '250', '1000'],
      'cutter-grid-compress': ['12', '6'],
      'cutter-grid-certified-cut': ['9', '11', '90', '100'],
    };

    for (const [lessonId, values] of Object.entries(requiredValues)) {
      const source = CUTTER_GRID_LESSONS.find((lesson) => lesson.id === lessonId)!;
      const translated = localizeCutterGridLesson(source, locale as AppLocale);
      const visibleCopy = [
        translated.description,
        translated.goal,
        translated.assessments.practicalPrompt,
        ...translated.sections.map((section) => section.body),
      ].join(' ');
      for (const value of values) expect(visibleCopy).toContain(value);
    }
  });

  it.each(internationalLocales)('%s retains Servo destinations and the scored target', (locale) => {
    for (const source of LESSONS) {
      const translated = localizeServoLesson(source, locale as AppLocale);
      expect(translated.description).toContain('90');
      expect(translated.assessments.practicalPrompt).toContain('100');
      for (const { angleDeg } of source.solution) expect(translated.goal).toContain(String(angleDeg));
    }
  });
});
