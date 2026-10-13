# HCR Simulator Agent Guide

## Current phase

Under the user's explicit authorization, the repository has completed the original Phase 1–6 in `docs/IMPLEMENTATION_PLAN.md`, the five-joint upgrade and deterministic head penetration prevention, the initial Cutter Grid Phase 0–5, and compact synchronized PTP V4 Phase 1–6. The V2 global multi-branch IK and V3 jerk-limited plans remain as historical records superseded by V4; further migration requires new explicit authorization. Neither the original Phase 7 nor any Cutter Grid phase includes deployment.

- Reread the implementation plan and relevant specifications before starting each phase.
- Implement only the scope of that phase, verify it, and commit it separately.
- Do not deploy. Apart from the Cutter Grid compile-time IK and synchronized multi-joint trajectories explicitly authorized in v0.3, do not introduce capabilities outside the initial release's goals.
- When dependencies cross phases, preserve testable interfaces rather than bypassing the plan by implementing a later layer early.

## Documentation precedence

1. The user's current instructions.
2. This file.
3. `docs/HCR_Simulator_SPEC_v0.3.md`.
4. `docs/IMPLEMENTATION_PLAN.md`.
5. `docs/ACCEPTANCE.md`.
6. `docs/HCR_Simulator_SPEC_v0.2.md`, for historical context only.

Write documentation in English. Use English for types, APIs, identifiers, filenames, and necessary code comments.

## Documentation maintenance rules

- v0.3 must stand alone; implementers must not need to reconstruct key decisions from v0.2.
- When product or technical decisions change, update v0.3, the implementation plan, and the acceptance checklist together.
- State confirmed decisions explicitly. Mark unconfirmed content as "Future extension/TBD" rather than presenting it as an initial-release requirement.
- Example types and formulas are interface contracts. Update every reference when fields or semantics change.
- Do not overwrite v0.2; it is a historical record.

## Module boundaries

- Blockly may generate only Program IR; it must not manipulate Three.js, Hair State, or scoring directly.
- R3F components handle rendering and per-frame driving only; they must not contain scoring rules.
- The Simulation Engine owns command execution, time advancement, and collision coordination.
- Head penetration prevention uses pure geometric constraints. On collision, preserve the last safe pose and enter `error`; do not silently correct the pose in the rendering layer.
- Hair Voxels must be represented by a testable logical set, not only by meshes.
- Challenges and scoring must enter the application through Provider interfaces.
- All robot, voxel, collision, and scoring parameters must come from centralized configuration.
- React State must not handle high-frequency joint interpolation at 60 FPS. Keep high-frequency data in controller instances and R3F refs.

## Prohibited in the initial release

- Do not add generic relative angles, arbitrary Cartesian Move, runtime IK, scissor actuation, or a physics engine. Cutter Grid permits only the specified fixed-world-axis single-cell moves, deterministic compile-time IK, and frozen synchronized trajectories.
- Do not add ESP, MQTT, WebSerial, WebBluetooth, or real network dependencies.
- Do not introduce external GLB/FBX robot or hair assets.
- Do not import Local Provider implementations directly into business UI.
- Do not execute user programs with JavaScript `eval` or the Blockly JavaScript Generator.

## Change process

1. Check the v0.3 specification and `docs/ACCEPTANCE.md` first.
2. Once coding begins, follow the dependency order in `docs/IMPLEMENTATION_PLAN.md`.
3. Keep domain logic in pure functions or classes with injectable clocks, and add the relevant tests first.
4. UI changes must keep the main controls unobstructed at 1280×720.
5. When adding configuration fields, update types, local Challenges, documentation, and tests together.
6. Do not commit build artifacts, test reports, or local environment files.

## Definition of done

All of the following commands must pass:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Also complete the manual acceptance items in `docs/ACCEPTANCE.md`.
