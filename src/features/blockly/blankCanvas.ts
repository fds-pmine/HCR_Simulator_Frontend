import type { Challenge } from '../../types/domain';
import { programmingWorkspaceMemory } from './workspaceMemory';

/**
 * The same challenge, opened on an empty canvas.
 *
 * Every mode a learner is *assessed* in starts blank: Tutorial, Lessons, Solo
 * Practice and Versus. A prefilled workspace is a partial answer — on generated
 * items the starter is literally the reference solution with its cutting moves
 * removed, so shipping it hands over the approach the item exists to ask for.
 * In Versus it would hand the same head start to whoever edits fastest.
 *
 * Only the workspace is dropped. Geometry, target and scoring stay the real
 * challenge's, so what a learner works out in one mode transfers to the others.
 */
export function withBlankCanvas(challenge: Challenge): Challenge {
  return { ...challenge, starterWorkspace: {} };
}

/**
 * The same challenge, opened on a canvas with nothing left of the last attempt.
 *
 * {@link withBlankCanvas} drops the *starter* workspace, and that used to be
 * read as "opens empty". It is not: the editor remembers what was on the canvas
 * when it unmounted, keyed by the challenge signature and the mode
 * ({@link programmingWorkspaceMemory}), and a versus rematch reopens the same
 * challenge — so round two opened with round one's program already written,
 * which hands the round to whoever played the last one. The memory exists so
 * that switching modes or collapsing a panel mid-attempt does not cost the
 * learner their work; a *new attempt* is exactly where it must not apply.
 *
 * Must be called before the editor mounts, which means during render rather
 * than from an effect: a forget that runs after the editor has read the memory
 * clears nothing anybody can see.
 */
export function withFreshCanvas(challenge: Challenge): Challenge {
  programmingWorkspaceMemory.forgetChallenge(challenge);
  return withBlankCanvas(challenge);
}
