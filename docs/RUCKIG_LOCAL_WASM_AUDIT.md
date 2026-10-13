# Cutter Grid Local Ruckig WASM Feasibility Audit

Date: 2026-08-22. Scope is limited to the frontend Spike on `feat/cutter-grid-control`; it does not modify `hcr-backend` or call the backend, ROS, MoveIt, Tesseract, or any planning API.

## Pinned Inputs

| Item | Pinned value |
| --- | --- |
| Upstream | `pantor/ruckig` |
| Version/commit | `v0.19.4` / `a8db97a4e9c55e5160a3855f739fa3b270df8e4c` |
| License | MIT; retain upstream copyright and license text when distributing |
| Compiler | Emscripten `4.0.20` / `c387d7a7e9537d0041d2c3ae71b7538cc978104e` |
| Target | ES module + WebAssembly, `ENVIRONMENT=worker`, no filesystem, fixed 16 MiB initial memory |
| ABI | `ruckig-local-5d-v3`; five degrees of freedom, fully local, offline state-to-state `q/v/a` plus an optional minimum duration; output is `q/v/a/j` with absolute timestamps and every valid jerk-switch time retained |

`cloud_client.cpp` is explicitly excluded from the source list, and `BUILD_CLOUD_CLIENT` is fixed to off in the CMake contract. No intermediate waypoint, URL, HTTP client, program, scene, or hair data can enter this ABI; it therefore cannot trigger Ruckig Community's waypoint cloud API.

## Reproduced Measurements

The fixed input is a stationary start `q=[0,0,0,0,0]`, stationary target `q=[10,-5,3,1,-2]`, per-joint limits `v/a/j=[20,50,200]`, and minimum duration `2s`. The local Worker returns success status `0`, duration of at least `2s`, target endpoint error no larger than floating-point rounding, and zero target `v/a`; the v3 audit also verifies strictly increasing sample times, endpoints at `0/duration`, and the 5ms base grid plus additional jerk-switch points.

Emscripten `-O3` build results:

| Artifact | Size |
| --- | ---: |
| `hcr_ruckig_local.mjs` | 7,022 bytes |
| `hcr_ruckig_local.wasm` | 138,821 bytes |
| Total | 145,843 bytes |
| WASM SHA-256 | `50a4baff744e7d38df8dd259cf44ad5f2e461e6ecd23ebe536a825a96966b407` |

The Chromium Worker probe observes only requests to `/`, `/hcr_ruckig_local.mjs`, and `/hcr_ruckig_local.wasm` on the local audit server; there are no external requests. `verify-ruckig-local-wasm.mjs` also runs Edge when available and makes this gate a repeatable command.

The frontend also uses a pure TypeScript ABI adapter to fix the ordering of nine five-joint input vectors, sample-major timestamped `q/v/a/j` decoding, rejection of non-finite values, and WASM memory release on every error path. The Worker loader accepts only the fixed same-origin `/vendor/ruckig/hcr_ruckig_local.mjs` and `hcr_ruckig_local.wasm` in the same directory; it rejects every other `locateFile` name. `npm run ruckig:wasm:stage` rechecks the ABI, commit, license, byte counts, and SHA-256 before copying the four audited artifacts to ignored `public/vendor/ruckig/`. The default `npm run build` neither implicitly generates nor downloads this binary over the network.

## Conclusions and Remaining Gates

This Spike demonstrates that the pinned Ruckig version can be reduced to a frontend Worker subsegment solver with an acceptable size and no cloud dependency; it does not establish compliance with Cutter Grid's complete motion contract. The current V3 fixed C2 geometry and analytic replay remain the default runtime path. `VITE_HCR_CUTTER_GRID_RUCKIG_TRIAL=1` is solely for explicit local audits: it uses real WASM preplanning and never changes the player experience without that flag.

The trial on 2026-08-22 found that a complete Move produces a large full sample stream to satisfy certification at `5ms`, `0.5°`, and `voxelSize/16`. This has now been corrected under the following contract: dense `q/v/a/j` samples remain exclusively in the Worker for dynamic, collision, Cartesian-tube, and swept-contact certification; the plan passed to the main thread retains only Ruckig's start/end and actual jerk-switch control knots, plus voxel-cut events ordered by first-hit time. Control knots are replayed exactly using piecewise constant-jerk cubics, while cut events are dispatched on a frozen timeline. This avoids rAF frame-rate dependence and avoids mistaking the end-effector trajectory between sparse control points for a long chord. The sparse, serializable object data has been verified in a Chromium Worker to be small enough, so an extra binary protocol is unnecessary for this controlled data volume; the problem must not be hidden by reducing sampling, relaxing joint/head/Cartesian/contact gates, or increasing playback speed.

The following must be completed before replacing the runtime:

1. Completed: while preserving the V2-selected IK branch and fixed Cartesian tube, the pure domain preparation layer generates deterministic conservative TOPP-RA-style path speed and `q/v/a` boundaries; this output is not yet used as a runtime trajectory.
2. Pure domain orchestration completed: pass exact shared boundaries to every local Ruckig segment, expand minimum duration by `1.1x`, fail closed at a `50x` cap, and check endpoints and dynamic limits sample by sample; intermediate waypoints must not be passed. The spatial certification callback treats joint limits, head clearance, the fixed Cartesian tube, combined `0.5°`/`voxelSize/16` sampling, and zero-contact/allowed-contact sets as non-retryable fail-closed gates. This is not yet used as the Worker runtime trajectory.
3. Completed in the pure domain layer: aggregate local-segment spatial results for a complete player Move, compare frozen contact sets exactly, and separate “dense certification samples / sparse replay control knots / timestamped cut events”; the real WASM uses a piecewise constant-jerk cubic C2 representation with jerk-switch points rather than approximating endpoints with quintics that create false jerk peaks. Chromium measurements passed a two-cell Practice Step (about 20 seconds end to end), as well as complete preplanning and the first Step boundary of the `Up 6 → Left 2 → Forward 3` global IK regression (about 2.1 minutes).
4. Completed: input changes, mode/Challenge switches, or component unmount terminate the current dedicated planning Worker and end the old request with `planning-cancelled`; the main thread accepts only the current request id, so stale callbacks cannot write into a new plan. Still pending are the performance baseline for production default enablement and complete regressions in both Chrome and Edge. Ruckig therefore remains explicitly enabled by `VITE_HCR_CUTTER_GRID_RUCKIG_TRIAL=1`; default Cutter Grid continues to use certified analytic V3 trajectories. Every failure fails closed; there is no fallback to network APIs, rendering filters, or old V2 interpolation.

Until these are complete, Rust backend migration remains deferred, and Cutter Grid backend submissions, Session, Match, and ArmDock remain unchanged.
