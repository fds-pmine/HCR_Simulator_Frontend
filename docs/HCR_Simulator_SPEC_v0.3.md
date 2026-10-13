# HCR Simulator Frontend Demo Technical Design Specification (v0.3)

> Purpose: product definition, technical contracts, implementation boundaries, and acceptance criteria for the first executable Demo.
>
> Status: **the currently effective documentation baseline**. v0.2 is retained for historical traceability; v0.3 takes precedence in case of conflict.
>
> Current repository stage: **the Servo core execution loop, five joints and head penetration prevention, Cutter Grid first-release Phases 0–5, and compact synchronized PTP V4 Phases 1–6 have all passed acceptance**. The V2 global multibranch IK and V3 jerk-limited plans are retained as historical records predating their replacement by V4.
>
> Basis: v0.2, the decisions confirmed in plan mode on 2026-07-30, and subsequent scope clarifications.

---

## 1. One-sentence definition

HCR Simulator is a Web 3D programming Demo that runs entirely in the frontend: users arrange absolute joint-angle commands with real servo semantics in Blockly to drive a procedural five-joint robot arm in R3F / Three.js; the end effector removes Hair Voxels as it sweeps through them, deterministic geometric constraints prevent the entire mechanism from entering the head, and the system computes a weighted score from target-hairstyle Voxel IoU, program efficiency, and deterministically estimated time.

## 2. Goals, audience, and success criteria

### 2.1 Target audience

The first release serves internal engineering and product teams to validate:

- The Blockly → Program IR → Runtime Command programming pipeline;
- Joint commands → forward kinematics → procedural robot-arm motion;
- End-effector sweep detection → Hair Voxel state removal;
- Current hairstyle → Target Hairstyle → independent scoring service;
- A deterministic execution loop that supports pausing, stepping, and observation;
- The ability to replace the Local Provider with an HTTP Provider in the future.

### 2.2 Success criteria

- The complete workflow runs without a backend, network, or real hardware.
- The preset example program reliably removes voxels and achieves a Completion Score of at least 80 after natural completion.
- The same Challenge and program produce the same command count, estimated duration, and score on different devices.
- Blockly, simulation, 3D, voxels, scoring, and data Providers have clear boundaries and can be tested independently.
- Core operations are usable in Chrome / Edge at 1280×720 and 1920×1080.

## 3. First-release scope

### 3.1 Required implementation

- A React + TypeScript + Vite single-page application.
- React Three Fiber, Three.js, and OrbitControls.
- One local `Neat Short Haircut` Challenge with the hairstyle progression `Thick Cap Initial Hairstyle → Symmetric Neat Crop`.
- A procedural head, Hair Voxels, and five-joint robot arm.
- Geometric head penetration prevention, rollback to the last safe pose, and collision-error localization.
- Blockly absolute-angle, Wait, and Repeat blocks.
- Program IR compilation, validation, loop expansion, and sequential execution.
- Run, Pause, Resume, Step, Stop, and Reset.
- Highlighting of the executing block, joint/end-effector state, metrics, and event logs.
- Continuous end-effector swept-contact detection and Hair Voxel removal.
- Completion, Efficiency, Time, and Final Score.
- ChallengeProvider, ScoreProvider, and Local implementations.
- Core Vitest unit tests and key Playwright E2E tests.
- All user-visible runtime text in English, including Challenge data, Blockly, the workbench, logs, errors, and accessibility labels.
- An optional `Cutter Grid` frontend mode: players control the end-effector sphere in six directions along fixed world axes with integer grid distances; before execution, the system uses deterministic IK to generate a frozen synchronized five-joint trajectory.

### 3.2 Explicit exclusions

- Accounts, databases, workspace persistence, import/export, and backend features other than the Cutter Grid V4 Practice planning endpoint.
- Actual HTTP API calls or networking as a runtime prerequisite.
- ESP, real servos, MQTT, PWM, WebSerial, or WebBluetooth.
- General arbitrary Cartesian Move, runtime IK, or concurrent movement of multiple servos in Servo mode. Cutter Grid allows only the fixed-axis single-cell movement, compile-time IK, and frozen synchronized trajectories defined in Section 15.
- Relative-angle, conditional, sensor, variable, or custom-function blocks.
- A physics engine, collision bounce/friction/sliding, robot-arm self-collision, realistic hair strands, or scissor opening/closing.
- External GLB / FBX robot-arm or hair assets.
- Multiple Challenges, multiplayer competitions, dedicated mobile support, or production deployment.

## 4. Technology stack and layers

### 4.1 Technology stack

| Layer | Technology | Responsibility |
|---|---|---|
| Application | React + TypeScript | Pages, components, Provider injection, and low-frequency state |
| Build | Vite | Development server, production builds, and environment configuration |
| 3D | R3F + Three.js + Drei | Scene, camera, lights, models, and OrbitControls |
| Visual programming | Blockly | Workspace, custom blocks, and structured serialization |
| Low-frequency state | Zustand | Execution status, Hair Set, metrics, logs, and UI toggles |
| Testing | Vitest + Playwright | Domain unit tests, compilation tests, and E2E tests for the core execution loop |

### 4.2 Data flow

```text
React Workbench
  ├── BlocklyEditor
  │       ↓
  │   ProgramCompiler
  │       ↓
  │   Program IR
  │
  ├── Simulation Controls
  │       ↓
  │   SimulationEngine
  │     ├── ProgramExecutor
  │     ├── RobotController / Forward Kinematics
  │     └── Swept Contact Detection
  │               ↓
  │          Hair Voxel State
  │
  ├── SimulatorCanvas ← engine snapshot / refs
  └── Inspector / Logs / Result
                  ↓
             ScoreProvider
```

### 4.3 Mandatory boundaries

- Blockly may produce only Program IR; it must not directly manipulate Mesh, Robot Controller, Hair State, or scoring.
- 3D components only read simulation state and render it; they must not implement scoring or business rules.
- UI controls call the simulation engine's public methods; they must not directly change joint refs or remove voxels.
- High-frequency data at 60 FPS, such as joint interpolation and end-effector positions, remain in engine/controller instances; React/Zustand receive only low-frequency snapshots and discrete events.
- Challenge and Score must be injected through interfaces; components must not directly import internal Local Provider data.
- All angles, speeds, dimensions, limits, color semantics, and scoring parameters are defined centrally; components must not contain scattered magic numbers.

## 5. Domain model and serialization boundaries

### 5.1 Common types

```ts
export type JointId = string;
export type VoxelKey = `${number},${number},${number}`;
export type Axis = 'x' | 'y' | 'z';
export type Vec3Tuple = readonly [number, number, number];
export type AllowedBlockType =
  | 'set-joint-angle'
  | 'wait'
  | 'repeat';

export interface VoxelCoord {
  x: number;
  y: number;
  z: number;
}
```

`VoxelKey` is generated from integer grid coordinates in `x,y,z` form. Production and test code must share the same `coordToKey` / `keyToCoord` pure functions.

### 5.2 Robot-arm configuration

```ts
export interface JointConfig {
  id: JointId;
  name: string;
  axis: Axis;
  minAngleDeg: number;
  maxAngleDeg: number;
  /** Initial command shared by Home, Challenge, and Reset; fixed at 90° when a servo mapping exists. */
  initialAngleDeg: number;
  speedDegPerSec: number;
}

export interface RobotGeometryConfig {
  basePosition: Vec3Tuple;
  shoulderHeight: number;
  upperArmLength: number;
  forearmLength: number;
  toolLength: number;
  toolRadius: number;
  collision: RobotCollisionConfig;
}

export interface RobotCollisionConfig {
  linkRadius: number;
  jointRadius: number;
  toolShaftRadius: number;
  headClearance: number;
}

export interface RobotState {
  joints: Record<JointId, number>;
}
```

The UI must dynamically generate joint names, angle ranges, and metric rows from `JointConfig[]`; it must not assume the array length. `JointConfig.name` is English runtime display text; internal IDs and display names must remain separate.

### 5.3 Serializable Challenge Definition

```ts
export interface HairstyleDefinition {
  id: string;
  name: string;
  voxels: VoxelCoord[];
}

export interface ChallengeDefinition {
  id: string;
  name: string;
  description: string;
  robotConfig: {
    joints: JointConfig[];
    geometry: RobotGeometryConfig;
  };
  voxelConfig: {
    origin: Vec3Tuple;
    size: number;
    headCenter: Vec3Tuple;
    headScale: Vec3Tuple;
  };
  initialHair: HairstyleDefinition;
  targetHair: HairstyleDefinition;
  allowedBlocks: AllowedBlockType[];
  starterWorkspace: Record<string, unknown>;
  scoring: ScoringConfig;
}
```

### 5.4 Runtime Challenge

The Local Challenge Provider validates the Definition and normalizes coordinate arrays into runtime sets:

```ts
export interface HairstyleTarget {
  id: string;
  name: string;
  voxels: ReadonlySet<VoxelKey>;
}

export interface Challenge
  extends Omit<ChallengeDefinition, 'initialHair' | 'targetHair'> {
  initialHair: HairstyleTarget;
  targetHair: HairstyleTarget;
}
```

The Provider must return independent sets so that callers cannot modify shared data. Reset creates a new `Set` from the Challenge's initial set.

## 6. Default Challenge

The default runtime display names are fixed as follows; these English strings are part of the Challenge's user-visible data contract:

| Object | English display name |
|---|---|
| Challenge | `Neat Short Haircut` |
| Initial hairstyle | `Thick Cap Initial Hairstyle` |
| Target hairstyle | `Neat Crown Trim` |

### 6.1 Robot arm

| ID | Display name | Servo axis | Command range | Shared initial/Home | Speed |
|---|---|---|---:|---:|---:|
| `baseYaw` | `Base Yaw` | X | 30°～150° | 90° | 60°/s |
| `shoulderRoll` | `Shoulder Roll` | None (simulation only) | -45°～45° | 0° | 45°/s |
| `shoulder` | `Shoulder` | Y | 30°～150° | 90° | 45°/s |
| `elbow` | `Elbow` | Z | 17.5°～162.5° | 90° | 60°/s |
| `wrist` | `Wrist` | B | 0°～180° | 90° | 75°/s |

The firmware's E axis is not included in first-release scissor opening/closing simulation; its range is 45°～100° and its initial/Home value is also 90°. Challenge, Reset, Lesson, and Electron connections all start from the same X/Y/Z/B/E state with every axis at 90°; the safe geometric pose is calibrated through servo offsets, and a second hidden starting pose is forbidden. The Inspector's Servo Angles panel must map the current simulated joints to absolute X/Y/Z/B servo angles in real time; E is explicitly displayed as parked 90° in the first release. The Electron ARM panel displays the device's actual reported values.

The first-release joints form a nested chain in the order `baseYaw → shoulderRoll → shoulder → elbow → wrist`. The complete rotation order is `Ry(baseYaw) × Rx(shoulderRoll) × Rz(shoulder/elbow/wrist)`; `shoulderRoll = 0°` is compatible with the original four-joint planar pose. All commands drive only one joint at a time.

Recommended default geometry parameters:

| Parameter | Value |
|---|---:|
| Shoulder Height | 0.40 |
| Upper Arm Length | 1.05 |
| Forearm Length | 0.90 |
| Tool Length | 0.35 |
| Tool Collision Radius | 0.12 |
| Link Collision Radius | 0.075 |
| Joint Collision Radius | 0.18 |
| Tool Shaft Collision Radius | 0.075 |
| Head Clearance | 0.02 |

These values belong to Challenge configuration rather than robot-arm component constants. During implementation, geometry positions may be adjusted slightly to satisfy example-program acceptance, but this file, Challenge data, and tests must be updated together.

### 6.2 Head and hairstyle

- The head uses uncuttable rounded low-poly geometry, with visuals separate from Hair Voxels.
- Default Voxel Size is 0.16.
- The target short hairstyle is generated by a deterministic pure function, is bilaterally symmetric overall, and is nonempty.
- The initial thick-cap hairstyle must strictly contain all Target Voxels, plus outer/edge voxels that the example program can sweep through.
- Random generation is forbidden; identical configuration must produce the same coordinate order and set.
- Generator tests must assert `target ⊂ initial`, no duplicate coordinates, bilateral symmetry, and fixed voxel counts.

### 6.3 Example program

- Deserialize an editable Blockly Workspace on first load.
- The program uses absolute joint angles and may include Wait and Repeat to validate nested IR.
- The program includes at least one nonzero `shoulderRoll` command and completes naturally with head-safety validation over its entire path.
- The Completion Score after natural program completion must be at least 80.
- The example program should leave room for optimization; a score of 100 is not required.
- The example workspace belongs to Challenge data and is not embedded in the BlocklyEditor component.
- The current calibrated program contains 5 source blocks/atomic commands, uses `shoulderRoll = 15°`, and has a reference program cost of 6.25 and reference time of 5645ms.

## 7. Blockly and Program IR

### 7.1 Allowed blocks

| Type | UI semantics | Compilation result | Constraints |
|---|---|---|---|
| `set-joint-angle` | English block: set the selected Joint to an absolute Angle | Robot Command | Joint comes from the Challenge; Angle must be within range |
| `wait` | English block: wait for the specified milliseconds | Robot Command | 0～5000ms |
| `repeat` | English block: repeat the contained statements | Program Node | 1～20 times |

Blockly block fields, toolbox categories, and tooltips all use English; Blockly's built-in shadow numbers do not count toward Source Block Count.

### 7.2 Program IR

```ts
export type RobotCommand =
  | {
      type: 'set-joint-angle';
      jointId: JointId;
      angleDeg: number;
      sourceBlockId: string;
    }
  | {
      type: 'wait';
      durationMs: number;
      sourceBlockId: string;
    };

export type ProgramNode =
  | RobotCommand
  | {
      type: 'repeat';
      count: number;
      body: ProgramNode[];
      sourceBlockId: string;
    };

export interface Program {
  nodes: ProgramNode[];
  sourceBlockCount: number;
}
```

Do not use the Blockly JavaScript Generator, `eval`, or dynamic code execution to run programs.

### 7.3 Compilation rules

- The workspace must contain exactly one enabled top-level program stack.
- Empty workspaces, multiple top-level stacks, unknown/disabled block types, and empty Repeat Bodies are compilation errors.
- Joint IDs must exist in the current Challenge; angles must not be silently clamped.
- Wait and Repeat fields must be finite numbers satisfying their constraints.
- Repeat is expanded into a Runtime Command list before execution; the expanded limit is 500.
- `sourceBlockCount` counts all enabled, non-shadow source blocks, including Repeat.
- `executedCommandCount` equals the expanded number of atomic commands; Repeat itself is not counted.
- Runtime Commands retain the original `sourceBlockId` for highlighting and log localization.

## 8. Simulation engine and execution state machine

### 8.1 States

```ts
export type SimulationStatus =
  | 'loading'
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'error';
```

### 8.2 Control semantics

| Operation | Allowed states | Behavior |
|---|---|---|
| Run | idle/completed/stopped/error | Reset simulation, recompile, and execute continuously from the first command |
| Pause | running | Freeze current command progress and simulation time |
| Resume | paused | Continue from the frozen position |
| Step | idle/paused | Reset and compile first when idle; fully execute one atomic command, then return to paused |
| Stop | running/paused | Stop execution and retain the current state without generating an official score |
| Reset | Any except loading | Restore the initial arm, hair, metrics, and logs while retaining Blockly content |

Blockly is read-only while running or paused. Natural program completion changes the status to completed and calls the Score Provider. Reaching the target hairstyle does not end the program early; subsequent commands may still remove hair incorrectly.

### 8.3 Joint commands

- Joint angles use linear interpolation at `speedDegPerSec`, without easing.
- Command duration is `abs(targetAngle - currentAngle) / speedDegPerSec`.
- A command whose target equals the current angle has duration 0, but still counts toward Executed Command Count and is logged.
- Wait does not move the robot arm or trigger stationary contact detection.
- The engine's `tick(deltaMs)` advances high-frequency interpolation; Pause does not advance effective time.
- Head-safety constraints are checked in substeps of at most 0.5° for each active joint; after the first collision, perform 12 binary-search iterations and commit the last safe angle.
- A colliding command does not count toward Executed Command Count; subsequent commands are not executed, the status becomes `error`, and no official score is generated.
- Collision errors retain Hair, joints, provisional metrics, and the current source-block location; Reset or a new Run restores the Challenge's initial safe pose.

### 8.4 Deterministically estimated duration

Before execution, simulate all Runtime Commands sequentially from the Challenge's initial joint state:

```text
SetJointDurationMs =
  abs(targetAngle - simulatedCurrentAngle)
  / speedDegPerSec
  × 1000

EstimatedDurationMs =
  Σ SetJointDurationMs + Σ WaitDurationMs
```

This value is used for Time Score. Actual wall-clock time, frame rate, pauses, and time spent stopped during stepping are excluded.

## 9. Kinematics, contact, and Hair State

### 9.1 Forward kinematics

- World coordinates use Y Up.
- Base Yaw rotates around Y, Shoulder Roll around local X, and Shoulder / Elbow / Wrist around their respective local Z axes.
- The rotation chain is fixed as `Ry(baseYaw) × Rx(shoulderRoll) × Rz(shoulder) × Rz(elbow) × Rz(wrist)`; subsequent joints use their parent's accumulated rotation.
- Each joint's transform order must match the nested R3F Groups.
- Provide the pure function `computeRobotPose(config, jointAngles)`, returning world coordinates for each joint and the end effector, shared by controllers, collision checks, and tests.
- Reading positions back from the Three.js Scene Graph as the sole source of domain truth is forbidden.

### 9.2 Head penetration prevention

- The head's logical collider is an impenetrable ellipsoid defined by `headCenter/headScale`; Hair Voxels are removable, and Target Ghost does not participate in collision.
- The base, upper arm, forearm, and tool shaft use capsule approximations consisting of a segment plus a radius; joints and the end effector use spheres represented by degenerate segments.
- During detection, transform the capsule segment into the unit space of the ellipsoid expanded by “part radius + Head Clearance” and compute the closest distance from the segment to the origin.
- The initial pose must be validated for safety when loading a Challenge; the Provider rejects invalid initial configurations.
- Do not implement bounce, friction, sliding, automatic obstacle avoidance, robot-arm self-collision, or rigid-body dynamics.

### 9.3 Continuous swept contact

For each effective motion tick:

1. Save the previous end-effector world position;
2. Advance the joint angles;
3. Compute the new end-effector world position;
4. Form a segment between the two points;
5. Test the current Hair Set for overlap with a sphere swept along that segment;
6. Remove all hit voxels at once and record one collision event.

Sphere–Voxel AABB overlap should use deterministic geometric functions. The stationary initial pose, Wait, and camera-only operations do not cut hair. Removed voxels are not counted or logged again.

### 9.4 Hair State

- Runtime Hair State is a `Set<VoxelKey>`.
- Removal returns a new set or is performed through a controlled Store action.
- The rendering layer displays current voxels from the Hair Set; the target preview uses a separate read-only set.
- The target preview is translucent and cool-colored; it is excluded from collision, current voxel counts, and scoring input.

## 10. Scoring contract

### 10.1 Types

```ts
export interface ProgramMetrics {
  sourceBlockCount: number;
  executedCommandCount: number;
  estimatedDurationMs: number;
}

export interface ScoringConfig {
  weights: {
    completion: number;
    efficiency: number;
    time: number;
  };
  referenceProgramCost: number;
  referenceTimeMs: number;
  commandWeight: number;
}

export interface ScoreResult {
  completionScore: number;
  efficiencyScore: number;
  timeScore: number;
  finalScore: number;
  programCost: number;
}

export interface ScoreInput {
  targetVoxels: ReadonlySet<VoxelKey>;
  resultVoxels: ReadonlySet<VoxelKey>;
  programMetrics: ProgramMetrics;
  scoring: ScoringConfig;
}
```

### 10.2 Formulas

```text
CompletionScore =
  |Target ∩ Result| / |Target ∪ Result| × 100

ProgramCost =
  SourceBlockCount
  + CommandWeight × ExecutedCommandCount

EfficiencyScore =
  min(100, ReferenceProgramCost / ProgramCost × 100)

TimeScore =
  min(100, ReferenceTimeMs / EstimatedDurationMs × 100)

FinalScore =
  0.60 × CompletionScore
  + 0.25 × EfficiencyScore
  + 0.15 × TimeScore
```

The default is `commandWeight = 0.25`. Reference cost and reference time are fixed in the Challenge after calibrating the example program.

### 10.3 Boundary rules

- Clamp all component scores and Final Score to 0～100.
- Retain full precision internally; display one decimal place in the UI.
- Completion is 100 when both `Target` and `Result` are empty, and 0 when only one is empty.
- When ProgramCost or EstimatedDuration is 0, the corresponding component score is 100; empty programs are still rejected during compilation.
- The Score Provider must validate that the weights sum to approximately 1 and return an explanatory error for invalid configuration.
- Stop does not invoke official scoring; the right panel may show real-time Completion marked “provisional”.

## 11. Provider boundaries

```ts
export interface ChallengeSummary {
  id: string;
  name: string;
  description: string;
}

export interface ChallengeProvider {
  listChallenges(): Promise<ChallengeSummary[]>;
  getChallenge(id: string): Promise<Challenge>;
}

export interface ScoreProvider {
  score(input: ScoreInput): Promise<ScoreResult>;
}
```

The first release provides only `LocalChallengeProvider` and `LocalScoreProvider`. The application composition root injects Providers; other components depend only on interfaces. HTTP implementations may be added later, but this version creates no network requests.

Reserved API directions, not implemented:

```text
GET  /api/challenges
GET  /api/challenges/:id
POST /api/score
POST /api/simulations
```

## 12. Workbench and interaction

### 12.1 Layout

- A single-page, full-viewport, dark technical workbench.
- Top bar: product name, current Challenge, and connection status “LOCAL”.
- Center: 3D Canvas with the highest visual prominence.
- Left: a collapsible Blockly panel, approximately 400～440px wide and expanded by default.
- Right: a Challenge, joint, metrics, and results panel, approximately 300～340px wide.
- Bottom: Run / Pause / Resume / Step / Stop / Reset toolbar.
- Logs use an expandable bottom drawer, displaying a recent-event summary by default.
- All buttons, panel titles, statuses, metrics, tooltips, empty states, and accessibility text such as `aria-label` / `title` use English; translation does not change types, APIs, internal IDs, or serialized fields.

At 1280×720, panels may overlay Canvas edges but must not obscure the core execution controls. Below the target width, the right panel may collapse; mobile usability is not promised.

### 12.2 3D scene

- The procedural robot arm uses industrial gray/blue; active joints use an accent color.
- Current Hair uses warm-colored opaque cubes; Target Ghost uses cool-colored translucent cubes.
- The end-effector tool and collision range should be distinguishable, without displaying real scissors.
- Provide ambient light, directional light, a ground grid, and soft shadows.
- OrbitControls supports rotation, zoom, and pan, with reasonable distance and polar-angle limits.

### 12.3 Information and results

The right panel displays at least:

- Current status;
- Current angles of all five joints;
- End-effector X/Y/Z;
- Current/initial/target voxel counts;
- Source Block Count;
- Executed Command Count;
- Estimated Duration;
- Completion / Efficiency / Time / Final Score.

The official score area shows placeholders before program completion; after Stop, provisional metrics must not be presented as final scores.

## 13. Logs and errors

### 13.1 Log events

Logs cover at least:

- Challenge loading and Reset;
- Compilation success/failure;
- Run, Pause, Resume, Step, Stop;
- Start and end of each Runtime Command;
- Number of voxels removed through collision;
- Program completion and scoring results;
- Provider, WebGL, or engine errors.

Logs use incrementing sequence numbers or simulation time, rather than wall-clock time, for deterministic ordering. Retain only the latest 200 entries to avoid unbounded growth.
All user-visible log messages use English; stable state values, part IDs, and Source Block IDs may remain as technical identifiers.

### 13.2 User-visible errors

- Challenge loading failure: show an error panel and retry button.
- WebGL unavailable: explain browser capabilities instead of rendering a blank Canvas.
- Compilation failure: retain the workspace, show the error in the panel, and select/highlight the relevant block where possible.
- Runtime error: enter the error state, retain the current state, and allow Reset or a new Run.
- Head collision: log the colliding part, active joint, safe angle, and source block; retain the Blockly highlight and restore editing.
- Invalid Challenge configuration: the Local Provider rejects it and reports the field location.

All error titles, explanations, retry/recovery actions, and WebGL fallback text above use English; translating only the normal workflow while leaving Chinese errors or accessibility text is forbidden.

## 14. Testing and acceptance

### 14.1 Vitest

- Voxel key conversion and hairstyle-generator invariants.
- IoU, efficiency, time, and final-score boundaries.
- Known five-joint forward-kinematics poses, verifying the compatible pose at `shoulderRoll = 0°` and nonzero three-dimensional lateral tilt.
- Outside, tangent, and penetrating cases for the expanded ellipsoid, capsule crossings, joint spheres, and safety clearances.
- Collision-safety boundaries for large/small frames, noncompletion of colliding commands, absence of official scoring, and Reset recovery.
- Sphere Sweep–Voxel AABB hits, misses, endpoints, and multiple hits.
- Blockly compilation, Source Block Count, nested Repeat, and the 500-command limit.
- Angle, Wait, Repeat, empty-program, and multiple-top-level-program validation.
- Sequential joint-state updates during time estimation.
- Normal and failure paths for Local Challenge / Score Providers.
- Simulation state-machine Run, Pause, Step, Stop, Reset, and Complete.

### 14.2 Playwright

Key execution loop:

1. The page loads a local Challenge and preset Workspace;
2. Canvas, robot arm, Hair Voxels, and core controls are present;
3. Run automatically resets and locks Blockly;
4. Pause freezes metrics, Step completes one command, and Resume continues;
5. Voxel count decreases after program completion and the status is completed;
6. The fifth joint is visible in Blockly and Inspector, the safe example achieves Completion Score ≥80, and all four scores are visible and finite;
7. Reset restores initial voxels/joints and clears official results;
8. A program deliberately targeting the head stops at a safe pose, enters error, locates the source block, and displays no official score;
9. Empty programs or invalid data display errors without starting execution.
10. Challenge/hairstyle/joint names, Blockly, the workbench, logs, errors, and accessibility labels all display English, with key terms matching this specification.

### 14.3 Quality gates

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

See `docs/ACCEPTANCE.md` for manual acceptance.

## 15. Optional Cutter Grid control mode

### 15.1 Scope and isolation

- The mode ID is `cutter-grid` and the display name is `Cutter Grid`; `servo` remains the default mode.
- The initial phase opens only Practice and dedicated Lessons. Versus, backend Session/Program submission, remote scoring, and the Electron Arm Bridge remain Servo-only.
- Amended 2026-09-10: an **offline** Versus room may be opened in `cutter-grid`. The round declares one
  editor for everybody (`MatchConfig.programmingMode`, mirroring `hcr_contract::round::MatchConfig`), the
  room refuses to open on a Challenge with no certified Profile, and the browser plans and scores the
  route exactly as Practice does. Nothing is sent: online Versus, backend Session/Program submission,
  remote scoring and the Electron Arm Bridge stay Servo-only until the backend opens V4 planning to
  submissions (`hcr-backend/docs/08-CUTTER-GRID.md` §0). A round is never mixed-mode, because Servo and
  Cutter Grid are different exercises on the same Challenge and §15.1 forbids comparing their scores.
- Servo and Cutter Grid use separate in-memory Workspaces; switching is allowed only in `idle`, resets simulation, and retains both sets of blocks.
- Cutter Grid shares the default Challenge's initial Hair, 12 target voxels to remove, and existing scoring configuration, but its scores are not compared with Servo scores for fairness.
- Challenges without a matching certified Profile must remain Servo-only.

### 15.2 Coordinates and Blockly

- Grid spacing equals `voxelConfig.size`; bounds extend the initial Hair coordinate bounding box by two cells along each axis and include the certified starting point.
- The fixed mapping is Right `+X`, Left `-X`, Up `+Y`, Down `-Y`, Forward `-Z`, and Backward `+Z`; it does not change with the camera or tool orientation.
- Each of the six Move blocks accepts an integer distance of `1–12`. Expansion still counts single-cell moves and Wait toward the 500 limit and command cost, but the V4 planner merges one visible Move N into a continuous leaf action; Wait and Repeat retain their respective `0–5000ms` and `1–20` limits.
- The cutter is always enabled, removing all contacted Hair along the actual end-effector trajectory using the existing `toolRadius = 0.12`; the system neither avoids hair nor removes only whitelisted voxels, and it does not silently shorten moves.
- V4 Step executes one expanded visible Move or Wait at a time; Move N continuously completes N cells in one action and still contributes N to `executedCommandCount`. V3 single-cell Step remains only a historical regression baseline.

### 15.3 Entry, planning, and trajectories

- Move from the initial Servo pose to the nearest certified cell center with zero hair contact; the current preferred Hair lattice point is `(0,-5,8)`. Entry uses the `positioning` state and does not cut hair or count toward time or score.
- Before Run/Test/Step, enter `planning` and solve the entire program in a cancellable Web Worker. Identical normalized input produces only one frozen plan; the three entry points must not solve separately or replan at runtime.
- V4 treats only the certified entry and the final cell center of each visible Move as hard IK targets; endpoint error must not exceed `voxelSize/16`. Intermediate end-effector paths may be certified curves; per-cell straight lines along world axes are no longer required.
- Each Move generates one synchronized five-joint PTP primitive by default, with at most two. If a direct PTP collides with the head, only one certified obstacle-avoidance configuration is allowed; the entire plan fails if it cannot be compressed to two primitives.
- Any failure in joint limits, IK, head collision, dynamic limits, workspace, or contact certification locates the first source block and rejects the entire program before execution; executing a feasible prefix is forbidden.

### 15.3.1 Global multibranch IK repair (V2, historical baseline for V4)

V4 continues to require the entry and entire program to jointly select a continuous collision-free configuration chain, but replaces V2 per-cell Cartesian layers, default `24 → 96 → 384` enumeration, and dense edge certification with visible Move endpoint layers, a smaller fixed candidate budget, and compact PTP edges. This section is retained only to explain V2's known incorrect branches and historical fixtures.

- The initial `cutter-grid-dls-v1` greedy selection of a single predecessor configuration and static `reachable` node prefilter are known to incorrectly reject `Up 6 → Left 2 → Forward 3`: at the third quarter-layer of the end-effector path at `(-2,6,-3)`, a collision-free low-Wrist solution exists, but the local high-Wrist branch reaches a dead end earlier. The static existence of an IK solution no longer implies reachability from every entry pose along every program path.
- The new version is `cutter-grid-ladder-v2`. In the Worker it retains multiple collision-free IK candidates for each Cartesian layer and uses program-compatible certified entries as graph layer 0, selecting a continuous configuration chain across the entire path; ROS, MoveIt, Tesseract, backend, or any external planning service must not be integrated.
- V2 must cumulatively enumerate deterministic Halton seeds at `24 → 96 → 384`, deduplicate candidates by `0.01` normalized joint distance, and retain at most 128 per layer using deterministic farthest-point sampling. Internal candidates are not quantized; the actual execution plan is quantized only after final validation.
- V2 must not remove branches using a fixed normalized joint-jump threshold. Adjacent candidates are assessed only by joint limits, head collision, end-effector axial path deviation, and sampling continuity under actual smooth interpolation; tangents are zero at turns, Wait, and program endpoints.
- The V2 Profile stores up to 32 safe origin configurations and their respective certified zero-contact entry trajectories. Run, Test, and the first Step from idle jointly plan all entries and the full player path; entry belongs to the frozen plan and does not cut hair or count toward commands, player duration, or score.
- V2 distinguishes static `Safe IK known` / `No safe IK found` from current `Program connected` / `Program disconnected`. Missing candidates, incompatible entries, missing continuous edges, and exhaustion of the finite search budget must be reported separately; search exhaustion must not be described as physical unreachability.

### 15.3.2 Jerk-limited motion stability experiment (V3, historical baseline)

V4 has replaced V3's fixed Cartesian tube, per-cell pause-safe checkpoints, `1.25x` speed request, per-cell 5ms certification, and original exact-contact-set constraint. This section is retained only to explain existing fixtures, the Ruckig Spike, and regression evidence; its straight-line, per-cell-stop, and dense-waypoint provisions must not be treated as V4 implementation requirements.

- V3 preserves V2's selected collision-free IK configuration chain and the player's specified Cartesian axial path; retiming, smoothing, and rendered playback must not reselect IK branches, shorten distances, take shortcuts, or alter the swept-contact set.
- V3 first performs deterministic frontend experiments using pure domain functions. All planning inputs, outputs, diagnostics, signatures, and errors must be serializable and independent of the DOM, Worker, or render clock; after frontend regression validation, the same domain contract migrates to Rust `hcr_sim`, making the backend the final path-planning authority.
- Without affecting frozen plans, signatures, or candidate ordering, the V3 Worker reports versioned V2 graph-search stages and the `geometric-smoothing`, `time-parameterization`, `jerk-smoothing`, and `playback-validation` stages. The first four stages count Cartesian layers; the latter four count actual motion segments (system entry plus player Moves), allowing the UI to locate the type of computation in which instability occurs.
- The V3 Profile adds explicit simulation speed, acceleration, and jerk hard limits for each joint; a missing limit fails closed. The current frontend experiment retains the `1.25x` speed request but limits acceleration/jerk to `1250x`/`200000x` the rated speed to prevent abrupt short-cell motion within fewer than approximately five `60Hz` render frames; these values, actual ratios, and complete trajectory signatures are reviewable. V3 plans store continuous internal angles, knot `q/v/a` of a global C2 quintic geometric spline, a dynamic-limit signature, actual speed ratio, segment parameters sampleable at absolute time, pause-safe atomic checkpoints, and a complete trajectory signature. System zero-contact entry and player segments use the same V3 dynamic limits and time law; playback with V2 interpolation is forbidden.
- Every atomic-move boundary, logical corner, both sides of Wait, entry start/end, and program endpoint must be a pause-safe checkpoint with zero velocity and zero acceleration. This prevents velocity or acceleration steps during continuous Run/Test playback and Step stops/resumes.
- The fixed joint geometric path first undergoes deterministic velocity/acceleration-limited retiming, followed by local segment-by-segment state-to-state jerk smoothing to generate a C2 trajectory. After smoothing, joint limits, head collision, the Cartesian tube, and contact sets must be revalidated at a combined resolution no coarser than `5ms`, `0.5°`, and `voxelSize/16`; any failure fails closed.
- If the global minimum-jerk quintic spline overshoots joint limits between existing safe knots, preserve the same knot sequence and switch to a deterministic monotone C2 constrained solution visible in the signature; relaxing limits, shortening the player's path, or reverting to V2 C1 interpolation is forbidden. If that constrained solution still fails Cartesian, collision, or contact audits, planning continues to fail closed.
- Only local implementations or pinned-version local WASM calls in the Worker are allowed. The Ruckig Community intermediate-waypoint cloud API, ROS, MoveIt, Tesseract, and any external path-planning service are forbidden.
- The current local WASM feasibility gate pins Ruckig Community `v0.19.4` (MIT) and Emscripten `4.0.20`, exposes only a five-joint offline state-to-state `q/v/a` ABI, excludes the cloud client from the build, and audits endpoints and local requests through Chromium/Edge Worker tests. It is an independent Spike only and must not enter runtime planning before continuous boundary states on the fixed path and full collision/contact regression are complete.
- The frontend pure-domain preparation layer already performs conservative TOPP-RA-style velocity/acceleration forward/backward reachability propagation on fixed C2 geometry and outputs deterministic path speed and `q/v/a` boundaries; atomic starts and ends retain zero velocity/zero acceleration. It changes neither geometry nor contact and is not a runtime trajectory source until connected to local Ruckig and the full validator.
- The frontend pure-domain Ruckig segment orchestrator already uses adjacent TOPP-RA boundaries as fully shared state-to-state `q/v/a` inputs and validates endpoints and dynamic limits with sampling at `5ms` or finer; on failure it increases only the same segment's minimum duration (`1.1x`, cumulatively no more than `50x`). The caller must inject local spatial certification to revalidate joint limits, the head, the fixed Cartesian tube, combined `0.5°`/`voxelSize/16` sampling, and zero-contact/allowed-contact sets for each segment, then aggregate and exactly compare the frozen contact set after the full Move; spatial failures must not be hidden by duration-extension retries. It is not a runtime trajectory source until Worker asset loading, the active runtime trajectory, and end-to-end playback certification are complete.
- Animation speedup is a planning input rather than a render-clock multiplier: the default request is `1.25x`, actual speed, acceleration, and jerk are separately clamped to V3 hard limits, and actual duration and ratios are written into the plan and participate in scoring/signatures. Directly multiplying per-frame `delta` or the frozen trajectory clock is forbidden.
- Rendering samples the frozen trajectory using monotonic absolute plan time; hidden pages, pauses, and debugging freeze plan time, and resuming does not catch up to wall-clock time. Contact, scoring, and atomic-action events are driven by planned sweep intervals, independent of whether any intermediate render frame occurs.
- After each actual playback rAF, the V3 frontend records render time, plan time, stage/cell, entry branch, analytic five-joint `q/v/a/j`, controller joint/end-effector tracking errors, and frame intervals in a bounded read-only diagnostic ring. The long-frame threshold is `50ms`; diagnostic copies do not participate in the Worker, trajectory signatures, collision, or scoring, and Inspector shows their summary collapsed by default.

### 15.3.3 Compact synchronized PTP (V4, implemented and accepted in the frontend)

- The V4 version is `cutter-grid-compact-ptp-v4`. In the Worker, it builds a global multibranch IK graph only for certified entries and each visible Move endpoint; Wait creates no IK layer. The first candidate round uses fixed entry/previous-state/midpoint/12 Halton seeds and at most 12 candidates; the first disconnected layer expands to a cumulative 48 seeds and at most 24 candidates.
- Adjacent endpoint layers are validated in the fixed order of the nearest 4, nearest 8, then all candidate edges. The full program jointly selects the entry and configuration chain; greedy per-Move selection must not lock in the wrong Wrist branch.
- Each direct edge uses synchronized quintic PTP: `q(u)=q0+(q1-q0)(10u³-15u⁴+6u⁵)`. All five joints share the time parameter; the default dynamic request is rated `1.0x`, subject to Profile speed, acceleration, and jerk hard limits and a minimum duration of `160ms` per primitive.
- When a direct edge collides, V4 queries the joint-space roadmap in Profile V4 with a fixed 256 Halton nodes and at most 8 safe edges per node. Search results must be shortcut to at most one internal configuration, so each Move has at most two PTP primitives; exceeding the budget returns `motion-primitive-budget-exhausted`.
- V4 generates swept-contact events and haircut results from the actual end-effector curve and `toolRadius=0.12`. The old straight-path contact set is no longer a hard constraint; the expected curve and expected cut set must be displayed before execution.
- Certification sampling occurs only in the Worker: maximum joint change/end-effector displacement are `1°`/`voxelSize/8` in ordinary regions, tightened to `0.25°`/`voxelSize/16` near the head, with conservative link-motion upper bounds proving interval clearance. Fail closed when clearance cannot be proved.
- `CutterTrajectoryPlanV4` serializes only entry, grouped actions, 1–2 analytic primitives per action, boundary `q/v/a`, certified contact events, actual results, diagnostics, and signatures; dense certification samples must not be sent to the main thread or used as hardware instructions.
- Step completes one visible Move or Wait at a time. Run, Test, and Step replay the same V4 plan using monotonic absolute plan time; hidden pages and pauses freeze plan time, and resuming does not catch up to wall-clock time.
- Cutter Grid currently still scores locally only in Practice and Lessons. ArmDock must reject V4: existing firmware cannot execute synchronized quintic trajectories locally and lacks a complete five-joint mapping. The future hardware protocol is `CutterArmMotionProgramV1`, containing 1–2 `sync-ptp` primitives per Move and Wait in a single batch; high-frequency pose streaming from the browser or Electron is forbidden.

### 15.3.4 Rust migration boundaries

- Rust V4 planning migration uses a separate `POST /api/v1/cutter-grid/plans` contract. Requests contain only `challengeId`, `challengeVersion`, and `CutterGridProgramV4`; the server selects its own certified `CutterGridProfileV4` by Challenge signature, and clients must not upload Profiles, roadmaps, IK candidates, or trajectories. The response is `CutterGridPlanResponseV1` and must identify `hcr-sim-rust`, the build identifier, Profile signature, and planning duration; duration and implementation source do not participate in trajectory signatures.
- `hcr_sim` includes the pure-domain V4 planner only under the `std + planner` feature; firmware/no_std does not include it. The existing V2 “client uploads trajectory, backend audits” protocol retains read-only compatibility without extension; Servo Program IR and existing V2 DTOs remain unchanged.
- Online Practice prefers Rust by default; explicit offline mode calls the TypeScript Worker directly. Only network errors, the 30-second client wait timeout, HTTP 429, or 5xx may fall back to the Worker; 400/404/422, version or signature mismatches, and malformed success responses must fail closed. The Provider returns `rust-backend` or `typescript-fallback` for Inspector display, but this must not enter plan signatures.
- Run, Test, and Step must replay the same frozen V4 plan; editing the workspace or switching mode or Challenge cancels old requests. Remote planning displays the same `planning` state, without adding SSE or polling or changing search results according to wall-clock time.
- The frontend and Rust must share versioned JSON fixtures: inputs are Challenge, V4 Profile, Program, and dynamic limits; successful vectors output compact primitives, contact events, actual results, diagnostics, and their respective stable signatures, while failure vectors output structured errors. Dense certification samples may be omitted from fixtures, but both implementations must reconstruct and match the specified semantics and summary tolerances.
- Initial Cutter Grid scoring remains local only: scores, Session, Match, and Program IR must not be sent; Versus and ArmDock continue to reject V4. The UI consumes only serializable plans and displays them using absolute time; browser-specific state must not patch or change planning results.
- Amended 2026-09-10: an offline Versus room may plan V4 **locally**, on the same terms — the plan and the
  score stay in the browser and the entry carries neither, so the prohibition above is unchanged for
  every path that leaves it. ArmDock still rejects V4.
- Amended 2026-09-11: an **online** Versus round may be played in Cutter Grid, and the prohibition above is
  still not what changed. What travels is `SubmissionCreate.cutterGridV4` — the lattice program, and
  nothing else. No Profile, no roadmap, no trajectory and no client score leave the browser; the server
  plans the route with the Profile it holds and scores its own sweep
  (`hcr-backend/docs/08-CUTTER-GRID.md` §0). The local plan stays what it always was: the preview the
  player watched. Session, Electron, firmware and ArmDock remain closed to V4.

### 15.4 Versioned boundaries

- `CutterGridProgramV1` is a separate serializable player IR containing `plannerVersion`, direction, distance, Wait/Repeat, and `sourceBlockId`; it neither extends nor impersonates the current backend Servo Program IR.
- The full `CutterGridProfileV1` signature covers joint order/ranges/initial values/speeds/Servo mappings, robot-arm and collision dimensions, voxel/head geometry, complete initial/target Hair, cutter radius, and Profile and planner versions.
- `CutterTrajectoryPlanV1` stores single-cell synchronized waypoints, per-joint synchronized velocities, logical coordinates, expected cut set, estimated duration, and a stable trajectory signature; angles are quantized to `0.1°`, time uses integer milliseconds, velocities are stably serialized to six decimal places, and sets are stably sorted. The executor uses frozen angles and velocities for Hermite playback and does not replan at runtime.
- Internal IK waypoints do not count toward player command counts; estimated time is computed from the frozen synchronized trajectory plus Wait. Cutter Grid uses only the local scorer after completion.
- During transition, the V2 Worker must not accept V1 Profiles, V1 trajectories, or V1 signatures; V2 runtime assets must use separate `CutterGridProfileV2`, `CutterTrajectoryPlanV2`, entry IDs, and stable signatures covering entry. Servo Program IR, backend wire schema, Session/Match, Versus, and ArmDock remain unchanged.
- V4 runtime assets must use separate `CutterGridProfileV4`, `CutterTrajectoryPlanV4`, compact primitives, actual contact events, and V4 signatures. V4 fails closed for V1–V3 Cutter Grid plans and signatures; Servo Program IR, backend wire schema, Session/Match, and Versus remain unchanged, and ArmDock remains disabled for V4.
- Amended 2026-09-10: the wire is still unchanged. What changed is which editor an offline room may be
  opened in, and the one field that says so — `MatchConfig.programmingMode` — was already in the backend
  contract and is enforced there.
- Amended 2026-09-11: the wire gains exactly one additive optional field, `SubmissionCreate.cutterGridV4`,
  carrying `CutterGridProgramV1` and no trajectory. Servo Program IR, the V2 client-uploaded-trajectory
  channel and every existing DTO are untouched: a servo submission is byte-identical to what it was.

### 15.5 Enablement gates

- The Phase 0 geometry audit proves only that the finite grid, `0.12` contact radius, safe edges in six directions, and coverage of 12 targets contain no direct contradiction; its `trajectoryCertification` must remain `pending-planner`.
- The entry may be enabled only after a subsequent planner generates a certified starting point, zero-contact entry, reachable nodes/edges, and a reference program, and proves that the reference program removes exactly the 12 targets with no collateral removal and Completion of 100.
- If any gate fails, stop enablement; do not modify the shared Challenge, cutter radius, or safety margin to obtain a pass.

### 15.6 Tutorials and lessons

- The home-page Tutorial entry first offers separate Cutter Grid and Servo Angles routes; Cutter Grid is recommended for first-time users, but the original Servo tutorial must not be removed.
- The Cutter Grid tutorial uses the current certified reference path `Left 3 → Up 6 → Up 2 → Forward 1 → Up 1 → Forward 1 → Up 1 → Forward 6 → Forward 1`, explaining fixed world axes, connection order, the safe grid, full planning, and Test scoring in eight steps from an empty Workspace. Step completion must read actual Cutter Grid IR and simulation Score rather than duplicating planning or scoring logic.
- Cutter Grid Lessons comprises ten lessons, each with at least twenty sections: fixed axes, distances, Repeat, actual sweeps, blocked nodes, opposite directions, Waypoint Wait, path order, same-direction move compression, and certified complete haircuts. Each lesson has sections covering concepts, rules, safety, prediction, construction, observation, variations, Debug, independent challenges, and recap; it remains Cutter Grid-only with local planning/scoring and provides previous/next navigation within lessons and a continuous next-lesson entry.
- Servo Angles Lessons comprises eight lessons, each with at least twenty sections; the first nineteen cover absolute angles, starting pose, joint responsibilities, collisions, prediction, construction, Step/Test, reading evidence, and Debug, while section 20 is an actual scoring checkpoint. The next lesson appears only when Completion reaches 100; problem Targets continue to be generated by executing verified solutions, rather than replaced with handwritten answers.
- The Tutorial selection page also offers a `Grid → Servo Angles` transition demonstration: in the same actual Workbench, first build a Grid Move and inspect coordinates/safe planning, then switch to Servo, build an absolute joint command, and return to Grid to verify that the two Workspaces are isolated. Newly created hardware-joint blocks must initialize command values to firmware Home 90°; Inspector must display real-time simulated angles by servo axes X/Y/Z/B/E and update them during command execution, while the Electron ARM panel separately displays actual device reports. The Challenge safe pose is used separately for simulation with the head model; static Home values must not be presented as live telemetry.
- Tutorials and lessons must use Challenge safe initial angles and certified Profiles; hardware Home 90° must not be treated as the Challenge entry pose, and Cutter Grid Programs must not leak into Servo/backend submission paths.

## macOS desktop distribution signing (2026-10-07)

- GitHub Actions tag and manual builds use free ad-hoc signing, requiring no paid developer account, Apple certificates, or Actions secrets; the manual workflow uploads artifacts only and does not publish a Release.
- Use electron-builder's custom signing hook to fully sign the main application and nested Electron components; retain Hardened Runtime and Electron entitlements, and disable notarization and signing timestamps. The current security fix pins 26.15.3; full signatures and application identifiers for both architectures must be verified before upload.
- The macOS configuration includes `NSLocalNetworkUsageDescription`. On first launch, users may need to allow the application manually in Privacy & Security and separately grant Local Network permission; ad-hoc signing provides neither a Developer ID identity nor Apple notarization, and permission-identity stability after upgrades is not guaranteed.
- Provide an optional script and instructions for users to re-sign for free on their own Macs. Signing does not prove `EHOSTUNREACH` is fixed; actual connection recovery requires separate acceptance. See `docs/RELEASING.md` for the steps.

## Proposed audit security remediation contract (2026-10-13)

This section describes the uncommitted security proposal prepared before the user's Human-Led clarification. It remains subject to human-authored structure and load-bearing logic, review, and acceptance; it is not a ratified change to the existing contract. It does not authorize deployment, V2/V3 migration, runtime IK, or V4 hardware execution.

Governance status: the user specified **Human-Led**. This repository has no `GOVERNANCE.md`, `POLICY.md`, or `CONTRIBUTING.md`, so recorded scope ownership and independent reviewers remain unverified. Formal FDS Update Reports and QA records must be handwritten in ink without AI assistance. This technical proposal does not draft or complete those forms, establish approval, or authorize a commit or merge.

- Servo `buildArmPlan` must replay the complete program through the existing `ProgramExecutor`, `RobotController`, and head constraints using the one-decimal angles actually sent to firmware. An initial-pose collision throws `ArmError`; a collision during the sweep returns `steps: []` with optional `collision: BlockedHeadCollision`. Unknown joints or joints without a servo mapping also reject the entire plan; commands must never be silently removed. A rejected plan must not reach IPC. Geometry checks do not replace hardware calibration or prove that moving from an unknown physical pose to firmware Home is safe.
- Electron may open only valid HTTPS URLs externally and must handle OS launch failures. Packaged builds ignore `ELECTRON_START_URL`. Explicitly enable the renderer sandbox, allow only one application instance to own arm control, disable the RunAsNode, Node environment option, and Node CLI inspection fuses, and load application code only from asar. Deny browser permissions by default; allow `clipboard-sanitized-write` only for the trusted main page to copy room codes. Deny subframe permissions, clipboard reads, and device permissions.
- Arm HTTP requests have a three-second absolute deadline covering the complete response and must reject truncated responses. Addresses use canonical decimal IPv4; errors must not echo LAN response bodies. Address changes, Home, and another Send are forbidden while running or parking. Reload or renderer loss stops subsequent commands, and Stop remains callable after the UI remounts. Window close and application quit wait for in-flight requests before attempting Home. An unreachable network prevents any guarantee that the physical arm has stopped.
- On shared devices, withdrawing research participation clears player identity. The menu's New player action clears identity and consent and displays the participation choice again. If persisting withdrawal fails, the current tab still treats participation as declined and attempts to remove the old persisted grant. Data settings initialize from saved language and UTC offset choices; first-time participation is handled separately from existing choices. Automatic session expiry remains a future extension/TBD.
- Crew maps must not read inherited properties. IDs such as `__proto__`, `constructor`, and `toString` must not cause render errors. A root error boundary provides recovery to the menu without displaying exception stacks.
- Challenge validation rejects non-finite servo offsets, invalid directions, non-finite centers, and a `headScale` that is not a positive three-dimensional vector. Geometry constraints fail closed on invalid values. Remote V4 plans and their total positioning/player durations must not exceed `Number.MAX_SAFE_INTEGER` milliseconds. Path previews use at most 256 sampling intervals per primitive; this bound does not certify physical motion duration. Valid Wait 0 commands and obstacle-avoidance plans with two primitives per Move remain compatible.
- HTTP Match route entry points validate six-character `[A-Z2-9]` room codes to prevent `.`/`..` path normalization. Remove public build-time token configuration; credentials must not be stored in `VITE_*`. Public player IDs and client-side host flags do not provide server authorization. Credential and host-permission protocols still require validation and implementation across repositories.
- CI defaults to `contents: read`, checkout does not persist credentials, external Actions are pinned to commit SHAs, and the npm lockfile uses official registry URLs and integrity hashes. Pin the desktop runtime to Electron 44.7.0. Cross-platform installation, signing, and actual sandbox/fuse behavior require separate human verification; web E2E does not replace it.
- Versus seals other players' scores and standings. Test/Inspector may show the player's own local preview score; the server determines official results. Classroom LAN access uses a static build/preview server and does not expose the Vite development server.

## 15. Future extensions / still undecided

The following do not affect the first-release implementation and must not be prematurely finalized in the first release:

- Final robot-arm model, actual servo errors, and acceleration;
- Relative angles, concurrent joints, sensors, and advanced Blockly;
- Official Target Hairstyle authoring tools and question-bank format;
- Final competition scoring weights, optimal programs, and difficulty formulas;
- Multiple Challenges, two-player competition, and CAT / Dynamic QBank;
- Official backend protocols, authentication/authorization, and data storage;
- Real ESP / MQTT integration;
- A physics engine, collision response, robot-arm self-collision, and larger-scale voxel optimization.

These capabilities may be extended only through new configuration, interface implementations, or versioned protocols; they must not break the existing semantics of first-release Program IR, Providers, or Score Result.
