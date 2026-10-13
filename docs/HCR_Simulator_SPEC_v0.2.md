# HCR Simulator Frontend Demo Technical Design Specification (v0.2)

> Purpose: align the team's understanding and serve as project context, implementation boundaries, and acceptance criteria for Codex / AI coding agents.
>
> Status: **Current frontend Demo baseline**. This document records confirmed directions; unconfirmed details are consistently marked **TBD** and must not be arbitrarily hardcoded during implementation.
>
> Basis: the 2026-07-29 project meeting + subsequent team alignment.

---

## 1. Currently Confirmed Project Baseline

This version takes the following 7 points as the currently confirmed approach:

1. **Frontend technical architecture**: React + TypeScript + React Three Fiber (R3F) + Three.js + Blockly.
2. **Head/hair modeling**: use a “pixelated / block / voxel” approach, with overall visuals and data structures resembling Minecraft-style block models.
3. **Robot arm control logic**: broadly follow real servo / joint control logic; the specific number of servos, angle ranges, Block forms, speeds, and control details remain TBD.
4. **Hair-cut detection**: do not consider opening or closing scissors for now. Valid contact between the robot arm's end effector and a “hair voxel” means that voxel is cut/deleted.
5. **Scoring / Difficulty**: use target hairstyle completion, program efficiency, and completion time, in descending priority, and calculate a weighted average using configurable weights.
6. **This stage implements only an executable frontend Demo**: no backend is required at runtime; however, the code must retain a clear backend interface layer to avoid restructuring core logic when integrating it later.
7. **This stage does not connect real ESP / servo hardware**: simulate only a virtual robot arm. Real hardware integration is a future extension.

---

## 2. Goals and Non-Goals for This Stage

### 2.1 Current Goals

The current goal is an HCR Simulator frontend Demo that runs independently in a browser and demonstrates at least this complete flow:

```text
Select / load a local Challenge
        ↓
Compose a servo control program in Blockly
        ↓
Program IR / Command List
        ↓
Virtual robot arm moves according to joint commands
        ↓
End effector touches a Hair Voxel
        ↓
Hair Voxel is deleted
        ↓
Compare with Target Hairstyle
        ↓
Calculate completion / program efficiency / time
        ↓
Output the final weighted score
```

### 2.2 Explicit Current Exclusions

- No integration with actual backend interfaces;
- No MQTT integration;
- No ESP / real servo integration;
- No simulation of individual real hair strands;
- No physical scissor opening or closing;
- No pursuit of high-precision soft-body / hair physics;
- No mandatory inverse kinematics (IK) implementation;
- No early commitment to a particular robot arm model or number of degrees of freedom;
- No early commitment to final competition rules, final scoring weights, or a CAT dynamic item bank.

---

## 3. Technical Architecture

### 3.1 Technology Stack

| Layer | Technology | Current responsibility |
|---|---|---|
| Web application | React | Organize pages, components, state, and interactions |
| Type system | TypeScript | Data models, Commands, interfaces, and module boundaries |
| 3D React layer | React Three Fiber | Organize Three.js scenes using React |
| 3D rendering | Three.js | Scene, Camera, Light, Robot, Voxel, etc. |
| Visual programming | Blockly | Block-based program editing and custom servo Blocks |
| Build tool | Vite | Local development and frontend builds |

### 3.2 Overall Layers

```text
React UI
Challenge / Blockly / Controls / Score / Result
        ↓
Program / Command Layer
Blockly → Program IR → Robot Commands
        ↓
Robot Control Layer
Servo / Joint State → Command Executor
        ↓
Simulation Layer
Robot Kinematics / Animation / Contact Detection
        ↓
R3F / Three.js Rendering
        +
Voxel Hair State / Remove / Target
```

### 3.3 Key Architectural Constraints

- Blockly **must not modify Three.js Mesh directly**.
- 3D components **must not directly contain scoring logic**.
- The UI **must not hardcode the number of robot arm joints**.
- Hair-cut results are represented by Voxel State, rather than visual effects alone.
- All business calculations in the current Demo can run locally in the browser, but must be organized through interfaces / service abstractions to allow future backend replacements.

---

## 4. Voxel Head / Hair Model

### 4.1 Design Goals

Hair is represented by discrete voxels rather than continuous strands or complex Mesh Deformation. Each Hair Voxel is the smallest “hair unit” that can independently exist or be deleted.

Conceptual model:

```text
Voxel Space
[x][y][z]

0 = empty
1 = hair voxel present
```

The head body and hair should be logically separate:

```text
Head
├── Solid Head / Face  (cannot be cut)
└── Hair Voxels        (can be cut)
```

### 4.2 Recommended Data Structures

```ts
export type VoxelKey = string; // e.g. "12,8,4"

export interface VoxelCoord {
  x: number;
  y: number;
  z: number;
}

export interface HairVoxel {
  key: VoxelKey;
  coord: VoxelCoord;
}

export interface HairState {
  voxels: Set<VoxelKey>;
}
```

The rendering layer can choose based on performance:

- A small number of voxels: ordinary Mesh;
- More voxels: `THREE.InstancedMesh`;
- Larger scale: consider optimizations such as chunks / greedy meshing later.

The current Demo does not require a complex voxel engine from the outset.

### 4.3 Target Hairstyle

The target hairstyle is also represented as a HairState / voxel set:

```ts
export interface HairstyleTarget {
  id: string;
  name: string;
  voxels: Set<VoxelKey>;
}
```

The “user's current hairstyle” and the “target hairstyle” can therefore be compared directly as sets.

---

## 5. Robot Arm and Servo Control Model

### 5.1 Currently Confirmed Principles

Players primarily control the robot arm's **Servo / Joint**, rather than directly issuing Cartesian `Move X/Y/Z` commands to the end effector.

Current overall direction:

```text
Blockly Command
      ↓
Servo / Joint Angle
      ↓
Robot Kinematic Chain
      ↓
Robot Pose
      ↓
End-Effector Position
```

### 5.2 Current Unconfirmed Items (TBD)

The following will be determined later and must remain configurable in the current implementation:

- Number of servos;
- Robot arm degrees of freedom;
- Name of each servo;
- Lower and upper angle limits for each servo;
- Servo speeds;
- Whether both “absolute angle” and “relative angle” Blocks are allowed;
- Whether multiple servos can move simultaneously;
- Whether to add wait / delay;
- Whether to add advanced Blocks such as sensors, if, and while;
- Whether to strictly simulate real servo speeds and errors.

### 5.3 General Data Structures

```ts
export type JointId = string;

export interface JointConfig {
  id: JointId;
  name: string;
  minAngleDeg: number;
  maxAngleDeg: number;
  initialAngleDeg: number;
  speedDegPerSec?: number;
}

export interface JointState {
  id: JointId;
  angleDeg: number;
}

export interface RobotState {
  joints: Record<JointId, JointState>;
}
```

### 5.4 First-Version Robot Command

The first version needs only minimal extensible semantics:

```ts
export type RobotCommand =
  | {
      type: 'set-joint-angle';
      jointId: JointId;
      angleDeg: number;
    }
  | {
      type: 'change-joint-angle';
      jointId: JointId;
      deltaDeg: number;
    }
  | {
      type: 'wait';
      durationMs: number;
    };
```

Note: **There are no `open-scissors` / `close-scissors` commands.**

---

## 6. Hair-Cut / Collision Detection

### 6.1 Current Rules

In the current Demo, the robot arm's end effector itself is the “hair-cutting tool”.

> When the end effector's effective collider makes valid contact with a Hair Voxel, that Hair Voxel is immediately considered cut and removed from the current HairState.

Flow:

```text
End Effector Move
      ↓
Contact / Overlap Detection
      ↓
Hit Hair Voxel?
   ├─ No → Nothing
   └─ Yes
        ↓
   Remove Voxel
        ↓
   Update HairState
        ↓
   Update Rendering
```

### 6.2 Implementation Boundaries

Only stable, repeatable geometric contact detection is currently needed; real scissor physics is not required.

Possible approaches:

- AABB bounding boxes;
- Sphere / Box overlap;
- Spatial checks based on voxel grid coordinates;
- Simple Ray / Sweep checks (if needed later).

There is currently **no requirement to introduce a full physics engine**. If later gameplay demonstrates a need for physical collisions, evaluate options such as Rapier separately.

---

## 7. Blockly and Program IR

### 7.1 Blockly Responsibilities

Blockly is responsible only for:

- Providing a block-based programming UI;
- Generating structured Program IR;
- Expressing servo / joint control and basic flow control.

Blockly does not directly:

- Modify Robot Mesh;
- Delete Hair Voxels;
- Calculate scores;
- Access the backend.

### 7.2 Candidate Blocks for the First Version

```text
Servo / Joint
├── Set Joint [id] to [angle]°
├── Increase Joint [id] by [angle]°
└── Decrease Joint [id] by [angle]°

Control
├── Repeat [N]
└── Wait [time]
```

Specific Block names, servo IDs, and angle ranges remain TBD.

### 7.3 Program IR

Example:

```ts
export type ProgramNode =
  | RobotCommand
  | {
      type: 'repeat';
      count: number;
      body: ProgramNode[];
    };

export interface Program {
  nodes: ProgramNode[];
}
```

At execution time, the Program Executor expands / interprets this into a RobotCommand stream.

---

## 8. Scoring and Difficulty Design

### 8.1 Three Scoring Dimensions

The current approach uses:

1. **Target hairstyle completion (Completion)**: the first criterion, with the highest weight;
2. **Program efficiency (Program Efficiency)**: the second criterion;
3. **Completion time (Completion Time)**: the third criterion.

All three are converted to scores of `0~100`, then combined as a weighted average:

```text
FinalScore =
    wCompletion × CompletionScore
  + wEfficiency × EfficiencyScore
  + wTime × TimeScore

wCompletion + wEfficiency + wTime = 1
```

### 8.2 Default Demo Weights

To let Codex implement the Demo directly, **configurable defaults** are currently provided:

```ts
export const DEFAULT_SCORE_WEIGHTS = {
  completion: 0.60,
  efficiency: 0.25,
  time: 0.15,
};
```

These weights are not the final product rules; they must be centralized in configuration rather than scattered as hardcoded values.

### 8.3 Completion: Voxel IoU

The first version should directly use the IoU of Hair Voxel sets:

```text
CompletionScore = |Target ∩ Result| / |Target ∪ Result| × 100
```

This penalizes all of the following:

- Voxels cut that should have been retained;
- Voxels still present that should have been cut;
- Incorrect positioning of the resulting shape.

### 8.4 Program Efficiency

Program efficiency should encourage:

- Fewer ineffective operations;
- More compact programs;
- Appropriate use of loops;
- Fewer actual robot arm actions.

For the first version, “program cost” should be abstracted as an independent function, without tying the rules to Blockly:

```ts
export interface ProgramMetrics {
  sourceBlockCount: number;
  executedCommandCount: number;
}

export interface EfficiencyConfig {
  referenceCost: number;
  commandWeight: number;
}
```

The Demo can use:

```text
ProgramCost = SourceBlockCount
            + commandWeight × ExecutedCommandCount

EfficiencyScore = min(100, referenceCost / ProgramCost × 100)
```

`referenceCost` is supplied by Challenge configuration; it may later be replaced with an optimal solution, dynamic baseline, or backend calculation.

### 8.5 Time Score

The Challenge supplies `referenceTimeMs`:

```text
TimeScore = min(100, referenceTime / elapsedTime × 100)
```

Therefore:

- At or below the reference time: 100 points;
- Above the reference time: decreases proportionally.

This can later change to a piecewise function, countdown, or competition mode without affecting other modules.

### 8.6 Current Meaning of Difficulty

At this stage, Difficulty is not tied to a separate fixed “difficulty formula”. It can be reflected by a combination of Challenge settings, such as:

- Target Hairstyle complexity;
- Available Block types;
- Initial robot arm pose;
- Scoring reference cost;
- Scoring reference time;
- Servo restrictions that may be introduced later.

---

## 9. Challenge Data Model

The current Demo uses local static Challenge data.

```ts
export interface Challenge {
  id: string;
  name: string;
  description?: string;

  robotConfig: {
    joints: JointConfig[];
  };

  initialHair: HairstyleTarget;
  targetHair: HairstyleTarget;

  allowedBlocks: string[];

  scoring: {
    weights: {
      completion: number;
      efficiency: number;
      time: number;
    };
    referenceProgramCost: number;
    referenceTimeMs: number;
    commandWeight: number;
  };
}
```

First-version Challenges can be stored directly in:

```text
src/data/challenges/*.ts
```

or in JSON files.

---

## 10. Independent Frontend Operation and Reserved Backend Interfaces

### 10.1 Current Principles

**All core Demo flows must run without a backend.**

Business modules must also avoid directly depending on the “local static data” implementation detail.

Provider / Gateway abstractions are recommended:

```ts
export interface ChallengeProvider {
  getChallenge(id: string): Promise<Challenge>;
  listChallenges(): Promise<Challenge[]>;
}

export interface ScoreProvider {
  score(input: ScoreInput): Promise<ScoreResult>;
}
```

Current implementations:

```text
ChallengeProvider
    └── LocalChallengeProvider

ScoreProvider
    └── LocalScoreProvider
```

Future replacements:

```text
ChallengeProvider
    └── HttpChallengeProvider

ScoreProvider
    └── HttpScoreProvider
```

The UI, Blockly, and Robot Controller should not know whether Local or HTTP is currently in use.

### 10.2 Suggested Reserved API Shapes

The following may be needed in the future:

```text
GET  /api/challenges
GET  /api/challenges/:id
POST /api/score
POST /api/simulations       (future)
```

This defines only the interface boundaries; **the current Demo does not implement network calls**.

---

## 11. No Real ESP Integration at This Stage

The current system chain is limited to:

```text
Blockly
   ↓
Program IR
   ↓
Local Program Executor
   ↓
Virtual Robot Controller
   ↓
R3F / Three.js
```

The following are absent for now:

```text
ESP
MQTT
PWM
Real Servo
Real Robot
```

Robot Commands should nevertheless retain the general `jointId + angle` form, close to hardware semantics, to avoid completely rebuilding the programming layer for future hardware integration.

---

## 12. Recommended Frontend Directory Structure

```text
src/
├── app/
│   ├── App.tsx
│   └── routes.tsx                 # Can be omitted if the app is a single page for now
│
├── components/
│   ├── challenge/
│   ├── controls/
│   ├── result/
│   └── layout/
│
├── features/
│   ├── blockly/
│   │   ├── BlocklyEditor.tsx
│   │   ├── blocks/
│   │   └── programCompiler.ts
│   │
│   ├── robot/
│   │   ├── RobotModel.tsx
│   │   ├── robotController.ts
│   │   ├── robotKinematics.ts
│   │   └── types.ts
│   │
│   ├── voxel/
│   │   ├── VoxelHair.tsx
│   │   ├── voxelState.ts
│   │   ├── contactDetection.ts
│   │   └── similarity.ts
│   │
│   ├── simulation/
│   │   ├── SimulatorCanvas.tsx
│   │   ├── programExecutor.ts
│   │   └── simulationStore.ts
│   │
│   └── scoring/
│       ├── scoring.ts
│       ├── efficiency.ts
│       └── types.ts
│
├── services/
│   ├── challengeProvider.ts
│   ├── scoreProvider.ts
│   └── local/
│       ├── localChallengeProvider.ts
│       └── localScoreProvider.ts
│
├── data/
│   └── challenges/
│
├── types/
│   └── shared.ts
│
└── main.tsx
```

Directory names may be adjusted to the current project, but **module boundaries should be preserved**.

---

## 13. Minimum Frontend Demo Acceptance Criteria (MVP)

### P0 - Required

- [ ] The React + TypeScript + Vite project starts successfully;
- [ ] The R3F / Three.js 3D Canvas renders correctly;
- [ ] The page contains an observable virtual robot arm;
- [ ] A block-based Head + Hair Voxel model exists;
- [ ] Hair Voxels have independent logical state;
- [ ] Blockly Workspace supports editing basic servo/joint commands;
- [ ] Blockly can convert to Program IR;
- [ ] Program Executor can execute Commands in sequence;
- [ ] Robot arm joints move according to Commands;
- [ ] A Hair Voxel is deleted when the end effector touches it;
- [ ] Reset restores the initial robot arm and hair state;
- [ ] The Demo can track runtime;
- [ ] The Demo can count source blocks and executed commands;
- [ ] The Demo can calculate Voxel IoU completion;
- [ ] The Demo can calculate all three scoring components and the final weighted score;
- [ ] Challenges and Scores are retrieved/calculated through Provider abstractions rather than hardcoded directly in the UI.

### P1 - Can Be Added Later

- [ ] Improved voxel visuals;
- [ ] `InstancedMesh` optimization;
- [ ] Multiple Challenges;
- [ ] More Blockly control structures;
- [ ] Camera views / OrbitControls;
- [ ] Program stepping, pause, and resume;
- [ ] Highlighting the currently executing Block;
- [ ] Trajectories / debugging information;
- [ ] Two-player competition UI.

---

## 14. Codex Implementation Constraints

Codex must follow these rules during implementation:

### MUST

1. Use **React + TypeScript + Vite**.
2. Use **@react-three/fiber + three** as the primary 3D solution.
3. Use **Blockly** for visual programming.
4. Represent Hair as **deletable voxel state**, rather than only an immutable GLB model.
5. Abstract robot arm operations as **servo / joint commands**.
6. Do not add scissor opening or closing yet; contact between the end effector and a hair voxel deletes that voxel.
7. Blockly → Program IR → Executor → Robot Controller; Blockly must not control Mesh directly.
8. Scoring logic must be independent of the UI and 3D rendering.
9. Use Local Provider / Mock implementations for the backend for now, while retaining replaceable interfaces.
10. Centralize all TBD parameters in configuration; do not scatter magic numbers.
11. Prioritize an executable Demo over excessive abstraction or prematurely building a complete product architecture.

### MUST NOT

1. Do not introduce Unity.
2. Do not introduce real ESP / MQTT / WebSerial / WebBluetooth integration.
3. Do not implement real hair-strand simulation.
4. Do not implement physical scissor opening or closing.
5. Do not assume players use `Move X/Y/Z` to control the robot arm.
6. Do not hardcode robot arm degrees of freedom or servo angle limits inside components.
7. Do not use React State for high-frequency animation updates at 60 FPS; keep high-frequency 3D changes in R3F/Three.js rendering logic.
8. Do not make network interfaces a prerequisite for running the Demo.

---

## 15. Current TBD List

The following questions await later team confirmation:

- Specific robot arm model / degrees of freedom;
- Specific servo count and names;
- Real servo angle and speed limits;
- Final Blockly Block set;
- Whether to retain both absolute and relative angle control;
- Whether multiple servos need to be driven simultaneously;
- Exact shape / size of the end-effector collider;
- Voxel resolution and block size;
- Voxel / mesh representation of the head body;
- Formal Target Hairstyle authoring process;
- Final cost function for Program Efficiency;
- Final weights for the three scoring components;
- Specific presentation and win/loss rules for two-player competition;
- Formal backend API protocol;
- CAT / Dynamic QBank integration approach;
- Real ESP / MQTT integration approach.

Until these are confirmed, use **configuration, interfaces, and replaceable strategies** rather than assuming an approach has already been decided.

---

## 16. One-Sentence Architecture Definition

> **HCR Simulator is currently a Web 3D programming Demo that runs entirely on the frontend: users compose joint control commands with real servo semantics in Blockly to drive a virtual robot arm in R3F/Three.js; the arm's end effector cuts block-based Hair Voxels on contact; the system calculates a weighted score based on target voxel hairstyle completion, program efficiency, and completion time, while retaining extension boundaries through Provider / Service interfaces for future backend and real hardware integration.**
