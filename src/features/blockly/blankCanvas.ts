import type { Challenge } from '../../types/domain';

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
