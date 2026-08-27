import type {
  Challenge,
  JointConfig,
  JointId,
  ServoAxisId,
  ServoMapping,
} from '../../types/domain';

/**
 * The one place the simulator converts between servo degrees and the geometric
 * angles the kinematics rotates by.
 *
 * # Why angles are servo degrees now
 *
 * Every angle a learner reads or types — block fields, joint limits, the
 * inspector — is the number the physical servo is commanded to, exactly as
 * `hcr-fw` defines it: 0–180°, home 90°. That was not true before. The
 * simulator used a signed, joint-centric convention (`baseYaw` −60…60°, home
 * −45°), so the same arm pose had two different numbers depending on whether
 * you were looking at the game or at the arm, and neither one told you what the
 * other would do.
 *
 * The geometric convention has not gone away — the rotation maths still wants
 * "0° is straight ahead, positive is counter-clockwise". It has just stopped
 * being the unit anything outside this module speaks.
 *
 * # The map
 *
 * A single affine relation, specified in `hcr-backend/docs/05-EMBEDDED.md` §3
 * and mirrored in `hcr-backend/docs/schema/hcr_v1.rs`:
 *
 * ```
 * servoDeg     = centerDeg + direction × (geometricDeg − offsetDeg)
 * geometricDeg = offsetDeg + direction × (servoDeg − centerDeg)
 * ```
 *
 * `direction` is ±1 and nothing else: a servo that runs backwards relative to
 * the model is the only reversal that occurs, and allowing an arbitrary scale
 * would let a challenge be authored that no gearing could reproduce.
 *
 * # `direction` and `offsetDeg` are measurements, not derivations
 *
 * Both describe how a servo was physically mounted, and neither can be read off
 * the source. `direction` is which way the output shaft turns relative to the
 * model; `offsetDeg` is the geometric pose the arm holds when every servo is at
 * its 90° home — which depends on how the horns were splined during assembly,
 * since the arm is built with all servos at 90° (`ESP8266/H.txt`).
 *
 * The values shipped today are **placeholders** carried over from
 * `hcr-backend/docs/05-EMBEDDED.md` §3, where each `offsetDeg` was set to the
 * midpoint of the joint's travel so the range would fit inside 0–180°. That is a
 * convenient default, not a fact about any arm. Until they are measured, angles
 * shown in the simulator will not correspond to the physical arm's pose.
 * `calibrate()` below is the procedure.
 *
 * # Joints with no servo
 *
 * `shoulderRoll` has no axis on the arm — the hardware is five servos and none
 * of them rolls the shoulder. Such a joint carries no mapping and its angles
 * stay geometric, because there is no servo whose degrees they could be. It is
 * simulation-only, and a program that uses it cannot be run on hardware.
 */

/**
 * Servo travel, from `hcr-fw` `AXES`.
 *
 * These are the hardware's limits, not a challenge's. A joint may use less than
 * its servo allows; it must never be configured to use more, which
 * `assertServoRange` is there to catch at the point the challenge is defined
 * rather than when the arm stalls against its stop.
 */
export const SERVO_LIMITS: Readonly<
  Record<ServoAxisId, { minDeg: number; maxDeg: number; homeDeg: number }>
> = {
  X: { minDeg: 0, maxDeg: 180, homeDeg: 90 },
  Y: { minDeg: 0, maxDeg: 180, homeDeg: 90 },
  Z: { minDeg: 0, maxDeg: 180, homeDeg: 90 },
  B: { minDeg: 0, maxDeg: 180, homeDeg: 90 },
  // The gripper. `E` is the one axis with a restricted throw, and v1 does not
  // model opening and closing the scissors, so nothing drives it — the firmware
  // parks it at home and it stays there.
  E: { minDeg: 45, maxDeg: 100, homeDeg: 90 },
};

/** Firmware order used by its status payload and physical control surface. */
export const SERVO_AXIS_ORDER: readonly ServoAxisId[] = ['X', 'Y', 'Z', 'B', 'E'];

/**
 * Project the simulator's current joint state onto the five names used by the
 * firmware and Electron bridge.
 *
 * Joint state for mapped joints is already stored in servo degrees, so this is
 * deliberately a name mapping rather than another geometric conversion. `E`
 * has no simulated joint in v1 and therefore remains at the firmware Home
 * value until cutter actuation is modelled.
 */
export function servoAnglesFromJointAngles(
  robotConfig: Challenge['robotConfig'],
  jointAngles: Readonly<Record<JointId, number>>,
): Record<ServoAxisId, number> {
  const angles = Object.fromEntries(
    SERVO_AXIS_ORDER.map((axis) => [axis, SERVO_LIMITS[axis].homeDeg]),
  ) as Record<ServoAxisId, number>;

  for (const joint of robotConfig.joints) {
    if (!joint.servo) continue;
    const value = jointAngles[joint.id];
    if (Number.isFinite(value)) {
      angles[joint.servo.axis] = value;
    }
  }
  return angles;
}

/** Label a mapped joint with the exact axis learners send to the firmware. */
export function servoJointLabel(joint: JointConfig): string {
  return joint.servo ? `${joint.servo.axis} · ${joint.name}` : joint.name;
}

/**
 * Build a mapping from two observations of the real arm.
 *
 * # Procedure, per axis
 *
 * 1. Home the arm, then read back what it holds:
 *    `curl "http://<arm>/api/angles?X=90&Y=90&Z=90&B=90"`
 * 2. With every servo at 90°, measure the geometric angle of the joint you are
 *    calibrating — the arm's own convention: 0° is the link pointing straight
 *    out along +X, positive is counter-clockwise. A protractor against the link
 *    is enough; this only has to be good to a degree or two. That is
 *    `geometricAtHome`.
 * 3. Drive that one axis 30° up, e.g. `curl "http://<arm>/api/angles?X=120"`,
 *    and measure again. That is `geometricAtPlus30`.
 *
 * The sign of the change gives `direction`; the home reading gives `offsetDeg`.
 * Feed the result into the joint's `servo` field in the challenge definition.
 *
 * `assertServoRange` will reject the result if the measured offset pushes the
 * joint's configured travel off the end of the servo, which is the usual sign
 * that a reading was taken on the wrong axis or in the wrong sense.
 */
export function calibrate(
  axis: ServoAxisId,
  geometricAtHome: number,
  geometricAtPlus30: number,
): ServoMapping {
  const swing = geometricAtPlus30 - geometricAtHome;
  if (!Number.isFinite(swing) || swing === 0) {
    throw new Error(
      `Axis ${axis} did not move between the two readings, so its direction ` +
        'cannot be determined. Check the servo is driven and not at a stop.',
    );
  }
  return {
    axis,
    centerDeg: SERVO_LIMITS[axis].homeDeg,
    direction: swing > 0 ? 1 : -1,
    offsetDeg: geometricAtHome,
  };
}

/** Servo degrees -> the geometric angle the kinematics rotates by. */
export function toGeometricDeg(joint: JointConfig, servoDeg: number): number {
  const { servo } = joint;
  if (!servo) {
    return servoDeg;
  }
  return servo.offsetDeg + servo.direction * (servoDeg - servo.centerDeg);
}

/** Geometric angle -> the degrees the servo is commanded to. */
export function toServoDeg(joint: JointConfig, geometricDeg: number): number {
  const { servo } = joint;
  if (!servo) {
    return geometricDeg;
  }
  return servo.centerDeg + servo.direction * (geometricDeg - servo.offsetDeg);
}

/**
 * Convert a whole pose, so callers that hold a `Record<JointId, number>` do not
 * each have to look joints up by id and get the missing-joint case wrong.
 */
export function toGeometricAngles(
  robotConfig: Challenge['robotConfig'],
  servoAngles: Readonly<Record<JointId, number>>,
): Record<JointId, number> {
  const geometric: Record<JointId, number> = {};
  for (const joint of robotConfig.joints) {
    const angle = servoAngles[joint.id];
    if (angle !== undefined) {
      geometric[joint.id] = toGeometricDeg(joint, angle);
    }
  }
  return geometric;
}

/**
 * Fail loudly when a joint is configured past what its servo can reach.
 *
 * A challenge that asks for 190° does not produce a visibly wrong arm in the
 * simulator — it produces a *correct-looking* simulation that the hardware
 * cannot reproduce, which is the failure that is expensive to notice. Better to
 * refuse the challenge definition.
 */
export function assertServoRange(joint: JointConfig): void {
  const { servo } = joint;
  if (!servo) {
    return;
  }
  const limits = SERVO_LIMITS[servo.axis];
  if (joint.initialAngleDeg !== limits.homeDeg) {
    throw new Error(
      `Joint "${joint.id}" must initialize servo ${servo.axis} at its ` +
        `${limits.homeDeg}° firmware Home, not ${joint.initialAngleDeg}°; ` +
        'calibrate the model geometry instead of adding a second start pose.',
    );
  }
  for (const angle of [
    joint.minAngleDeg,
    joint.maxAngleDeg,
    joint.initialAngleDeg,
  ]) {
    if (angle < limits.minDeg || angle > limits.maxDeg) {
      throw new Error(
        `Joint "${joint.id}" uses ${angle}° on servo ${servo.axis}, ` +
          `which travels ${limits.minDeg}–${limits.maxDeg}°.`,
      );
    }
  }
}
