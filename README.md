# HCR Simulator

HCR Simulator is a fully client-side Web 3D programming demo. Users arrange servo-angle commands in Blockly to drive a virtual five-joint robot arm. The end effector removes Hair Voxels on contact, while deterministic geometric constraints prevent the entire mechanism from entering the head. The simulator then scores the result by target-hairstyle completion, program efficiency, and estimated execution time.

> **Current status: Phases 1–6 are complete and the fully client-side demo loop is operational. Phase 7 cross-browser visual acceptance is still pending.**

> **Documentation policy:** This README is the English public entry point. The canonical engineering, specification, implementation, and acceptance documents remain in Chinese under the repository policy.

## Documentation

| Document | Purpose |
|---|---|
| `AGENTS.md` | Repository rules that Codex and other AI coding agents must follow |
| `docs/HCR_Simulator_SPEC_v0.3.md` | Current, self-contained product and technical specification |
| `docs/IMPLEMENTATION_PLAN.md` | Phased implementation status, module deliverables, and quality gates |
| `docs/ACCEPTANCE.md` | Automated and manual acceptance checklist |
| `docs/HCR_Simulator_SPEC_v0.2.md` | Historical specification retained only for tracing earlier decisions |

## Demo Loop

```text
Local Challenge Provider
        ↓
Blockly Workspace
        ↓
Program IR → Runtime Commands
        ↓
Simulation Engine → Robot Controller
        ↓                    ↓
Swept Contact          R3F Rendering
        ↓
Hair Voxel State
        ↓
Local Score Provider
        ↓
Score Breakdown / Result
```

The target version includes:

- React + TypeScript + Vite + React Three Fiber / Three.js + Blockly.
- One local **Neat Short Haircut** Challenge: **Thick Cap Initial Hairstyle → Symmetric Neat Crop**.
- A procedural five-joint robot arm, an impenetrable head, and Hair Voxels.
- A `baseYaw → shoulderRoll → shoulder → elbow → wrist` 3D rotation chain, displayed as **Base Yaw**, **Shoulder Roll**, **Shoulder**, **Elbow**, and **Wrist**.
- A deterministic collision response that stops at the last safe pose, identifies the source block, and enters a recoverable error state.
- Run, Pause, Resume, Step, Stop, Reset, and current-block highlighting.
- Voxel IoU, program efficiency, estimated execution time, and a weighted final score.
- A 3D-first desktop workbench for Chrome and Edge at approximately 1280×720 or larger.

## Using the Demo

1. Start the app and wait for the local Challenge and starter Blockly program to load.
2. Run the safe starter program, which includes a nonzero **Shoulder Roll**, or edit the absolute joint-angle, Wait, and Repeat blocks in the left panel.
3. Select **Run** to execute from the Challenge's initial state. While it is running, you can Pause, Resume, or Stop it.
4. Select **Step** while idle or paused to complete exactly one atomic command.
5. Use the right Inspector to view joint angles, end-effector position, voxel counts, command metrics, and scores. The bottom log records important events.
6. Select **Reset** to restore the simulation while preserving the Blockly program. The **Target Hairstyle Preview** can be toggled independently.

## Local Setup and Quality Commands

Node.js 22 and npm are required. Install dependencies and start the development server:

```bash
npm install
npm run dev
```

The project provides these quality commands:

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Production builds are written to `dist/`. Do not commit that directory or generated test reports.

## Explicit Non-goals

- A backend, accounts, workspace persistence, or a network runtime dependency.
- Real ESP or servo integration, MQTT, WebSerial, or WebBluetooth.
- Inverse kinematics, a full physics engine, robot self-collision, realistic hair strands, or scissor actuation.
- Multiplayer competition, dedicated mobile support, or production deployment.
