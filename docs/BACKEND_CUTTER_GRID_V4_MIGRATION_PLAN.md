# CAT, Cutter Grid V4, and Mechanical Calibration Synchronization Plan

## Current Baseline

- Frontend review baseline: `a45a832` (`origin/feat/cutter-grid-control`).
- Backend review baseline: `54a8582` (`hcr-backend/main` pulled on 2026-08-25).
- Firmware facts: the protocol travel for X/Y/Z/B is `0…180°`, and `/api/home` is `90°`; E is `45…100°`, also with home at `90°`.
- Specification priority remains `HCR_Simulator_SPEC_v0.3.md > IMPLEMENTATION_PLAN.md > ACCEPTANCE.md`. Once physical measurements are confirmed, update the specifications together rather than changing fixtures alone.

The latest backend already implements the Rust V4 Profile, planning interface, compact PTP, dynamic certification, actual sweeps, and structured errors; this plan no longer lists these existing capabilities as pending work. The remaining boundaries are CAT session wiring, authoritative V4 submissions, and physical mechanical calibration that has not yet been measured.

## Frontend Boundaries Corrected in This Round

1. Online Practice first creates a Session with `programmingMode: "servo"`, then reads the first signed `itemRef`. The browser no longer infers `initialTheta` from the score of a fixed first item that is absent from the item bank.
2. Every Practice response follows `next -> submit -> respond`, with backend replay scores driving θ; the server's WarmupSelector and EAP prior are the sole CAT starting point.
3. Practice offers only Servo until V4 Submit receives authoritative backend scoring. A Cutter Grid response must not affect Servo θ, and a selectable mode must not be displayed only to have submission disabled afterward.
4. `SimulationWorkbench` uses the local Worker by default; only online Practice explicitly selects the Rust planner and passes `NextItem.challengeVersion` to the planning request. Lessons, Tutorial, and the regular Workbench do not unexpectedly switch to network requests because an API URL is configured.
5. Before execution, successful Rust responses are validated for a complete joint set, finite positive durations, motion limits, primitive continuity, contact events, consistency between cut and result voxels, and diagnostic fields. Recomputing an FNV signature alone can no longer hide a plan with missing fields.

## How to Interpret the “Dead Zone”

Three quantities are easily confused here:

| Name | Current meaning | Can it be changed directly? |
| --- | --- | --- |
| Firmware protocol travel | X/Y/Z/B use `0…180°` | This is not equivalent to safe mechanical travel; protocol acceptance does not mean a link can safely traverse the entire range |
| Challenge joint travel | Currently X `30…150`, Y `30…150`, Z `17.5…162.5`, B `0…180` | Must be confirmed through physical endpoint and collision measurements |
| Head-model reachability dead zone | Of 241 hair voxels, cached measurements identify 94 as unreachable under the current geometry/travel (147 reachable) | This is a measurement result, not a default requirement to cut 94 cells |

`tests/unit/reachability.test.ts` already ensures that `initialHair - targetHair` for all manually authored items contains no dead-zone voxels. Backend-generated items derive their target from a successfully replayed reference program, ensuring that the reference itself achieves 100 Completion. Joint ranges therefore must not simply be widened to “eliminate the 94”; the first experiment already showed that changing travel, offset, and the 90° initial angle together without measurements causes the official Lesson 5 solution to collide with the head.

## Correct Separation of Default Angles

- `SERVO_LIMITS.*.homeDeg = 90` is the firmware centering command.
- `JointConfig.initialAngleDeg = 90` for every hardware-mapped joint represents the initial command value after servo power-on/Electron connection.
- `JointConfig.initialAngleDeg = 90` is also the sole initial servo state for firmware Home, Challenge, Reset, and Electron connection; a second set of hidden initial angles is no longer maintained.
- `servo.offsetDeg` / `direction` describe the safe geometric pose of the physical links at 90°; the current values are still simulation calibration values, and physical values must be confirmed through hardware measurements.
- Every Servo run must first call firmware `/api/home` to return X/Y/Z/B/E to 90°; Electron no longer inserts hidden Challenge pose commands. The main-process sequencer rejects any plan that does not start with Home, and ArmDock retains its independent Home button.

## Phase A — Physical Calibration (Requires Hardware Measurements)

Record the following data for each X/Y/Z/B axis, and synchronize it with the frontend Challenge and backend catalog as a versioned calibration artifact:

1. Geometric angle at 90° home;
2. Geometric angle after increasing one axis by 30° from 90°, to determine `direction`;
3. Minimum/maximum safe servo angles that avoid mechanical stops, wiring, and the head model;
4. Photos/pose with all four axes at home, and the recommended safe centering sequence without the head;
5. Verification that X/Y/Z/B/E all at 90° Home is itself a safe Challenge starting pose with the head model present.

After measurement:

- Update `servo.offsetDeg`, `direction`, and Challenge min/max/initial;
- Run `npm run reachability` to rebuild the dead-zone cache and record the new counts;
- Rebuild V1/V2/V4 Profiles, V3/V4 conformance fixtures, and reference plans;
- Replay all eight lessons, the default challenge, and CAT-generated items; any collision in an official solution requires reverting the calibration or rebuilding the item;
- Increment the Challenge/Profile/item-bank versions. Submitted records remain pinned to the old versions; historical difficulty must not be changed in place.

Phase exit: physical endpoints, simulated poses, all official solutions, the reachability cache, and the backend Challenge of the same version are fully consistent.

## Phase B — Authoritative V4 Submissions and CAT Cutter Grid

Currently, `POST /api/v1/cutter-grid/plans` only plans; it neither scores nor writes to a Session. The next step is to reuse this Rust planner to add a server-owned submission path:

1. `SubmissionCreate` accepts the player's `CutterGridProgramV4` IR, not client Profiles, contact events, or authoritative trajectories;
2. The server independently plans and replays using a fixed `(challengeId, challengeVersion, profileSignature)`;
3. Success produces the same `SubmissionResult` as Servo, but with `programmingMode = "cutter-grid"`;
4. Session creation filters `ChallengeMeta.programmingModes` by `programmingMode`, and `respond` rejects submissions from another mode;
5. Servo θ and Cutter Grid θ remain on separate scales until at least 15 linking items spanning difficulties and families have been calibrated;
6. The frontend enables Cutter Grid Submit only when capability metadata, Challenge version, plannerVersion, and Profile all match.

Phase exit: Cutter Grid in online Practice also follows `next -> server plan/replay -> respond`; local client previews do not affect θ.

## Phase C — CAT Quality Gates

- Establish item-level audits for mastery threshold `τ`; the default `0.5` must be an explicit default and must not be mislabeled as a continuous-score model.
- Record raw score, thresholded correct, θ before/after, mode, and Challenge version.
- Provide HTTP integration tests for Warmup, max items, SE termination, and bank exhausted.
- Every calibrated item must have a solvable reference or a manual reachability audit; unreachable items must not be used to measure ability.
- Calibration parameter changes must mint a new version; old responses must not be reinterpreted using new `b/a/τ`.

## Acceptance Commands

Frontend:

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run reachability
npm run cutter-grid:audit
npm run cutter-grid:profile
npm run cutter-grid:plan
```

Backend:

```text
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
```

Before a production merge, also run the TypeScript/Rust conformance bundle and separately report discrete results (action, primitive, cut/result voxels, error code) and floating-point tolerances; do not compare only raw JSON hashes, which are sensitive to runtime floating-point formatting.
