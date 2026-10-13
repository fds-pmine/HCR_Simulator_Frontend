# Cutter Grid V4 Compact Synchronized PTP Implementation Plan

## Status and Scope

- Status: Phases 1–6 are complete; the V4 frontend branch is ready for review.
- Maintenance change (complete): adjust the default dynamic request from rated `1.5×` to rated `1.0×`, prioritizing smooth motion and conservative dynamic boundaries for future physical robots. After recertification, the reference-program duration is `1,443ms`, the trajectory signature is `88e26d5a60d3591d`, and P95 over five cold Worker starts is `1,716.5ms`/`2,344.3ms` for `Right 2`/the global regression respectively. This change does not alter the limit of two compact PTP instructions per Move, actual sweep, collision certification, or the ArmDock disablement boundary.
- Planner version: `cutter-grid-compact-ptp-v4`.
- This plan supersedes the V3 motion contract requiring a strict Cartesian straight line per logical cell, a zero-speed stop at every cell, and allowing dense pose trajectories as output. V3 documentation, tests, and fixtures remain as historical baselines.
- Servo, backend wire schema, Session, Match, Versus, Electron dispatch, and firmware are outside V4 frontend implementation scope.
- Current ArmDock must reject V4. Only future controllers supporting local synchronized five-joint interpolation, complete joint mapping, and physical certification may consume V4 compact hardware programs.

## Confirmed V4 Contracts

- Direction and distance remain user inputs along fixed world axes in integer cell distances; the final logical cell center of each Move is a hard constraint, while the intermediate end-effector path has no straight-line hard constraint.
- Plan and execute Move N as one continuous visible leaf action; its command cost remains N. Expand Repeat into stable action occurrences, keep Wait as a separate leaf action, and retain the total logical-cost limit of 500.
- Step executes one expanded Move or Wait; Move N does not stop at internal grid points. Run, Test, and Step use the same frozen V4 plan.
- Keep the tool radius at `0.12` and remove Hair Voxels according to the actual sweep of the final real curve; the Worker generates deterministic contact events and expected result sets before execution.
- Default motion uses 1 synchronized five-joint PTP primitive; if direct PTP collides with the existing head, allow at most 1 obstacle-avoidance configuration, for a maximum of 2 primitives per Move. Exceeding the budget must fail.
- The default dynamic request is rated `1.0×`. All velocity, acceleration, and jerk remain subject to Profile hard limits; the minimum duration of each primitive is `160ms`.
- Dense certification samples are internal Worker safety evidence only; they must not become a pose-command stream for the main thread, Electron, or future hardware.

## Versioned Interfaces

```ts
type CutterGridExecutableActionV2 =
  | {
      type: 'move';
      occurrenceId: string;
      sourceBlockId: string;
      direction: CutterGridDirection;
      distance: number;
      startCoord: CutterGridCoord;
      endCoord: CutterGridCoord;
      logicalCommandCount: number;
    }
  | {
      type: 'wait';
      occurrenceId: string;
      sourceBlockId: string;
      durationMs: number;
      logicalCommandCount: 1;
    };

interface CutterArmMotionProgramV1 {
  kind: 'cutter-arm-motion-program';
  version: 1;
  robotProfileSignature: string;
  trajectorySignature: string;
  instructions: Array<SyncPtpInstructionV1 | WaitInstructionV1>;
}
```

- `CutterTrajectoryPlanV4` stores entry, grouped actions, 1–2 analytic primitives per action, `q/v/a` boundaries, dynamic limits, certified contact events, actual cut sets, diagnostics, and the full signature.
- Primitives use synchronized quintic PTP: `q(u)=q0+(q1-q0)(10u³-15u⁴+6u⁵)`. Direct edges start and end at `v=a=0`; obstacle-avoidance points within one Move share nonzero `q/v/a`, maintaining C2 continuity.
- The V4 runner must reject V1–V3 Cutter Grid plans and signatures. Servo Program IR is unchanged.

## Planning and Certification Design

- Global graph layers contain only certified entries and the endpoint of each visible Move; Wait adds no IK layer.
- The first pass in each layer uses entry, previous-layer, initial Servo, joint-midpoint, and a cumulative 12 deterministic Halton seeds, retaining at most 12 candidates after deduplication. Expand the first disconnected layer to a cumulative 48 seeds and at most 24 candidates.
- Validate adjacent layers in the fixed order of the nearest 4, nearest 8, and all candidate edges; select entry and configuration chain across the whole program, forbidding greedy branch locking per Move.
- Each candidate direct edge first attempts one synchronized PTP; on failure, query the deterministic safe joint-space roadmap in Profile V4 with 256 nodes and 8 adjacencies per node, and shortcut to at most one internal configuration.
- Choose paths in this order: fewest primitives, smallest maximum normalized joint change, shortest duration, smallest joint displacement/curvature, shortest end-effector path and offset, greatest clearance/limit margin, then stable lexicographic order.
- Adaptively subdivide certification to `≤1°` / `≤voxelSize/8` in normal regions and `≤0.25°` / `≤voxelSize/16` near the head; prove interval clearance with conservative motion upper bounds. Fail closed if it cannot be proved.

## Phased Implementation

Before each phase, reread this plan, v0.3, the implementation plan, acceptance checklist, and relevant code and tests; update phase status and checklists in this file before changing phase code, then run phase validation and finish with a separate commit.

### Phase 1: Contracts, Baseline, and Failure Tests

- [x] Synchronize v0.3, the implementation plan, and acceptance checklist, explicitly identifying the V3 fixed-straight-line/zero-speed-per-cell clauses as superseded by V4.
- [x] Pin the current V3 global IK regression baseline: 11 atomic Moves, 44 Cartesian layers, 4,286 certification samples, 6,976ms player-plan duration, `1.25×` dynamic request, geometry signature `188fb68c5336a3b4`, and trajectory signature `73549fa7dad52468`.
- [x] Add V4 baseline, expected-failure, and pending performance-gate tests without connecting to the production entry point.
- Exit: documentation and a reviewable baseline establish V4 scope, output counts, and performance targets without changing runtime behavior.

### Phase 2: Grouped IR, V4 Types, and Worker Protocol

- [x] Before implementation, reread the V4 contracts, v0.3 sections 15.2–15.4, implementation plan, acceptance checklist, existing V1–V3 types/compiler/Worker/client/Profile registry, and their unit tests; confirm the production entry point still calls only `plan-v3` and this phase does not change that choice.
- [x] Generate `CompiledCutterGridProgramV2` from the existing serializable `CutterGridProgramV1`: every expanded Move N produces just one action with stable occurrence, start/end logical coordinates, direction, distance, and `logicalCommandCount=N`; Wait produces a separate action with cost 1. Repeat expands leaf occurrences only, and the 500 limit still counts logical cost rather than action count.
- [x] Define Profile, synchronized PTP primitive, grouped trajectory action/plan, diagnostic, error, and progress types accepted only by V4; plans contain no dense certification samples and use new version/signature fields for isolation from V1–V3.
- [x] Add the `plan-v4` Worker protocol and client method. The Phase 2 Worker returns structured `planner-not-ready` without falling back to V1–V3; the UI does not call this entry point yet.
- [x] Pin occurrences, Move N coordinates and cost, Repeat/500 limits, V4 version boundaries, and client forwarding of V4 progress, failure, and cancellation with pure-domain tests.
- Exit: pure-domain tests construct and serialize V4 inputs/outputs without switching the runtime entry point.

### Phase 3: Endpoint IK, Sparse Graph, and PTP Paths

- [x] Before implementation, reread the V4 contracts, v0.3, implementation plan, acceptance checklist, V2 global IK, candidate deduplication/diversity, certified entry, head collision, kinematics, and regression tests; confirm V4 does not reuse V2 per-cell Cartesian layers or Hermite straight-path validation.
- [x] Build sparse IK layers with `12` seeds/`12` candidates only for visible Move endpoints; deterministically search the first disconnected layer again with `48` seeds/`24` candidates, connecting adjacent layers in the fixed order of the nearest `4`, `8`, and all candidates.
- [x] Implement synchronized quintic PTP evaluation shared with replay and internal collision/limit certification; when a direct edge fails, accept only one obstacle-avoidance configuration forming two PTPs from the fixed safe roadmap with 256 nodes and 8 adjacencies.
- [x] Derive V4 direct-PTP entries and roadmap signatures from V2 certified entries; the V4 Profile no longer carries V2 dense entry trajectories as output.
- [x] Pin direct/single-obstacle-avoidance primitive limits, global endpoint branch selection, candidate/edge expansion determinism, collision rejection, and the low-Wrist regression for `Up 6 → Left 2 → Forward 3` with pure-domain tests.
- Exit: the pure planner generates compact, deterministic, collision-free V4 geometric plans.

### Phase 4: Time Law, Actual Sweep, and Certification

- [x] Before implementation, reread the V4 contracts, v0.3, implementation plan, acceptance checklist, existing PTP geometry, voxel sweep, scoring, and V3 dynamic/contact certification; confirm V4 internal Worker certification samples can produce only compressed diagnostics and contact events and must not enter plans, the main thread, or hardware instructions.
- [x] Retime compact primitives to the Profile `1.0×` request and `v/a/j` hard limits, deterministically extending duration when needed; two-segment obstacle-avoidance Moves preserve C2 with shared nonzero `q/v/a` boundaries when moving in the same direction and explicitly turn at zero speed when reversing.
- [x] Certify limits and head clearance for every segment with recursive adaptive sampling and conservative link-displacement upper bounds; normal/near-head thresholds are `1°`, `voxelSize/8` and `0.25°`, `voxelSize/16` respectively. Fail closed if proof is unavailable.
- [x] Generate `CutterGridContactEventV4` sorted by action-relative time from certified actual curves, updating expected cuts and remaining Hair with the `0.12` tool; Wait and system entry must cut nothing.
- [x] Pin V4 fixtures and gates requiring 100 Completion, exactly 12 cells, and zero collateral cutting from the default Challenge reference program; fixtures contain only compact primitives, contact events, diagnostics, and signatures.
- Exit: frozen V4 plans have actual-contact and dynamic-safety evidence without serializing dense samples.

### Phase 5: Execution, UI, and Hardware Boundaries

- [x] Before implementation, reread the V4 contracts, v0.3, implementation plan, acceptance checklist, V1–V3 Worker/executor/simulation engine, Workbench, scene, Inspector, ArmDock, and hardware bridge; confirm the production entry point remains on V3 and V4 must switch through a separate executor, without expanding compact primitives into old per-cell waypoints.
- [x] Change the Worker to generate frozen V4 plans; add an absolute-time synchronized PTP replayer that advances positioning trajectories and player actions along the same analytic curves, with each Step completing one visible Move or Wait.
- [x] Connect V4 certified contact events, coordinate/primitive summaries, actual curved paths, and expected cuts to the scene and Inspector, and validate consistency across Run/Test/Step, pausing, long frames, and cancellation.
- [x] Define, serialize, and validate `CutterArmMotionProgramV1`, while ArmDock explicitly rejects V4 and never dispatches it to Electron, the bridge, or firmware.
- Exit: Run/Test/Step, pausing, hidden pages, and cancellation replay the same V4 plan.

### Phase 6: Full Acceptance and Release Preparation

- [x] Reread this plan, v0.3, the implementation plan, acceptance checklist, V4 planning/certification/execution tests, and Playwright visual configuration, confirming this phase only covers acceptance and documentation synchronization.
- [x] Complete quality gates and Profile/geometric/dynamic audits; P95 over five cold starts with one exclusive Worker is `Right 2 = 1,671.8ms` and global regression `= 2,886.2ms`, both below the `3s/10s` gates; player animations from frozen plans all test at ≤`5s`.
- [x] Generate and visually review V4 screenshots in Chrome/Edge at 1280×720 and 1920×1080: PTP curves, Inspector, bottom controls, and local-scoring notices are clear, with no page overflow.
- [x] Audit that only planned frontend changes occurred, with zero backend or hardware-dispatch changes; commit this acceptance documentation separately and offer the branch for review only, without merging `main`.

## Quantitative Acceptance Targets

- P95 over five cold Worker planning runs must not exceed `3s` for `Right 2` or `10s` for `Up 6 → Left 2 → Forward 3`.
- The regression program above retains 3 visible Move actions with at most 6 player primitives; if all three direct PTPs are safe, the count must be 3.
- The regression program player animation in the current Challenge must not exceed `5s`; record positioning time separately and exclude it from scoring.
- Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`, and `npm run test:performance`, and assess curve smoothness in Chrome/Edge at 1280×720 and 1920×1080.

## References

- [MoveIt Pilz Industrial Motion Planner](https://moveit.picknik.ai/main/doc/how_to_guides/pilz_industrial_motion_planner/pilz_industrial_motion_planner.html): synchronized joint-space PTP does not require a Cartesian straight line at the end effector.
- [Ruckig Tutorial](https://docs.ruckig.com/tutorial.html): the Community edition switches to a cloud API with intermediate waypoints, so V4 does not depend on multi-waypoint Ruckig or external planning services.
