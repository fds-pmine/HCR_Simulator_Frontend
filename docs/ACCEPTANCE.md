# HCR Simulator Demo Acceptance Checklist

> Servo Phase 1–6, the five-joint/head penetration prevention increment, automated integration, the initial Cutter Grid Phase 0–5, and compact synchronized PTP V4 Phase 1–6 have all been implemented and accepted. Global multi-branch IK and jerk-limited items remain only as historical evidence from before V4 superseded them. Check functional items only when supported by direct verification evidence.

## Documentation baseline

- [x] v0.2 is retained as the historical specification.
- [x] v0.3 independently describes goals, interfaces, execution semantics, and boundaries.
- [x] README provides the public English entry point, current status, English documentation policy, and document navigation.
- [x] AGENTS.md defines documentation precedence, module boundaries, and current-phase restrictions.
- [x] The implementation plan includes phase dependencies, exit criteria, risks, and the definition of done.
- [x] This checklist distinguishes automated, functional, error, and manual visual acceptance.
- [x] v0.3 independently defines Cutter Grid mode boundaries, IR/Profile/trajectory contracts, planning parameters, and fail-closed semantics.

## Cutter Grid Phase 0 gates

- [x] The feature branch was created from freshly fetched latest `origin/main`; no code was added directly to `main`.
- [x] The complete Challenge signature covers joints, geometry, collision, voxel/head, initial/target Hair, cutter, and version inputs.
- [x] Directions are fixed: Right `+X`, Left `-X`, Up `+Y`, Down `-Y`, Forward `-Z`, and Backward `+Z`.
- [x] The default Hair bounding box extends two cells along each axis and includes the preferred Hair lattice start `(0,-5,8)`.
- [x] A stationary check at the preferred starting cell center with radius `0.12` does not contact Hair.
- [x] Each of the six directions has at least one axis-aligned edge that does not contact non-target Hair.
- [x] Each of the current 12 target voxels is covered by at least one axis-aligned edge that does not contact non-target Hair.
- [x] The audit cache matches the current Challenge signature and explicitly marks joint-trajectory certification as `pending-planner`.
- [x] The certified Profile proves zero-contact entry, enabled-node classification, certified edges in all six directions, and the safety of the reference program's complete joint trajectory.

## Cutter Grid functional acceptance

- [x] Servo is selected by default; Cutter Grid is available only in Practice and its dedicated Lessons.
- [x] Distances for all six Move directions are integers `1–12`; Move N expands to N cells, with an expanded limit of 500.
- [x] Servo/Cutter Grid Workspaces are retained independently and can be switched only in `idle`.
- [x] Compile-time IK, synchronized trajectories, Worker cancellation, and signatures satisfy the v0.3 parameters.
- [x] Entry has zero contact and does not count toward commands, duration, or scores; each Step executes one cell or Wait.
- [x] Run, Test, and Step reuse the same frozen plan and produce identical final states, cut sets, and metrics.
- [x] The grid, axis legend, current/next coordinates, paths, and blocked nodes are visible and can be hidden.
- [x] Cutter Grid is scored locally only, does not submit to Session/Match, and does not drive ArmDock; Versus remains Servo-only.
- [x] The reference program removes exactly 12 targets with no collateral deletion and achieves 100 Completion.
- [x] The Tutorial entry offers Cutter Grid or Servo independently. The Grid tutorial builds the certified five-segment path from an empty Workspace in eight steps; completion comes from actual Grid IR and Test Score.
- [x] Cutter Grid presents ten progressive lessons with at least twenty sections each, clear goals, executable examples, navigation within lessons, and an uninterrupted next-lesson entry, without exposing Servo mode.
- [x] Grid tutorial E2E covers certified-path injection, step-by-step completion checks, V4 planning, Test replay, and final completion.
- [x] Each of the eight Servo Angles Lessons has at least twenty sections; section 20 unlocks the next lesson only when an actual Test reaches 100 Completion.
- [x] The `Grid → Servo Angles` tutorial verifies Grid Move, Servo mode switching, absolute-angle blocks, and retained Grid Workspace content in the actual Workbench. Hardware initial values and new blocks use Home 90°. Inspector X/Y/Z/B displays and updates current simulated servo angles, E is explicitly parked at 90°, and Electron Servo plans begin only with Home.

## Cutter Grid global multi-branch IK repair

- [x] Automated diagnostic evidence exists for the fixed regression program, failed Cartesian layers, the statically safe low-Wrist branch, the reverse continuous branch, and the actual 5-cell sweep baseline.
- [x] V2 Profile, trajectory, progress, and error interfaces are isolated from V1 runtime assets; production entry points have not been switched prematurely.
- [x] Deterministic unit tests pass for multiple IK solutions per layer, candidate deduplication/diversity, clearance, and continuous-edge validation.
- [x] The V2 Profile certifies at least two distinct origin configurations and zero-contact entry. The reference program's geometric result of 12 cells/0 collateral cuts, six directions, and signature gates do not regress. The complete V2 reference trajectory will be certified after implementing the global graph.
- [ ] `Up 6 → Left 2 → Forward 3` reaches `(-2,6,-3)` using the low-Wrist branch without collision or Cartesian shortcuts, preserving the actual 5-cell sweep result.
- [ ] Run, Test, and Step select the same entry and frozen V2 plan, exclude entry from scoring, and produce identical results across different ticks.
- [ ] UI distinguishes statically safe IK, connectivity for the current program, search progress, and search-budget exhaustion.

## Cutter Grid jerk-limited motion stability (V3, historical baseline)

The following V3 items are a historical baseline. V4 no longer accepts a fixed Cartesian tube, per-cell zero-velocity checkpoints, `1.25x` requests, or dense certification points as output commands. The subsequent section defines V4 acceptance.

- [x] The local Ruckig Community WASM Spike pins `v0.19.4`/MIT, Emscripten `4.0.20`, and the five-joint state-to-state ABI. Chromium/Edge module Workers request local JS/WASM only; the cloud client was not compiled. This Spike is not yet the runtime planner.
- [x] The frontend Ruckig ABI adapter fixes the five-joint `q/v/a` input order, `q/v/a/j` sample-major output, rejection of non-finite values, and memory release on error paths. It loads neither network resources nor the DOM and is not yet connected to the player.
- [x] Pure-domain Ruckig segment orchestration reuses TOPP-RA boundaries and verifies shared `q/v/a`, dynamic limits sampled at `5ms`, and fail-closed duration expansion from `1.1x` to `50x`. Callers can inject local spatial certification to check joint ranges, head clearance, the fixed Cartesian tube, combined `0.5°`/`voxelSize/16` sampling, and zero-contact/allowed-contact sets per segment, aggregating the exact frozen contact set after each complete player Move. This contract is not yet connected to the Worker or current player.
- [x] Pure-domain TOPP-RA-style reachability propagation deterministically produces pause-safe `q/v/a` boundaries on fixed V3 C2 geometry, with zero endpoints and every node within effective velocity/acceleration limits. It has not changed runtime retiming or contact semantics.
- [x] The V3 Worker reports global IK graph search, geometric smoothing, time parameterization, jerk smoothing, and playback validation through independently versioned messages. Observing progress does not change candidate order, frozen trajectories, or signatures; layer and actual motion-segment counts use the correct units.
- [x] V3 rAF replay produces bounded read-only telemetry: planned/rendered time, `q/v/a/j`, end effector, branch/cell, frame intervals, and `50ms` long-frame statistics are inspectable for every playback frame. Re-anchoring a hidden page does not catch up to wall-clock time. Inspector collapses this development information by default; telemetry does not affect motion semantics.
- [x] The frontend experiment still requests `1.25x` speed but tightens acceleration/jerk to `1250x`/`200000x` rated speed. The shortest cell in the global IK regression is at least `90ms`; the recorded `56ms` three-frame joint jumps no longer occur.
- [ ] V3 Profile/Plan/diagnostics, signatures, and failure results are pure serializable domain data with shared frontend–Rust fixtures. Success vectors contain the complete plan signature, atomic checkpoints, contacts, and diagnostic summaries; failure vectors contain structured errors.
- [x] The frontend V3 conformance bundle fixes the certified reference program, `Up 6 → Left 2 → Forward 3`, and the missing-dynamic-limits error. Fixtures currently exist only in the frontend repository; once Rust migration is authorized, `hcr_sim` must consume and verify each one.
- [ ] V3 preserves V2's globally selected IK configuration chain, fixed Cartesian path, head clearance, and `0.12` swept-contact semantics.
- [ ] V3 uses deterministic global C2 quintic geometric splines for each fixed path. Atomic moves and system entry replay with shared knot `q/v/a`, identical dynamic limits, and an absolute time law; falling back to V2 C1 interpolation is forbidden.
- [ ] Every atomic-move boundary is a pause-safe checkpoint with `v=a=0`. Every segment satisfies hard joint velocity, acceleration, and jerk limits, without angle wrapping or quantization feedback jumps.
- [ ] Adaptive validation of the complete smoothed trajectory uses intervals no greater than `5ms`, preserving joint limits, head collision avoidance, the `voxelSize/16` Cartesian tube, and contact sets.
- [ ] `Up 6 → Left 2 → Forward 3` preserves the safe low-Wrist branch, endpoint `(-2,6,-3)`, and established actual 5-cell sweep result.
- [ ] Run/Test/per-cell Step, `30/60/90/120/144Hz`, long frames, pauses, and hidden pages produce identical joints, final states, and cut sets at the same planned time; rendering `delta` multipliers no longer speed up playback.
- [ ] Dynamic-limit retiming requests `1.25x` by default and reduces actual duration by at least `15%` against the same V2 baseline path, or explicitly reports the hard-constraint limit without exceeding it during playback.
- [ ] Cutter Grid backend submissions, Session, Match, and ArmDock remain disabled before Rust `hcr_sim` migration. After migration, shared fixtures prove Rust's planning authority.

## Cutter Grid compact synchronized PTP (V4)

- [x] The version-controlled V4 plan, v0.3, implementation plan, and this checklist are synchronized and explicitly supersede V3's strict straight-line, per-cell stopping, and dense-output requirements.
- [x] Automated tests fix the historical V3 baseline: the global IK regression has 11 atomic Moves, 44 Cartesian layers, 4,286 certification samples, 6,976ms player-plan duration, a `1.25x` dynamic request, geometry signature `188fb68c5336a3b4`, and trajectory signature `73549fa7dad52468`.
- [x] `CutterGridExecutableActionV2` combines Move N into one visible action while preserving Repeat occurrences, Wait, and the 500 logical-cost limit; Step completes that Move in one operation.
- [x] V4 builds the global IK graph only for certified entries and visible Move endpoints. Initial/expanded candidate budgets are `12/48` seeds and `12/24` retained candidates; edges are verified deterministically in `4/8/all` order.
- [x] A direct edge generates one synchronized quintic PTP. On collision, at most one avoidance configuration and two primitives are allowed; exceeding the budget fails closed with `motion-primitive-budget-exhausted`.
- [x] V4 requests `1.0x` by default with at least 160ms per primitive; all `q/v/a/j`, limits, clearance, and adaptive interval proofs have been reconfirmed.
- [x] Cutting is precertified along the actual curve with radius `0.12`. Run/Test/Step replay the same frozen plan; coverage includes small ticks, long ticks, single-action Step, zero-contact entry, and actual curves and Inspector at both Chrome/Edge viewports.
- [x] Five cold starts in one exclusive Worker give `Right 2` P95 of `1,716.5ms` (≤3s) and `Up 6 → Left 2 → Forward 3` P95 of `2,344.3ms` (≤10s). Tests limit player animation for both regressions to ≤5s; the reference program takes `1,443ms`, and the regression retains 3 visible Moves and at most 6 player primitives.
- [x] Plans serialize only compact primitives and contact events; dense certification samples do not enter the main thread or hardware protocol.
- [x] `CutterArmMotionProgramV1` is serializable and validated. ArmDock currently explicitly rejects V4; backend, Electron transmission, and firmware have not been enabled beyond authorization.

## Cutter Grid V4 Rust backend planning migration

### Phase 1 — Contracts, baselines, and failure tests

- [x] Frontend and backend branches `feat/cutter-grid-rust-planner-client` and `feat/cutter-grid-v4-rust-planner` were created from freshly fetched baselines; `main` was neither modified nor pushed.
- [x] Independent V4 `POST /api/v1/cutter-grid/plans` request/response, synchronized PTP, Profile, Plan, diagnostics, and `TRAJECTORY_PLANNING_FAILED` contracts are documented in frontend/backend schemas and specifications; the V2 verification-only contract remains compatible.
- [x] Failure errors preserve `plannerCode`, phase, source block, visible action, expanded action, and logical coordinates, and map to HTTP 422.
- [ ] Pin shared Rust/TS fixtures for the reference program, six directions, Right 2, Repeat/Wait, direct/single-avoidance PTP, the 500 limit, and every V4 failure phase.
- [ ] Once external workspace dependencies are available, run backend `cargo fmt --all -- --check`, clippy, workspace tests, planner-feature tests, and the service build. Do not substitute a fabricated local `arona` for the missing dependency.

Phase exit: P1 delivers only contracts and failure tests; it does not enable HTTP routes, frontend network calls, backend scoring, Session, Match, Versus, or ArmDock.

### Subsequent acceptance gates

- [ ] The frontend executes successful Rust plans only after validating versions, Challenge/Profile signatures, Program/action correspondence, and this implementation's trajectory signature.
- [ ] TypeScript fallback occurs only for network failures, a 30-second timeout, 429, or 5xx; 4xx, signature errors, and malformed responses must not trigger fallback.
- [ ] Rust/TS agree on actions, occurrences, source blocks, logical coordinates, entry IDs, primitives per Move, contacted voxels, remaining Hair, scores, and failure locations; numeric values satisfy the migration-plan tolerances.
- [ ] The reference program preserves `entry-06`, 22 logical commands, 5 Move primitives, 1,443ms, exactly 12 cells, zero collateral cuts, and 100 Completion. `Up 6 → Left 2 → Forward 3` takes the safe low-Wrist branch to `(-2,6,-3)`.
- [ ] Performance: Rust and end-to-end `Right 2` P95 ≤3s, global regression P95 ≤10s, and player animation ≤5s; Practice retains 1× default speed.
- [ ] Regressions confirm unchanged Servo, V2 read-only compatibility, Session, Match, Versus, Electron, firmware, and ArmDock behavior, with no build artifacts committed.

## Free macOS ad-hoc signing CI

- [x] Tagged and manual builds use free ad-hoc signing without an Apple account, paid membership, or secrets.
- [x] The main app and nested components are signed from the inside out with Hardened Runtime, Electron entitlements, and a local-network usage description; notarization and timestamps are disabled.
- [x] Before upload, applications for both architectures must pass complete signature, ad-hoc type, and application-identifier checks.
- [x] Document first-open approval, local-network permission, and optional local re-signing steps, explaining that ad-hoc signing provides no Apple notarization and permission identity may change with updates.
- [x] Locally validate workflow YAML, Bash, the custom hook, entitlements plist, and configuration schema. The actual arm64 package passes complete signature and Electron executable Node-mode startup checks. The user re-signing command preserves JIT/framework-loading permissions and passes the same checks. Packaging validation used local Electron 33.4.11; the GitHub download flow and x64 installer were not verified.
- [ ] Run the free-signing build on GitHub and verify x64 and arm64 artifacts.
- [ ] Install the new build, grant Local Network permission, and retry Test in the ARM panel. Signature checks are not evidence that a connection failure has been fixed.

## Audit security remediation (2026-10-13)

Governance status: the user specified **Human-Led**. Substantive AI-written security changes remain an uncommitted proposal for human authorship/adaptation. This repository has no `GOVERNANCE.md`, `POLICY.md`, or `CONTRIBUTING.md`; recorded scope owners and reviewers remain unverified. The items below record technical development evidence against that proposal, not governance approval or a formal FDS QA record. Formal Update Reports and QA records must be handwritten in ink without AI assistance; they are not drafted or completed here. No commit or merge is authorized by this checklist.

- [x] Security regressions were observed failing before fixes, then verified complete-plan rejection for Servo collisions/unsupported joints, actual one-decimal angles, and Stop after remount. No commands were sent to physical hardware.
- [x] Electron regressions cover refusing non-HTTPS OS launches, ignoring development URLs in packaged builds, sandbox configuration, denied permissions/trusted clipboard writes, a single application instance, Home/address exclusion while running, and renderer lifecycle events.
- [x] Loopback HTTP fixtures verify rejection of truncated responses, absolute deadlines for trickling responses, canonical decimal IPv4, and errors without response bodies. Sequencer regressions verify parking after in-flight requests finish, cancellation without waiting out the hold duration, refusing new runs during parking, and coalescing repeated shutdowns.
- [x] Regressions cover prototype-key crew IDs, root error recovery, identity clearing on withdrawal, fresh consent for a new player, withdrawal when storage writes fail, and preservation of optional consent choices.
- [x] Regressions cover non-finite geometry, invalid `headScale`, excessive remote-plan durations, bounded path sampling, Wait 0/two-primitive obstacle avoidance, route room codes, and removal of public tokens.
- [x] CI uses least privilege, checkout does not retain credentials, and external Actions are pinned to SHAs. The lockfile uses the official npm registry; the production dependency audit reports no vulnerabilities.
- [x] Chromium verified unobstructed menu controls in all 10 languages at 1280×720. The participation and error-recovery screens were also checked in English at that resolution; the New player action changes identity and optional sharing remains disabled when selected.
- [x] This proposal passes `npm run typecheck`, `npm run lint`, and `npm run build`; builder configuration and official-registry lockfile checks pass.
- [ ] Full `npm test`: tutorial-route setup exceeds its 10-second hook deadline, including at lower concurrency. The diagnostic isolated run passes with an explicit CLI hook override; no checked-in deadline was relaxed.
- [ ] Full `npm run test:e2e`: Grid submission exceeded its 30-second overall deadline. No full pass is claimed; acceptance appeared in the failure snapshot.
- [ ] Correct the proposed collision-clearance CPU regression under Human-Led: baseline 116–128ms versus candidate 391–400ms for 20,000 equivalent evaluations. Preserve malformed-input safety and rerun the complete gates; tracked in [#9](https://github.com/fds-pmine/HCR_Simulator_Frontend/issues/9). Historical checked gates below do not replace this round's results.
- [ ] Install and launch Electron 44.7.0 / electron-builder 26.15.3 builds on Windows, macOS, and Linux; verify macOS ad-hoc signing, physical local-network access, and actual sandbox/fuse behavior.
- [ ] Verify real servo/head calibration, the firmware path from an unknown physical pose to Home, behavior on disconnection/quit, and requirements for independent main-process safety validation.
- [ ] F4 negative backend tests for identity, host permissions, deadlines, and sealed results; session authorization expiry remains TBD.
- [ ] Review available patches and reachability for the eight remaining moderate `sprintf-js` findings in the build toolchain.

## Automated quality gates

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run test:e2e`
- [x] `npm run test:performance`: P95 across five cold starts in a single Worker passes the `3s/10s` gates.
- [x] `npm run cutter-grid:audit`: 114 safe cutting edges, 0 uncovered targets, and 0 missing directions.
- [x] `npm run cutter-grid:profile`: 2535 nodes, exactly 12 cells cut, and all six directions certified.
- [x] `npm run test:visual`: all 4 cases pass in actual Chrome/Edge at 1280×720 and 1920×1080.

## English runtime copy

- [x] User-visible copy in Challenges, Blockly, the workbench, logs, error/fallback screens, and accessibility labels is English, with automated coverage of key paths.
- [x] The Challenge uses `Neat Short Haircut`, the initial hairstyle uses `Thick Cap Initial Hairstyle`, and the target hairstyle uses `Symmetric Neat Crop`.
- [x] The five joints are displayed as `Base Yaw`, `Shoulder Roll`, `Shoulder`, `Elbow`, and `Wrist`, preserving internal Joint IDs, Blockly fields, and Program IR.

## P0 end-to-end flow

- [x] Local Challenges load through a Provider.
- [x] Blockly displays a preset editable program and compiles it to Program IR.
- [x] The Workspace contains exactly one top-level program stack; execution uses neither the JavaScript Generator nor `eval`.
- [x] The five-joint arm executes absolute angles and Wait in `baseYaw → shoulderRoll → shoulder → elbow → wrist` order.
- [x] Blockly and Inspector display the fifth joint dynamically from the Challenge.
- [x] The example program includes nonzero `shoulderRoll`, completes naturally and safely, and actually removes voxels.
- [x] When the end effector sweeps across Hair Voxels, the logical set and rendered view delete them together.
- [x] Run resets automatically; Reset restores hair, joints, metrics, and logs.
- [x] Stop preserves the scene without generating an official score.
- [x] Program completion outputs completion, efficiency, time, and final scores.
- [x] The example program's final Voxel IoU is at least 80%.

## Debugging experience

- [x] The camera supports orbiting, panning, and zooming.
- [x] Pause freezes the current command; Resume continues it.
- [x] Each Step completes only one atomic command.
- [x] The currently executing block is highlighted.
- [x] Logs record runs, commands, collisions, pauses, stops, completion, and errors.
- [x] The translucent target-hairstyle preview can be toggled.

## Errors and recovery

- [x] Empty programs, multiple top-level programs, invalid angles, and excessive expansion are refused with errors.
- [x] Invalid Wait, Repeat, and unknown-block data cannot enter the executor.
- [x] Provider failures and unavailable WebGL produce understandable error screens.
- [x] Stop does not generate an official score; Reset or Run remains available afterward.
- [x] Runtime errors preserve the scene, and Reset restores normal execution.
- [x] The base, all links, joints, and tool never commit a pose that enters the head.
- [x] A head-collision command stops at the last safe angle, remains incomplete, enters `error`, and generates no official score.
- [x] Collision logs identify the part, active joint, and safe angle while retaining source-block highlighting.

## Manual visual acceptance

- [x] Core controls are unobstructed in Chrome/Edge at 1280×720.
- [x] The layout does not stretch excessively in Chrome/Edge at 1920×1080.
- [x] The hierarchy of the main 3D view, Blockly, and metrics is clear.
- [x] The robot arm, current hair, target preview, grid, and cutter are easy to distinguish.
- [x] Cutter Grid single-cell Step clearly shows the synchronized five-joint pose, current/next coordinates, and executed/pending paths; collision revalidation protects the entire run.

These visual items use `tests/e2e/visualAcceptance.spec.ts` to generate four screenshots through actual Chrome/Edge channels and check viewports, overflow, and core controls. The screenshots were visually reviewed on 2026-08-13. They reside in ignored `test-results/`; build and acceptance artifacts are not committed.

## Versus round changes (2026-09-10)

Automated: `tests/unit/versusFlow.test.tsx`, `tests/unit/versusSeason.test.ts`,
`tests/unit/match.test.ts`, `tests/unit/programmingMode.test.ts` and
`tests/e2e/versusRoundModes.spec.ts`.

- [x] A rematch opens on an empty canvas. The editor's page-lifetime memory is keyed by Challenge
      signature and mode, so a round reopened on the same Challenge used to restore the previous
      round's finished program; `withFreshCanvas` drops every mode before the editor mounts.
- [x] Only the client that opened the room draws Start and Next round. Everybody else is told they are
      waiting for the host. This is a convention, not authority: the server has no host, and the room
      code remains the whole permission model.
- [x] Starting counts the room in for `ROUND_COUNTDOWN_MS` against `opensAt` on the server's clock, so
      every screen enters the round on the same second rather than on its own poll. An offline room
      grants those seconds (`closesAt = opensAt + countdown + duration`); online they are the first
      seconds of the round, because only the server may move a deadline.
- [x] The scoreboard can end the session, which crowns the leader of the points table — rounds, wins
      and best round included — rather than leaving the last round's scoreboard on the projector.
- [x] An offline room can be opened in Cutter Grid. The lobby states which editor the round uses, the
      workbench offers no switch, and a route can be planned, tested and entered.
- [x] Opening a Cutter Grid room on a Challenge with no certified Profile is refused at creation
      rather than at T0. An unpinned Cutter Grid room considers only Challenges that support the mode.
- [x] Online rounds offer Cutter Grid too, as of 2026-09-11: the entry is the lattice program alone
      (`SubmissionCreate.cutterGridV4`), the server plans it with its own certified Profile and scores its
      own sweep, and a round it cannot plan is refused when the room is opened. Verified live against
      `cargo run -p hcr --features hotaru --example serve`: a certified route submitted from the browser
      came back ranked 100.0 on the server's own standings.
- [x] A Cutter Grid entry carries no trajectory and no client score. Pinned at
      `tests/unit/httpProviders.test.ts`; the backend refuses a submission carrying both Cutter Grid
      shapes (`crates/hcr/tests/cutter_modes.rs`).
- [x] The workbench's Cutter Grid round notice states who computes the score, in the player's language.
      It was hardcoded English and said the backend could not replay, which stopped being true.
- [x] The closing stretch's red edge frames the stage rather than the HUD. `.hud` is centred with a
      transform, which made it the containing block for the `position: fixed` edge; folding the HUD down to
      its clock turned that into a red box around the clock. Drawn by the workbench now, from the same
      `urgent` flag the submit button wears.
- [x] Solo Practice asks which editor before opening a session, and a Cutter Grid session can be submitted
      into: the route travels, the trajectory does not, and online the server plans and scores it. An
      adaptive Cutter Grid session is built only from items this server holds a Profile for.

## Shuffled offline practice (2026-09-11)

- [x] Offline Solo Practice deals its nine items — the eight Servo lessons plus the authored
      Challenge — in a fresh random order per session, and still serves each exactly once before the
      session ends. The order is the only thing that changed: `kind` stays `'fixed'`, so no screen
      claims the sequence is adapting to the learner.
- [x] An offline round whose host pinned no Challenge draws one per round instead of always opening
      the head of the catalog, and the draw comes from a shuffled bag: consecutive rounds in one room
      can never repeat, and every Challenge gets a turn before any gets a second.
- [x] A host-pinned Challenge survives every rematch, unpinned Cutter Grid rooms redraw only among
      Challenges with a certified Profile, and a room's Challenge is still withheld until the round
      starts.

### Manual scenario F: an endless session, end to end

1. Host an offline round with Endless set to 10s, play two rounds and let the loop reopen the room.
2. Confirm round two opens with an empty Blockly canvas, not the program that won round one.
3. Confirm the count-in appears before the editor on every screen, and that a second browser joined by
   code sees "waiting for the host" instead of Start.
4. On the scoreboard, press End the session and confirm the champion is the points leader, which need
   not be the winner of the last round.
5. Press Next round from the champion screen and confirm the room reopens and the loop resumes.

### Manual scenario H: a Cutter Grid practice session

1. Open Solo Practice and confirm it asks which editor before anything is measured.
2. Pick Cutter Grid; confirm the workbench opens in it with no mode switch, and that the notice under the
   dock names who computes the score — this browser offline, the server online.
3. Build a route, press Test, then Submit; confirm the attempt is recorded and the next item is served.
4. Online, confirm every item served can actually be planned: a session must not offer an item whose
   submissions would fail.

### Manual scenario G: a Cutter Grid round

1. Host an offline round with the editor set to Cutter Grid; confirm the lobby names the editor.
2. Confirm the workbench opens in Cutter Grid with no mode switch, and that the Grid overlay is available.
3. Build a route, press Test, then Submit; confirm the entry is accepted and the round scores it.
4. Let the round close and confirm the scoreboard ranks the entry like any other.

## Key manual scenarios

### Scenario A: Complete run

1. Open the page and confirm that the local Challenge and example Workspace have loaded.
2. Record the initial voxel count and select Run.
3. Confirm that Blockly is locked, the current block is highlighted, and the arm starts moving.
4. Wait for natural completion and confirm that the voxel count decreases and the status is completed.
5. Confirm that all four scores are finite and Completion Score ≥80.

### Scenario B: Pause and Step

1. Select Run, then Pause while a joint is moving.
2. Confirm that joints, the end effector, command progress, and simulation time freeze.
3. Select Step and confirm that only the current/next atomic command completes before returning to paused.
4. Select Resume and confirm that the program continues and can complete naturally.

### Scenario C: Stop and Reset

1. Select Run, then Stop.
2. Confirm that the scene is preserved, no official result exists, and Blockly is editable again.
3. Select Reset and confirm that joint angles, the Hair Set, metrics, and logs return to their initial state.
4. Confirm that Reset does not clear the current Blockly content.

### Scenario D: Compilation errors

1. Create an empty Workspace, multiple top-level stacks, or an out-of-range angle.
2. Select Run.
3. Confirm that the arm does not move and the error identifies the cause or relevant block.
4. Fix the program and confirm that Run works again without refreshing the page.

### Scenario E: Head penetration prevention

1. Modify the example program into a joint sequence that would bring the wrist or a link into contact with the head.
2. Select Run and confirm that the mechanism stops at the last safe pose before first contact.
3. Confirm that the status is error, the dangerous command is incomplete, subsequent commands have not executed, and no official score exists.
4. Confirm that the error log identifies the collision part, active joint, and safe angle, and that the relevant Blockly block remains highlighted.
5. Select Reset or Run again and confirm that joints return to the Challenge's initial safe pose.
