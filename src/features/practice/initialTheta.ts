/**
 * Turn the intro challenge's score into a starting ability estimate.
 *
 * # Why an intro item at all
 *
 * With no responses, θ carries no information — so the item a CAT engine picks
 * "adaptively" for the very first question is chosen from a prior, not from the
 * learner. Seeding with one fixed item and measuring from it is the standard
 * shape, and it means the second challenge is already tailored rather than
 * another guess.
 *
 * # The mapping
 *
 * Straight inversion of the 1PL model the bank is fitted under. For an item of
 * difficulty `b`, a learner of ability θ succeeds with probability
 *
 *   p = 1 / (1 + e^-(θ - b))
 *
 * so observing `p` implies
 *
 *   θ = b + ln(p / (1 - p))
 *
 * This is a point estimate from a single response, which is a *weak* one — the
 * session refits it properly from the second item onwards. It is here to start
 * somewhere better than zero, not to be a measurement.
 */

/** Ability is clamped to the range the bank's difficulties actually span. */
export const THETA_LIMIT = 3;

/**
 * How far from certainty a single response is allowed to imply.
 *
 * Without this a perfect score maps to θ = +∞. 0.02 caps the first estimate at
 * roughly ±3.9 logits before clamping, which the limit above then bounds.
 */
const CERTAINTY_MARGIN = 0.02;

export function initialThetaFrom(
  completionScore: number,
  difficulty = 0,
): number {
  const proportion = Math.min(
    1 - CERTAINTY_MARGIN,
    Math.max(CERTAINTY_MARGIN, completionScore / 100),
  );
  const theta = difficulty + Math.log(proportion / (1 - proportion));
  return Math.min(THETA_LIMIT, Math.max(-THETA_LIMIT, theta));
}
