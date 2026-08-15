import { useCallback, useState } from 'react';
import {
  loadIdentity,
  saveIdentity,
  type PlayerIdentity,
} from '../features/match/identity';
import { VersusRound } from '../features/match/VersusRound';
import { TutorialRun } from '../features/tutorial/TutorialRun';
import { LESSONS } from '../data/challenges/lessons';
import { PracticeRun } from '../features/practice/PracticeRun';
import { LessonPicker } from '../features/tutorial/LessonPicker';
import { LessonRun } from '../features/tutorial/LessonRun';
import { CutterGridLessonRun } from '../features/tutorial/CutterGridLessonRun';
import { HomeScreen } from './HomeScreen';
import { useServices } from './servicesContext';

type Screen = 'home' | 'tutorial' | 'lessons' | 'solo' | 'versus';

/**
 * Top-level screen router.
 *
 * Deliberately not a routing library: there are four screens and no URLs to
 * preserve, so a single piece of state is the whole requirement.
 */
export function GameShell() {
  const { matchProvider } = useServices();
  const [screen, setScreen] = useState<Screen>('home');
  const [identity, setIdentity] = useState<PlayerIdentity>(loadIdentity);
  const [lessonId, setLessonId] = useState<string>();
  const [cutterGridLessonId, setCutterGridLessonId] = useState<string>();
  const [solved, setSolved] = useState<ReadonlySet<string>>(new Set());

  const markSolved = useCallback((id: string) => {
    setSolved((current) => (current.has(id) ? current : new Set([...current, id])));
  }, []);

  const rename = useCallback(
    (displayName: string) => {
      setIdentity((current) => {
        if (current.displayName === displayName) {
          return current;
        }
        return saveIdentity({ ...current, displayName });
      });
    },
    [],
  );

  const goHome = useCallback(() => setScreen('home'), []);

  if (screen === 'tutorial') {
    return <TutorialRun onExit={goHome} />;
  }

  if (screen === 'lessons') {
    if (cutterGridLessonId) {
      return (
        <CutterGridLessonRun
          lessonId={cutterGridLessonId}
          onExit={() => setCutterGridLessonId(undefined)}
        />
      );
    }
    const index = LESSONS.findIndex((lesson) => lesson.id === lessonId);
    const next = index >= 0 ? LESSONS[index + 1] : undefined;
    return lessonId ? (
      <LessonRun
        lessonId={lessonId}
        onSolved={markSolved}
        {...(next ? { onNext: () => setLessonId(next.id) } : {})}
        onExit={() => setLessonId(undefined)}
      />
    ) : (
      <LessonPicker
        completed={solved}
        onPick={setLessonId}
        onPickCutterGrid={setCutterGridLessonId}
        onBack={goHome}
      />
    );
  }

  if (screen === 'solo') {
    // A session, not a menu: finishing one challenge produces the next, chosen
    // by the CAT engine from how the learner is doing.
    return <PracticeRun onExit={goHome} />;
  }

  if (screen === 'versus') {
    return <VersusRound identity={identity} onExit={goHome} />;
  }

  return (
    <HomeScreen
      identity={identity}
      kind={matchProvider.kind}
      onRename={rename}
      onTutorial={() => setScreen('tutorial')}
      onLessons={() => setScreen('lessons')}
      onSolo={() => setScreen('solo')}
      onVersus={() => setScreen('versus')}
    />
  );
}
