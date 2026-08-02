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
 * # Why the raw completion score is not `p`
 *
 * `completionScore` is an IoU between the target hairstyle and what the learner
 * left behind — so it measures *hair still in the right state*, most of which
 * was never meant to be touched. Its floor is therefore not 0 but
 * `|target| / |initial|`: on the shipped opener the target keeps 229 of 241
 * voxels, so submitting an empty program already scores 95.02.
 *
 * Feeding that straight into the logit was degenerate. The entire achievable
 * range mapped to θ ∈ [2.949, 3.000] — doing nothing and a perfect run both
 * clamped to the ceiling, so every learner was seeded at maximum ability and the
 * selector answered with the hardest items in the bank. The seed has to be
 * rescaled against the score doing nothing earns, which is what `baselineScore`
 * is for.
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

export interface SeedOptions {
  /**
   * The completion score an empty program earns on this challenge.
   *
   * The zero point of the scale. Without it the seed measures how much hair the
   * challenge happens to leave alone, not how the learner did.
   */
  baselineScore: number;
  /** Difficulty of the opener on the bank's scale. */
  difficulty?: number;
}

export function initialThetaFrom(
  completionScore: number,
  { baselineScore, difficulty = 0 }: SeedOptions,
): number {
  const headroom = 100 - baselineScore;
  // A challenge that asks for nothing has no scale to measure on; the opener
  // tells us nothing about the learner, so stay at the prior.
  if (!(headroom > 0)) {
    return clampTheta(difficulty);
  }

  const proportion = clamp(
    (completionScore - baselineScore) / headroom,
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
