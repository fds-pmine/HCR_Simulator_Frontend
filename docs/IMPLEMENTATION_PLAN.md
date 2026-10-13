# HCR Simulator Demo Implementation Plan

> This document records implementation status by phase. Original Servo Phases 1–6, the five-joint/head penetration prevention increments, automated integration and quality gates, initial Cutter Grid Phases 0–5, and compact synchronized PTP V4 Phases 1–6 are complete; the global multi-branch IK and jerk-limited phases remain as historical records from before V4 superseded them.

## 1. Implementation Principles

- Follow the dependency order: pure domain logic → Provider → Blockly → simulation → 3D → workbench → E2E.
- Establish testable contracts before connecting the UI in each phase.
- Prioritize a complete, deterministic loop for one Challenge; do not expand product scope early.
- Follow `AGENTS.md` and the v0.3 specification throughout every phase.

## 2. Target Project Structure

```text
src/
├── app/
│   ├── App.tsx
│   └── providers.tsx
├── components/
│   ├── layout/
│   ├── controls/
│   ├── inspector/
│   └── result/
├── features/
│   ├── blockly/
│   │   ├── BlocklyEditor.tsx
│   │   ├── blockDefinitions.ts
│   │   ├── programCompiler.ts
│   │   └── workspaceFactory.ts
│   ├── robot/
│   │   ├── RobotModel.tsx
│   │   ├── RobotController.ts
│   │   ├── headCollision.ts
│   │   └── kinematics.ts
│   ├── voxel/
│   │   ├── VoxelHair.tsx
│   │   ├── hairGenerator.ts
│   │   ├── contactDetection.ts
│   │   └── similarity.ts
│   ├── simulation/
│   │   ├── SimulationEngine.ts
│   │   ├── programExecutor.ts
│   │   ├── simulationStore.ts
│   │   └── SimulatorCanvas.tsx
│   └── scoring/
│       ├── scoring.ts
│       └── types.ts
├── services/
│   ├── contracts.ts
│   └── local/
│       ├── LocalChallengeProvider.ts
│       └── LocalScoreProvider.ts
├── data/challenges/
├── types/
│   └── domain.ts
├── main.tsx
└── styles.css

tests/
├── unit/
└── e2e/
```

Directories may be adjusted slightly without breaking module boundaries; do not build routing, a backend, or a general plugin system for the initial version.

## 3. Phased Tasks

### Phase 0 — Documentation Baseline

- [x] Preserve the historical v0.2 specification.
- [x] Establish a standalone v0.3 specification.
- [x] Create the root README and AGENTS.md.
- [x] Create the implementation plan and acceptance checklist.
- [x] State explicitly that this phase creates no code or dependencies.

### Phase 1 — Project Setup and Quality Gates

- [x] Create a React + TypeScript + Vite project.
- [x] Install R3F, Three.js, Drei, Blockly, and Zustand.
- [x] Configure ESLint, Vitest, jsdom, and Playwright.
- [x] Provide `dev`, `typecheck`, `lint`, `test`, `build`, and `test:e2e` commands.
- [x] Establish the application entry point, global styles, and test setup.

Phase exit: the empty application starts and builds, and all quality commands exist.

### Phase 2 — Domain Model, Challenge, and Scoring

- [x] Implement the v0.3 domain types, VoxelKey conversions, and configuration validation.
- [x] Implement deterministic generators for the target short haircut and initial thick cap hairstyle.
- [x] Establish the single Challenge Definition, robot configuration, and example Workspace data, with the fixed English display names `Neat Short Haircut`, `Thick Cap Initial Hairstyle`, and `Symmetric Neat Crop`.
- [x] Implement the ChallengeProvider / ScoreProvider interfaces and Local implementations.
- [x] Implement IoU, Program Cost, time estimation, and weighted scoring.
- [x] Cover set invariants, Providers, and scoring boundaries with unit tests.

Phase exit: a Challenge can be loaded and scored deterministically without React or Three.js.

### Phase 3 — Blockly and Program IR

- [x] Register absolute-joint, Wait, and Repeat blocks with English labels and tooltips.
- [x] Build joint dropdowns, angle validation, and the toolbox dynamically from the Challenge.
- [x] Implement deserialization of preset Workspaces.
- [x] Implement single top-level stack validation and structured Program IR compilation.
- [x] Implement Repeat expansion, the 500 atomic-command limit, and Source Block ID preservation.
- [x] Cover empty programs, multiple top-level stacks, out-of-range fields, nested Repeat, and counting rules with unit tests.

Phase exit: the example Workspace compiles to a stable, inspectable Runtime Command list without executing dynamic JavaScript.

### Phase 4 — Robot, Simulation, and Collision

- [x] Implement pure forward-kinematics functions and known-pose tests.
- [x] Add `shoulderRoll` and upgrade the rotation chain to full five-joint three-dimensional forward kinematics.
- [x] Implement current angles, target angles, and linear advancement in RobotController.
- [x] Establish deterministic safety constraints between mechanism capsules/spheres and the expanded head ellipsoid.
- [x] Stop at the last safe pose using substeps of at most 0.5° and 12 binary-search iterations.
- [x] Implement Sphere Sweep / Voxel AABB continuous contact detection.
- [x] Implement the Program Executor and SimulationEngine state machine.
- [x] Implement Run, Pause, Resume, Step, Stop, Reset, and completion callbacks.
- [x] Implement Hair Set deletion, metric accumulation, log limits, and scoring triggers.
- [x] Cover frame-rate-independent cutting/head collision, pause freezing, step boundaries, error localization, and Reset with unit tests.

Phase exit: tests with injected delta can run a complete program without UI and produce a hit set and ScoreResult.

### Phase 5 — R3F Scene

- [x] Create the Canvas, camera, lights, ground, and OrbitControls.
- [x] Render the procedural five-joint robot and X-axis shoulder gimbal using nested Groups.
- [x] Render removable voxels from the current Hair Set.
- [x] Render the uncuttable head, end tool, and toggleable Target Ghost.
- [x] Advance the engine and update high-frequency refs in `useFrame`.
- [x] Add a fallback error interface when WebGL is unavailable.

Phase exit: robot animation, Hair deletion, and target preview match engine state; 3D components contain no business scoring rules.

### Phase 6 — Workbench and Debugging Interaction

- [x] Build the main 3D view, left Blockly panel, right Inspector, bottom controls, and log drawer.
- [x] Connect Challenge loading, state-machine controls, and Blockly read-only state.
- [x] Implement current Block highlighting and localization of related compilation errors.
- [x] Display joints, end-effector position, voxels, program metrics, and result breakdowns.
- [x] Implement collapsible panels, keyboard focus, disabled buttons, and the 1280×720 fallback layout.
- [x] Standardize English copy across the workbench, Blockly, logs, errors, fallback interfaces, and accessibility labels, using the joint display names `Base Yaw`, `Shoulder Roll`, `Shoulder`, `Elbow`, and `Wrist`.
- [x] Calibrate a safe example program with nonzero `shoulderRoll` so it finishes naturally with Completion Score ≥80.

Phase exit: a person can complete the full flow from loading, running, and debugging to scoring and resetting.

### Phase 7 — Integration Testing and Delivery

- [x] Complete Playwright coverage of the main loop, error flows, and English runtime-copy assertions.
- [x] Perform manual acceptance in Chrome / Edge at the target viewports.
- [x] Run all quality gates and fix failures.
- [x] Update README startup instructions and the acceptance checklist to match the actual project.
- [x] Confirm there are no backend, hardware, persistence, or deployment dependencies.

Phase exit: all applicable items in `docs/ACCEPTANCE.md` pass.

### Cutter Grid Phase 0 — Baseline, Specification, and Feasibility Gates

- [x] Create `feat/cutter-grid-control` from the freshly fetched `origin/main@afad77e` and record an all-green typecheck, lint, unit, build, and E2E baseline.
- [x] Synchronize v0.3, the implementation plan, acceptance checklist, and AGENTS constraints, treating Cutter Grid compile-time IK as a controlled exception.
- [x] Add versioned Program/Profile/Trajectory types and a Challenge signature covering every certification input.
- [x] Add pure functions for the six fixed directions, finite bounds, coordinate conversion, candidate-start ordering, and geometric contact audits.
- [x] Cache the default Challenge geometric audit: the preferred start has no Hair contact, safe edges exist in all six directions, and all 12 targets are covered by edges with no collateral cutting.
- [x] State explicitly that geometric audits cannot replace joint-trajectory certification; keep the entry point disabled until the Phase 2 Profile is complete.

Phase exit: demonstrate geometric feasibility of the grid and `0.12` tool, with any Challenge drift invalidating the cache; do not connect the player entry point.

### Cutter Grid Phase 1 — Blockly, Separate IR, and Workspace Isolation

- [x] Add `servo | cutter-grid` modes, six Move blocks, and mode-specific toolboxes.
- [x] Implement distance/Wait/Repeat validation, single-cell expansion, the 500 atomic-action limit, and error localization.
- [x] Save separate in-memory Workspaces by Challenge signature and mode, allowing mode switches only in `idle`.
- [x] Keep Servo Program IR, its compiler, and backend serialization completely unchanged.

Phase exit: both languages can be edited and compiled separately, but Cutter Grid does not execute IK yet.

### Cutter Grid Phase 2 — Deterministic IK, Worker, and Certified Profile

- [x] Implement versioned DLS IK, fixed fallback seeds, stable candidate ordering, quantization, and signatures.
- [x] Implement straight-line subdivision, C1 smoothing, tangent breaks at corners, synchronized time parameterization, and secondary validation.
- [x] Implement a cancellable Worker, request versioning, and stale-result rejection.
- [x] Generate a certified Profile proving zero-contact entry, exact removal of the 12 targets by the reference program, and availability of all six directions.

Phase exit: Run/Test/Step obtain the same frozen trajectory, and only a Challenge with a matching signature can enable the mode.

### Cutter Grid Phase 3 — Simulation Execution and Contact Revalidation

- [x] Add `positioning` and `planning` states and a synchronized five-joint trajectory executor.
- [x] Bound Step by a single cell/Wait; Run, Test, and Step reuse the frozen plan.
- [x] Reuse head penetration prevention and `0.12` continuous swept contact to revalidate final state, cut set, duration, and errors.
- [x] Keep the Servo single-joint execution path unchanged.

Phase exit: Cutter Grid trajectories can be replayed deterministically and scored locally without UI.

### Cutter Grid Phase 4 — UI, Lessons, and Provider Isolation

- [x] Add a lightweight toggleable grid, axis legend, coordinate/path/blocked states, and Inspector summaries.
- [x] Add lessons on fixed axes, distance, Repeat, accidental cutting, and unreachable positions.
- [x] Require local scoring for Cutter Grid and disable Session/Match/ArmDock; keep Versus Servo-only.
- [x] Cover modes, Workspaces, planning state, error localization, and submission isolation with E2E tests.

Phase exit: Practice/Lessons support the complete local Cutter Grid loop without affecting the backend or competitions.

### Cutter Grid Phase 5 — Acceptance and Branch Push

- [x] Pass all automated quality gates and Chrome/Edge screenshot acceptance at both viewports.
- [x] Audit frontend scope, zero backend changes, absence of committed build artifacts, and separate commits for every phase.
- [x] Push only `feat/cutter-grid-control`; do not push or merge `main`.

Phase exit: the feature branch is ready for review, with direct evidence for every applicable acceptance item.

### Cutter Grid Tutorial and Lesson Expansion

- [x] Add Cutter Grid/Servo route selection to Tutorial, retaining the original eight-step Servo tutorial.
- [x] Add an eight-step Cutter Grid guide that checks real Cutter Grid IR step by step along the certified five-segment path and completes the final practical steps with actual Test scoring.
- [x] Expand Cutter Grid Lessons from five to ten lessons, each with at least twenty sections; add reverse moves, Waypoint Wait, path ordering, program compression, and certified complete cutting, with previous/next section navigation and continuous progression to the next lesson.
- [x] Expand each of the eight Servo Angles Lessons to at least twenty sections, keeping the actual 100 Completion scoring gate in section 20 and resetting section progress on the next lesson.
- [x] Add a `Grid → Servo Angles` transition demonstration to Tutorial, reusing the real dual-mode Workbench, separate Workspaces, Grid Inspector, and Servo telemetry; standardize the initial state as X/Y/Z/B/E = 90°, calibrate the safe geometric pose corresponding to 90° through `servo.offsetDeg`, show X/Y/Z/B live in Inspector (E parked 90°), and insert no hidden pose commands into Electron Servo plans.
- [x] Cover pure lesson checks, selection/routing UI, and complete certified path planning and scoring with E2E tests; preserve Cutter Grid-only isolation from Servo/backend paths.

Phase exit: first-time users can complete a real certified Grid path without using Servo angles and continue through ten progressive lessons.

### Cutter Grid Global IK Repair Phase 0 — Diagnostic Contracts and Test Vectors

- [x] Start from a fast-forward baseline of the latest remote `feat/cutter-grid-control` and record clean frontend/backend workspaces.
- [x] Pin the 11 atomic actions of `Up 6 → Left 2 → Forward 3`, endpoint `(-2,6,-3)`, the third final forward quarter-layer `(1.03,1.66,0.84)`, high/low Wrist branches, and evidence of reverse-continuous low Wrist.
- [x] Pin the 5-cell result of the actual `0.12` sweep and its 1 non-target collateral cut; the planner must not change this baseline.
- [x] Introduce V2 Profile, trajectory, progress, and error type shells without connecting them to the V1 executor, and define the V1/V2 fail-closed boundary.

Phase exit: pure functions and tests express the V2 defects, semantics, and fixed regressions explicitly; the existing initial-version runtime entry remains unchanged.

### Cutter Grid Global IK Repair Phase 1 — Multi-Solution IK and Continuous Edge Validation

- [x] Split DLS into a single-seed projector and multi-seed candidate enumerator, implementing deterministic Halton expansion, deduplication, diversity preservation, and clearance metrics.
- [x] Implement adaptive Hermite edge validation for second-order transitions; stop using a fixed maximum normalized joint change as a branch filter.
- [x] Pass candidate-coexistence, collision/deviation rejection, determinism, and regression tests.

Phase exit: the domain layer generates and validates multiple safe IK branches without replacing the Profile, Worker, or executor yet.

### Cutter Grid Global IK Repair Phase 2 — Profile V2 and Multi-Entry Certification

- [x] Generate up to 32 origin configurations with zero-contact direct or deterministic PRM entry, and certify at least two distinct entries.
- [x] Produce V2 Profile/signature assets and recertify the reference program, six directions, and static-node semantics; certify the full V2 reference-trajectory signature after global planning in Phase 3.

Phase exit: the V2 Profile demonstrates multiple entries and all initial-version certification requirements; the V2 entry rejects V1 Profiles fail closed.

### Cutter Grid Global IK Repair Phase 2.1 — 90° Home certification repair

Moving every servo Home to 90° invalidated three assumptions the certification
chain had inherited from the old 45°/95°/72.5° Home. All three are repaired in
place; none of the certification gates were relaxed.

- [x] Entry segments refine their sample grid until it resolves the certified
      `voxelSize / 16` tool spacing, instead of refusing a segment the fixed
      0.5°-per-sample grid under-resolves. The more extended Home arm sweeps
      further per degree, which refused all 32 origin candidates on resolution
      alone — with zero head collisions and zero hair contact.
- [x] Profile V2 certifies direct entries first and falls back to the
      deterministic PRM only below the two-entry minimum, so a candidate the
      Profile discards can no longer force a multi-minute PRM build.
- [x] The geometric reference search takes a kinematic reachability filter.
      Geometry alone routed the certified cut through cells no arm pose
      reaches, which surfaced only as a late `no-safe-ik-candidate` failure.
      Both Profile generators supply a static IK check at the same 384 seed
      budget the ladder planner escalates to.
- [x] The V1 entry uses the same certified joint-space move as V2. A straight
      Cartesian line from a tool parked above the crown always sweeps hair.

Phase exit: `npm run cutter-grid:profile` re-certifies V1, V2 and V4 against
the 90° Home challenge, and Run/Test/Step plan again in Cutter Grid mode.

### Cutter Grid Global IK Repair Phase 2.2 — V4 sweep fidelity

V4 flies one synchronized PTP per visible Move, so a long block follows a
joint-space arc rather than the straight line of cells the grid language
describes. Measured on the shipped arm and the Crown Trim target: a 6-cell
block stays within 0.09 world units of the line and cuts exactly the target;
an 8-cell block bows 0.19 — wider than a voxel — and removes two neighbouring
voxels while missing one of its own.

- [x] The certified reference program compresses adjacent moves only up to the
      span both planners reproduce, so the challenge's own proof of
      completability is executable by the planner that actually runs it.
- [x] `npm run cutter-grid:profile` certifies the reference route under the
      compact PTP planner and fails closed when its real sweep is not exactly
      the target set. V4 previously inherited V2's flags without ever checking
      its own sweep, which is how a 76.9-completion reference passed.
- [x] Grid 9 no longer claims compression preserves the geometric path; it
      teaches the endpoint/motion distinction and where merging stops being
      free.

Phase exit: the bundled reference route scores 100 completion through the V4
planner, and the guided content teaches that route.

### Cutter Grid V3 — status on the 90° Home arm

V3 stays a historical record superseded by V4. Two findings from re-running it
against the redesigned challenge, recorded so the Rust migration does not
inherit them silently:

- [x] `unwrapGeometryWaypoints` refused any branch that rides its own joint
      limit. Shoulder Roll sits exactly on 45° for whole plans, and one
      floating-point step above it left the ±360° search with an empty range,
      reported as `joint-branch-discontinuity`. It now admits that step and
      clamps the angle back onto the limit.
- [ ] V3 no longer retimes faster than the V2 ladder it wraps: 1.12x slower on
      the certified reference route, 1.35x slower on the global-IK regression
      program. Its whole premise was the opposite. Nothing ships V3, so this is
      recorded rather than tuned; decide it together with the V4 Rust
      migration.

### Tutorials and Lessons — practice gates progress

- [x] A tutorial step with an engine-checked condition holds Next until the
      condition is met; Exit stays available in the header. Skipping the
      practice taught that the practice was optional.
- [x] Lesson sections that ask for work gate the same way: `build` requires a
      workspace program that shows the lesson's concept, `observe` and
      `challenge` require a completed Test. Reading and predicting sections
      never block, and the quiz and closing practical keep their own gates.
- [x] The Test evidence is per section, not per lesson. A lesson-wide test
      counter let the first Test satisfy every later `observe` and `challenge`
      section at once, so one press marked seven sections done.
- [x] A section may name the control it teaches instead of inheriting one from
      its activity. "Use Step" is gated on Step and "Inspect the overlay" on the
      Grid overlay: each told the learner to use a control that then did not
      release the section, leaving Test as the only way forward. "Inspect
      telemetry" asks only for reading, and no longer demands a run at all.
- [x] Each practical enforces the prompt printed above it. The structural
      checks were far looser than the prompts — "reach (−3, 2, 0) with two Move
      blocks" accepted any single two-cell move — so pressing Test on almost
      anything completed the lesson and opened the next one. Prompts that no
      single program could satisfy were restated rather than left unchecked,
      and every practical is pinned to a worked answer that is reachable on the
      certified grid.
- [x] A build section is checked against the route it printed, not against the
      lesson's practical. The two sections ask for different programs.
- [x] The variation and debugging challenges seed the route they talk about and
      check the edit. "Swap Right for Left" and "debug a route whose Forward and
      Backward blocks were exchanged" were printed over an empty canvas, so
      there was nothing to swap or repair and pressing Test was the only move
      left. Each drill is pinned to a starter that can be placed, an answer the
      gate accepts, and a starter that does not already satisfy it.
- [x] Every Grid lesson example is a route, because three sections template it
      as "read / trace / build this program". Four lessons carried prose there,
      which those sections rendered unbuildable — and left English inside every
      translated lesson, since routes are deliberately not localized.
- [x] Both Chinese variants are checked for script purity. Each is converted
      from the other character by character, and characters missing from a
      conversion table were displayed in the wrong script.
- [x] The lesson checkpoint no longer prints the program it asks the learner to
      rebuild from memory. The requirement stays visible as the practical
      prompt beneath it.

### Cutter Grid Global IK Repair Phase 3 — Global Graph, Worker, and Lifecycle

- [ ] Implement a second-order layered DAG, progressive search, stable progress/errors, V2 frozen plans, and reselection after quantization failure.
- [ ] Change Run/Test/Step/Reset to select entry and player path together and replay entry and player trajectories within the same plan.

Phase exit: the fixed regression and all runtime entry points select the same continuous low-Wrist branch, and the executor performs no runtime IK.

### Cutter Grid Global IK Repair Phase 4 — UI, Regression, and Release

- [ ] Display static IK and current-program connectivity, planning progress, and diagnostics; complete E2E, quality gates, and visual acceptance in both browsers.
- [ ] Push only `feat/cutter-grid-control`, auditing zero backend changes, absence of committed build artifacts, and separate phase commits.

Phase exit: V2 global multi-branch planning passes all acceptance checks and is ready for review.

### Cutter Grid Motion Stability V3 Phase 0 — Contracts, Baseline, and Rust Migration Vectors

- [ ] Record separate diagnostic evidence for C1 Hermite, rendered `delta` scaling, and IK branches; pin V2 signatures, joint `q/v/a`, and contact baselines for `Up 6 → Left 2 → Forward 3`, the certified reference program, and long Wait/Repeat programs.
- [ ] Define pure-domain V3 Profile/Plan/error/signature contracts and frontend–Rust JSON fixtures; fixtures reference versioned Profiles and store full plan signatures, atomic checkpoint/contact/diagnostic summaries, and structured failures. Planning data must not depend on DOM, Worker, React, or the render clock.
- [x] Generate and regression-test a V3 conformance bundle in the frontend: the certified reference program, global IK regression program, and missing-dynamic-limits error can all be reconstructed from versioned Challenge/Profile inputs; Rust consumption and validation await authorization for backend migration.
- [ ] Remove acceleration semantics that directly multiply render delta, replacing them with dynamic-limit retiming input requesting `1.25x`; this phase does not change the production runtime entry point.

Phase exit: tests and fixtures pin V3 inputs/outputs, migration boundaries, and failure semantics, allowing the frontend and future `hcr_sim` to use the same data contract.

### Cutter Grid Motion Stability V3 Phase 1 — Jerk-Limited Trajectories on a Fixed Path

- [x] Complete a local Ruckig Community WASM spike: pin `v0.19.4`/MIT and Emscripten `4.0.20`; the five-joint offline state-to-state ABI passes endpoint and zero-external-request gates in Chromium/Edge Workers. Cloud client sources are excluded; this does not replace the V3 runtime trajectory.
- [x] Pin nine groups of five-joint Ruckig inputs, sample-major `q/v/a/j` output, non-finite-value rejection, and cleanup on errors through a pure TypeScript frontend ABI adapter; the adapter still loads no URLs and drives no runtime planning.
- [x] Prepare local Ruckig segment orchestration with shared TOPP-RA boundaries: pass complete `q/v/a` per segment, sample at intervals no greater than `5ms`, and validate dynamic limits. On failure, retry the same boundary with `1.1x` minimum-duration increases up to `50x`, then fail closed. Callers can inject a pure-domain spatial audit to validate limits, head clearance, the fixed Cartesian tube, combined sampling density, and permitted contacts per segment, then compare the aggregate contact set exactly after the complete player Move. This is not connected to Worker runtime trajectories yet.
- [x] Complete pure-domain, conservative TOPP-RA-style forward/backward reachability propagation: output deterministic path speeds and `q/v/a` boundaries from fixed C2 geometry, keep atomic endpoints at rest, and validate velocity/acceleration limits against real global IK regression geometry. This prepares Ruckig inputs and is not connected to runtime yet.
- [ ] Implement continuous angle unwrapping, global C2 quintic geometric splines, pause-safe checkpoints, velocity/acceleration reachability retiming, and per-segment `q/v/a` jerk smoothing; keep every calculation pure and deterministic.
- [ ] Resolve limit overshoot in global minimum-jerk splines with a deterministic monotone C2 constrained solution visible in the signature, then rerun the complete geometric audit; do not relax limits or fall back to V2 C1 interpolation.
- [ ] Apply combined adaptive validation to every segment: joint `v/a/j`, head clearance, joint limits, Cartesian deviation, and the fixed-tool swept set.
- [ ] Return V3-specific errors and the first source block/coordinate on failure; forbid fallback to C1, per-frame filtering, or execution of a feasible prefix.

Phase exit: V3 generates serializable frozen trajectories for the configuration chain selected by V2 and passes numerical/contact regressions.

### Cutter Grid Motion Stability V3 Phase 2 — Frontend Absolute-Time Experiments and Diagnostics

- [x] Have the Worker report V2 graph search, geometric smoothing, time parameterization, jerk smoothing, and playback validation for V3 through separately versioned progress messages; progress observation does not affect candidate selection or trajectory signatures and explicitly distinguishes Cartesian-layer counts from actual motion-segment counts.
- [x] Record plan/render time, stage, entry, `q/v/a/j`, end-effector tracking error, frame intervals, and `50ms` long frames with bounded telemetry after frontend rAF playback; Inspector shows a development-diagnostics summary collapsed by default. Records do not feed back into planning, execution, collision, or scoring.
- [ ] Have the Worker plan frozen V3 trajectories only; the frontend executor samples absolute plan time and supports pausing, hidden pages, dropped frames, and cancellation without changing trajectory semantics.
- [ ] Use the same frozen V3 plan for contact, Step, Run/Test, scoring, and Inspector; high-frequency UI joint updates bypass React State.
- [ ] Validate plan consistency, absence of joint jumps, and actual duration improvement at `30/60/90/120/144Hz`, with long frames, and in Chrome/Edge.

Phase exit: the frontend serves as a visual testbed before Rust implementation, and V3 no longer accelerates by scaling render time.

### Cutter Grid Motion Stability V3 Phase 3 — Preparation for Rust Authority Migration

- [ ] Implement the same pure-domain planner in `hcr_sim` and compare it item by item with the frontend using shared fixtures; do not change network submission paths before backend Session/Match enablement is authorized.
- [ ] Change the frontend to consume Rust-generated or cross-language-validated V3 plans, retaining local experiment controls and diagnostics without creating another set of path-planning rules in the UI.

Phase exit: the Rust planner is the final authority, and the frontend only requests, replays, and visualizes; signatures, errors, and contact results agree across languages.

### Cutter Grid Compact PTP V4 Phase 1 — Contracts, Baseline, and Failure Tests

- [x] Add a Git-tracked V4 implementation plan and synchronize v0.3 and the acceptance checklist; state explicitly that the V3 fixed Cartesian tube, zero speed at every cell, `1.25x`, and dense output are historical baselines only.
- [x] Pin the V3 global IK regression baseline: 11 atomic Moves, 44 Cartesian layers, 4,286 certification samples, 6,976ms player-plan duration, `1.25x` dynamic request, geometry signature `188fb68c5336a3b4`, and trajectory signature `73549fa7dad52468`.
- [x] Add V4 baseline, expected-failure, and pending performance-gate tests: Move N grouping, 1–2 primitives per Move, `1.0x`, actual sweep, `3s/10s/5s` targets, and ArmDock disablement.

Phase exit: the V4 design, historical comparison, and test entry points are reviewable without changing the production runtime entry point.

### Cutter Grid Compact PTP V4 Phase 2 — Grouped IR and Protocol

- [x] Implement `CutterGridExecutableActionV2`, stable occurrences, 500 logical cost, V4 Profile/Plan/errors/progress, and the `plan-v4` Worker protocol.
- [x] Keep V1–V3 fail closed without switching the V3 runtime entry point yet; the Phase 2 V4 Worker returns structured `planner-not-ready` without falling back to older planners.

Phase exit: pure-domain V4 inputs and outputs can be constructed, serialized, and tested.

### Cutter Grid Compact PTP V4 Phase 3 — Sparse Graph and Two-Instruction Planning

- [x] Implement endpoint IK candidates, 4/8/all edge expansion, synchronized quintic direct PTP, a 256-node roadmap, and compression to a single obstacle-avoidance configuration.
- [x] Validate program-wide entry selection, avoidance of the wrong Wrist branch, and the maximum of two primitives per Move.

Phase exit: generate deterministic, compact, collision-free V4 geometric plans.

### Cutter Grid Compact PTP V4 Phase 4 — Dynamic Certification and Actual Sweep

- [x] Implement the `1.0x` time law, C2 obstacle-avoidance boundaries, conservative adaptive clearance proofs, actual Hair contact events, and V4 fixtures.
- [x] Recertify the 100 Completion reference program; dense certification samples must not enter the serialized plan.

Phase exit: frozen V4 plans contain evidence of actual contact, dynamic limits, and signatures.

### Cutter Grid Compact PTP V4 Phase 5 — Execution, UI, and Hardware Boundaries

- [x] Connect the absolute-time executor with Step per visible action, actual-curve/expected-cut UI, and cancellation lifecycle.
- [x] Implement and test `CutterArmMotionProgramV1`, while ArmDock continues to reject V4 dispatch.

Phase exit: Run/Test/Step and different ticks replay the same V4 plan; hardware is not enabled without authorization.

### Cutter Grid Compact PTP V4 Phase 6 — Acceptance and Release Preparation

- [x] Reread the V4 plan, v0.3, acceptance checklist, planning/certification/execution tests, and Playwright configuration, confirming that this phase only supplements acceptance evidence.
- [x] Complete all quality gates and Profile/geometric/dynamic audits, measuring P95 over five cold starts with one exclusive Worker: `Right 2 = 1,671.8ms`, global regression `= 2,886.2ms`; visual acceptance passes at both resolutions in Chrome/Edge.
- [x] Audit zero changes to the backend and hardware dispatch; commit the acceptance documentation separately and offer the branch for review only, without merging `main`.

Phase exit: V4 meets compact-instruction, smoothness, performance, and safety gates and is ready for branch review.

## Cutter Grid V4 Rust Backend Planner Migration

This migration and subsequent CAT/mechanical calibration follow `docs/BACKEND_CUTTER_GRID_V4_MIGRATION_PLAN.md`. Each phase must read the relevant plans and code, update this section and acceptance items, modify, test, and commit separately in each repository; do not write to or push `main`.

Post-merge audit on 2026-08-25: backend `54a8582` already contains the Phase 2–5 implementations below, and frontend `a45a832` already contains the Provider. The original checklist lagged behind the code; this round added CAT mode-pinned Sessions, explicit Practice routing, Challenge version forwarding, and malformed-success-response validation. Full Rust repository quality gates still need to run separately in the backend repository before Phase 7 can be marked complete.

### Phase 1 — Contracts, Baseline, and Failure Tests (In Progress)

- [x] Create frontend `feat/cutter-grid-rust-planner-client` from `origin/feat/cutter-grid-control` containing V4, and backend `feat/cutter-grid-v4-rust-planner` from the latest `origin/main`. Run `fetch` again before implementation; baselines are frontend `5e614cf` and backend `501a995`.
- [x] Define separate `CutterGridPlanRequestV1` / `CutterGridPlanResponseV1`, V4 Profile/Plan/synchronized PTP/diagnostic DTOs, and `TRAJECTORY_PLANNING_FAILED` error mapping; retain V2 client-uploaded trajectory audits only for historical compatibility.
- [x] Pin cross-language JSON fixtures and expected-failure vectors; runtime routing was enabled in later phases.
- [ ] Run Rust quality gates after external workspace dependencies are restored: on 2026-08-25, `cargo test -p hcr_qbank -p hcr_service` against the latest backend failed to load the sibling path dependency `/private/tmp/arona/Cargo.toml`; do not bypass this by changing Cargo configuration or fabricating dependencies.

Phase exit: contracts, error localization, and version boundaries have test coverage, with frontend/backend documentation synchronized; the Practice Worker entry point is unchanged.

### Phase 2 — Program Compilation, Geometry, and IK

- [x] Port grouped-action compilation, coordinate conversion, kinematics, head clearance, Halton seeds, multi-solution DLS, and deterministic candidate ordering into the `std + planner` pure-domain module of `hcr_sim`.
- [x] Pin the six directions, Repeat, the 500 limit, and low-Wrist regression; use cross-language fixtures to compare actions, coordinates, command counts, candidate branches, and structured failures.

### Phase 3 — Profile and Compact PTP Graph Search

- [x] Register certified V4 Profiles on the server and port entry selection, endpoint graphs, direct PTP, and the single-obstacle-avoidance roadmap; strictly limit every visible Move to 1–2 primitives.
- [x] Add separate tests for Profiles, roadmaps, missing Profiles, and disconnected edges; clients must not upload any Profile assets.

### Phase 4 — Dynamic Certification, Sweep, and Serialization

- [x] Port the `1.0x` synchronized quintic time law, `q/v/a/j` limits, adaptive collision certification, actual `0.12` tool sweep, contact events, and Rust-local trajectory signatures.
- [x] Establish semantic and numerical-tolerance gates for TS/Rust success/failure vectors; byte-identical signatures across implementations are not required.

### Phase 5 — Server Planning Interface

- [x] Implement the Profile registry, `POST /api/v1/cutter-grid/plans`, 64KiB request limit, bounded `spawn_blocking` concurrency pool (default 2), and HTTP 422/429 error mapping.
- [x] This interface only generates plans for Practice; it does not score, submit, create Session/Match state, or access ArmDock.

### Phase 6 — Frontend Primary and Fallback Provider

- [x] Add `CutterGridPlannerProvider` so Workbench does not depend directly on Worker; default to local planning, with Rust explicitly selected only for online Practice and Worker retained offline.
- [x] Fall back to TypeScript only on network errors, the 30-second timeout, 429, or 5xx. Deterministic 4xx, signature errors, and malformed success responses fail closed; Inspector shows the source.

### Phase 7 — Full Acceptance and Release Preparation

- [ ] Pass quality gates in both repositories, cross-language audits, performance checks, and Chrome/Edge visual acceptance; push only feature branches for review without merging or deploying.

## Versus round work, 2026-09-10

Authorized directly by the user in the session of 2026-09-10, outside the phased plan above: four items
raised from classroom use, delivered together on one branch. Every claim below is covered by
`tests/unit/versusFlow.test.tsx`, `tests/unit/versusSeason.test.ts`, `tests/unit/match.test.ts`,
`tests/unit/programmingMode.test.ts` and `tests/e2e/versusRoundModes.spec.ts`, and recorded in
`docs/ACCEPTANCE.md`.

- [x] **The canvas a new attempt opens on.** `ProgrammingWorkspaceMemory` is keyed by Challenge signature
      and mode and outlives a round, so a rematch on the same Challenge reopened the editor on the
      previous round's finished program — `withBlankCanvas` only ever dropped the *starter* workspace.
      `withFreshCanvas` forgets every mode and is called during render, before the editor mounts, by
      Versus, Solo Practice and the Control Modes tutorial. The memory itself stays: it is what keeps a
      mode switch or a panel collapse from costing a learner their work mid-attempt.
- [x] **A session has an ending.** Rounds already folded into a points table; nothing ever read the top of
      it. `SessionChampion` crowns the leader — points, rounds, wins, the crew league — and the scoreboard
      offers **End the session** to the host once a round has been folded in.
- [x] **The round declares its editor.** `MatchConfig.programmingMode` was already in the backend contract
      (`hcr_contract::round::MatchConfig`, enforced there with `WRONG_PROGRAMMING_MODE`); the client now
      sets it. An offline room may be opened in Cutter Grid, refuses to open on a Challenge with no
      certified Profile, and enters a route as the program plus the frozen V4 plan it was scored on —
      all of it in the browser. Online rounds keep the option disabled while `08-CUTTER-GRID.md` §0 keeps
      V4 out of submissions; see the amendments in v0.3 §15.1, §15.3.4 and §15.4.
- [x] **Who starts, and when.** Start and Next round are drawn only on the client that opened the room —
      a convention, not authority, since the server has no host and the room code is still the whole
      permission model. Starting counts the room in for `ROUND_COUNTDOWN_MS` against `opensAt`, so every
      screen enters on the same second instead of on its own poll. An offline room grants those seconds;
      online they are the first seconds of the round, because only the server may move a deadline.

Not done, and deliberately: no server-side host, which would be a backend change.

### Online Cutter Grid rounds, 2026-09-11

The item left open above, authorized by the user the same day and implemented across both repositories.
The blocker was never a missing feature: the server already scored Cutter Grid match entries, but only as
`{program, plan}` with a **V2 ladder** trajectory, and this frontend plans **V4**. A V4 plan failed the
`plannerVersion` check on arrival, fail-closed and correctly.

Rather than teach the frontend to produce a V2 plan it no longer uses — which would have meant the player
watching one motion and being scored on another — the backend's submission path was opened to V4:

- `SubmissionCreate.cutterGridV4` carries the lattice program **only**. `HcrService::create_submission_for`
  plans it with the server's registered `CutterGridProfileV4` and scores the result with
  `hcr_sim::replay_planned_v4`. No trajectory is uploaded, so there is nothing to audit — the V2 channel's
  whole apparatus of signature and waypoint checks exists because there is.
- `create_match` refuses a Cutter Grid round this server cannot plan, and an unpinned round skips items it
  has no Profile for. Declaring the mode in the catalog and holding a Profile are different facts.
- Frontend: `MatchSubmission.cutterGridV4`, forwarded by `HttpMatchProvider`; the mode control is offered
  online; and the workbench's hardcoded "Backend replay not yet supported" notice — untranslated, and false
  from the moment this landed — now prints the localized sentence that matches who is scoring.

Solo Practice followed the same day and needed no new channel: a session submission is the same
`SubmissionCreate` with `sessionId` set, so opening the submission path opened Solo with it. What changed
on this side is that Solo now *asks* which editor before it opens a session — the switch used to live on
the finished screen, so the only way to practise Cutter Grid was to sit through a Servo session first — and
that a Cutter Grid attempt can be entered at all: `PracticeRun` plans, scores and submits the route the way
a round does. On the server, `start_session` builds its bank only from items it holds a Profile for.

Limit worth stating: the server registers one V4 Profile, `neat-short-cap`, so that is the only challenge an
online Cutter Grid round or session can currently use. The other eight live in
`src/data/cutter-grid-profiles/` on this side; vendoring them into `crates/hcr/assets/` is what would open
the rest, and is not done here.

### macOS Free Ad-Hoc Signing CI, 2026-10-07

- [x] Switch macOS tag and manual builds to free ad-hoc signing, removing Apple credential requirements and paid notarization.
- [x] Add a custom signing hook for electron-builder 25.1.8, retaining Electron entitlements and Hardened Runtime; provide a command for local user re-signing.
- [x] Check complete signatures, ad-hoc type, and application identity for x64 and arm64 before upload.
- [x] Add a local-network usage description and document first launch, Local Network permission, and ad-hoc permission-identity limitations.
- [x] Validate the configuration schema, workflow YAML/Bash, signing script, and entitlements plist locally; successfully package the arm64 application with local Electron 33.4.11 and pass checks for complete signing, usage description, Electron executable startup in Node mode, and the same checks after local re-signing.
- [ ] Run the free-signing manual build on GitHub and verify the new installers for both architectures. Current work changes repository configuration only, with no deployment or release.

### Audit security remediation and code quality plan (2026-10-13)

The work was scoped against `HCR_Frontend_Audit.md` (baseline `424b53b`) under the user's task request. An uncommitted security patch and directly related regression tests were prepared before the AI-tier clarification. Remaining work is tracked in English GitHub `[Draft]` issues. Each later phase must reread the specification and this plan and be verified separately. Deployment is outside this plan.

Governance status: the user specified **Human-Led** after supplying the FDS policy. The human must write the structure and load-bearing logic; substantive AI-written security logic remains a proposal for human authorship/adaptation, not a compliant completed implementation. This repository has no `GOVERNANCE.md`, `POLICY.md`, or `CONTRIBUTING.md`, so assignments and independent reviewers cannot be verified. The current branch is `main`, while the supplied policy names `master`; do not infer a governed target or invent ownership. Formal Update Reports and QA records must be handwritten in ink without AI assistance. This technical plan is neither record and makes no approval claim. No commits, PRs, merges, deployments, or releases were made by this task.

Suggested staging for the human implementation: separate independently valid changes for arm preflight; desktop HTTP/lifecycle security; input/plan validation; identity/consent/recovery; and dependency/CI hardening. Keep mechanical edits separate from semantic commits. Size personal PRs around the policy's approximately ten independent design definitions, splitting these broad scopes further when necessary; do not treat this entire patch as one eligible Trivial Update. Confirm the branch route and responsible reviewers before entering any governed integration branch.

| Phase | Scope and dependencies | Exit criteria |
|---|---|---|
| S1, current proposal | Candidate repository fixes for F1–F3 and F5–F20; F4, hardware calibration, and cross-platform evidence remain open | Human-authored implementation under Human-Led, the five established quality gates, security regressions, and 1280×720 privacy/recovery checks; independent review and applicable human records before integration |
| Q1, next for review | Unicode name contract; cross-round state, automatic next rounds, in-room errors, submission exclusion, response-body deadlines, and polling races (Q1, Q3–Q6, Q10, Q16–Q17) | Frontend/backend name contract tests, delayed requests/fake clocks, and duplicate-submission regressions; hiding a button does not establish authorization |
| Q2, depends on the state regression baseline | Grid replanning after terminal states and V4 Step (Q2, Q8); additional evidence for Servo frame-rate determinism (Q7) | Regressions for rerunning after edits and stepping while paused; for Q7, preserve a reproducing program before selecting an integration strategy |
| Q3, depends on the first two phases being stable | Profile cold loading, empty-node boundaries, worker/fixture dependency graph, and Provider boundaries (Q11–Q13, Q15, Q18) | Before/after cold-loading and bundle-size measurements; identical trajectories, signatures, and scores; preserve historical V2/V3 files unless deletion receives separate explicit authorization |
| Q4, independent follow-up | Remaining type checks, package size, and lockfile/icon/theme/CI version gates (Q14, Q19–Q20) | All quality gates, actual package checks, and specific UI regressions; no deployment |

This round covers complete Servo preflight and rejection of unsupported joints; HTTPS external links, sandbox/single-instance/fuses; absolute arm HTTP deadlines, canonical addresses, errors without response bodies, reload cancellation, and serialized parking; prototype-safe crew lookup and root recovery; withdrawal/new-player identity clearing and preservation of consent choices; Challenge geometry and remote-plan resource bounds; room codes and removal of public tokens; CI credentials/SHA/registry; score descriptions and classroom static hosting. Q9's Wait 0/obstacle-avoidance primitive compatibility is also fixed. Q18's path memoization and sampling cap, and Q14's Electron security tests/CJS lint, are complete; their remaining parts stay open.

Audit review corrections: Q7's historical score difference was not reproduced in this round and remains an evidence gap. The planner already bounds HTTP body consumption with a timeout; Q16's gap is in `ApiClient`. `WorkbenchBootstrap` is already test-only, while the old ArmDock V1/V2 endpoint branches remain callable and must not be deleted as presumed dead code.

These fixes are not a complete safety or security proof. F4 requires backend anonymous credentials, host permissions, and negative server tests. F1 still requires calibration of real directions, offsets, and head position, verification of the firmware Home path, and evaluation of the renderer-to-main trust boundary. F3/F11 still require installation, signing, and sandbox/fuse verification on all three desktop platforms. Electron's [official release record](https://releases.electronjs.org/release/v44.7.0) and [permission documentation](https://www.electronjs.org/docs/latest/api/session) support the runtime version and clipboard permission decisions. After dependency patches, production `npm audit --omit=dev` reports no vulnerabilities. The full audit retains eight moderate findings from the build tools' `sprintf-js` chain; downgrading to a version with known installer risks is not an acceptable way to clear those findings.

The remaining issues were created on GitHub as ordinary issues with `[Draft]` titles; they are backlog proposals, not approved work or formal governance records:

| Issue | Scope | Audit references |
|---|---|---|
| [#4](https://github.com/fds-pmine/HCR_Simulator_Frontend/issues/4) | Unicode names and backend transport | Q1 |
| [#5](https://github.com/fds-pmine/HCR_Simulator_Frontend/issues/5) | Round state, feedback and network recovery | Q3, Q4, Q6, Q16, Q17 |
| [#6](https://github.com/fds-pmine/HCR_Simulator_Frontend/issues/6) | Submission lifecycle and duplicate attempts | Q5, Q10 |
| [#7](https://github.com/fds-pmine/HCR_Simulator_Frontend/issues/7) | Grid restart and V4 Step | Q2, Q8 |
| [#8](https://github.com/fds-pmine/HCR_Simulator_Frontend/issues/8) | Frame-rate determinism evidence | Q7 |
| [#9](https://github.com/fds-pmine/HCR_Simulator_Frontend/issues/9) | Profile cold loading and empty-node bounds | Q11, remaining Q18 |
| [#10](https://github.com/fds-pmine/HCR_Simulator_Frontend/issues/10) | Production imports and Provider boundaries | Q12, Q13, Q15 |
| [#11](https://github.com/fds-pmine/HCR_Simulator_Frontend/issues/11) | Quality coverage, installer payload and hygiene | Remaining Q14, Q19, Q20 |
| [#12](https://github.com/fds-pmine/HCR_Simulator_Frontend/issues/12) | Backend identity and authority | F4 |
| [#13](https://github.com/fds-pmine/HCR_Simulator_Frontend/issues/13) | Physical calibration and desktop acceptance | A8, A9, residual F1/F3/F11 |
| [#14](https://github.com/fds-pmine/HCR_Simulator_Frontend/issues/14) | Remaining build-tool advisory | Residual F3/F14 |

Verification of the uncommitted proposal:

- `npm run typecheck`, `npm run lint`, and `npm run build` pass. Builder configuration schema and official-registry lockfile checks also pass; build output retains the existing large-chunk warning.
- Focused security regressions pass, including actual loopback HTTP fixtures and sequencer cancellation/parking tests. Chromium checks cover all ten localized menus and English participation/recovery at 1280×720.
- The initial full `npm test` run passed 74 files and 666 tests but failed the tutorial-route `beforeAll` deadline; two associated tests were skipped. A lower-concurrency rerun also exceeded the same 10-second hook deadline. The tutorial file passes with a diagnostic CLI hook override, taking 11.41 seconds for setup/tests; no checked-in timeout relaxation was made.
- `npm run test:e2e` did not pass: the Grid submission test exceeded its 30-second total deadline, despite its failure snapshot showing a completed run and accepted attempt. It requests a 60-second acknowledgment wait inside that shorter total budget. No full E2E pass is claimed.
- Read-only profiling found a real proposed hot-path regression: 20,000 clearance evaluations took 116–128ms at the baseline versus 391–400ms in the candidate, with identical output (about 3.4× steady-state cost). New malformed-input checks repeat inside ellipsoid clearance bisections. This is tracked in [#9](https://github.com/fds-pmine/HCR_Simulator_Frontend/issues/9); increasing test deadlines alone would not fix it. Human-authored correction and complete gate reruns are required.
- Backend authorization, actual desktop packages/fuses, physical calibration, and eight moderate build-tool dependency findings remain open as linked above. All source changes remain uncommitted; the original untracked audit is preserved.

## 4. Key Implementation Conventions

### Simulation and React

- `SimulationEngine` is a long-lived testable instance; do not recreate it repeatedly during React render.
- R3F `useFrame` only calls the engine tick and updates Group refs.
- Zustand stores state enums, the Hair Set, low-frequency joint snapshots, metrics, logs, and UI toggles.
- The controller is authoritative for high-frequency angles and end-effector positions; throttle snapshots published to the UI.

### Blockly

- The editor component owns the Workspace and exposes `compile`, `setReadOnly`, `highlightBlock`, and `resetHighlight` through explicit APIs.
- The compiler accepts only the Blockly Workspace and Challenge configuration, returning a successful result or structured error.
- The UI must not traverse Blocks to generate commands itself.
- Block fields, toolbox categories, and tooltips use English; translation must not change Blockly types, field names, or Program IR.

### Contact

- A motion tick obtains the previous position, advances the joints, then obtains the current position.
- Collision functions have no side effects and return only hit VoxelKeys.
- SimulationEngine centrally deletes voxels, updates counts, and writes logs.
- Apply head safety constraints before RobotController commits every angular substep; the rendering layer must not override the result.
- A command causing head collision remains incomplete; SimulationEngine enters `error`, preserves the scene state, and does not trigger scoring.

### Scoring

- Scoring inputs are immutable snapshots.
- LocalScoreProvider only calls pure scoring functions.
- The UI only formats ScoreResult and does not recalculate any component.

## 5. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| The example robot path accidentally cuts the Target | Leave collision-radius safety clearance between the initial extra layer and target layer, and calibrate with deterministic integration tests |
| Missed collisions at low frame rates | Use segment sweeps rather than checking only the current frame endpoint |
| Mechanism penetrates the head | Apply expanded-ellipsoid constraints to all links, joints, and tools, with binary-search rollback at substep boundaries |
| Blockly version API changes | Encapsulate registration, serialization, and compilation within the feature to contain version-specific details |
| Per-frame React updates cause stutter | Keep high-frequency state in the engine/refs and throttle UI snapshots |
| Unstable E2E WebGL | Base primary assertions on visible state and business results, with manual acceptance supplementing 3D visuals |
| Inconsistent repeated-run results | Force Run to rebuild from the Challenge initial state and use instruction-estimated time for time scoring |

## 6. Final Delivery Definition

- Implement the entire initial-version scope in the v0.3 specification.
- The example program finishes naturally, removes at least one voxel, and achieves Completion Score ≥80.
- All automated quality gates pass.
- Manual acceptance passes at 1280×720 and 1920×1080.
- Documentation matches actual behavior, with no resolved initial-version TBDs left open.
- Include no explicitly excluded features or implicit network dependencies.
