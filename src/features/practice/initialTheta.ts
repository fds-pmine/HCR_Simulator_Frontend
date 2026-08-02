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
 * `completionScore / 100` stands in for `p`. That reading is only honest because
 * completion measures the *cut* — see `calculateTrimScore`. It used to compare
 * the hair left standing, whose floor was `|target| / |initial|` rather than
 * zero, and this function carried a `baselineScore` parameter to subtract that
 * floor back out. Fixing the metric removed the need: an empty program now
 * scores 0, which is what a proportion of 0 should mean.
 *
 * # Why the result is shrunk
 *
 * One response is weak evidence, and the rails are expensive: a seed at ±3 hands
 * the selector an item at the very edge of the bank. Shrinking toward the prior
 * mean is the standard treatment for a single observation and keeps the opener
 * from over-committing — the session refits properly from the second item on.
 */

/** Ability is clamped to the range the bank's difficulties actually span. */
export const THETA_LIMIT = 3;

/**
 * How far from certainty a single response is allowed to imply.
 *
 * Without this a perfect score maps to θ = +∞. 0.02 caps the raw estimate at
 * roughly ±3.9 logits before shrinkage and clamping.
 */
const CERTAINTY_MARGIN = 0.02;

/**
 * Weight given to a single observation against the θ = 0 prior.
 *
 * Half: enough for the opener to genuinely steer the second challenge, not
 * enough to strand a learner at the edge of the bank on one attempt.
 */
const SEED_WEIGHT = 0.5;

export function initialThetaFrom(
  completionScore: number,
  difficulty = 0,
): number {
  const proportion = clamp(
    completionScore / 100,
    CERTAINTY_MARGIN,
    1 - CERTAINTY_MARGIN,
  );
  const observed = difficulty + Math.log(proportion / (1 - proportion));
  return clampTheta(observed * SEED_WEIGHT);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function clampTheta(theta: number): number {
  return clamp(theta, -THETA_LIMIT, THETA_LIMIT);
}
