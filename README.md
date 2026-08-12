# HCR Simulator

HCR Simulator is a Web 3D programming demo for a virtual five-joint robot arm. Users can program absolute Servo angles or, in certified practice surfaces, move the cutter through a fixed-world 3D grid while a deterministic planner maps the path to synchronized joint motion. The end effector removes Hair Voxels on contact, while geometric constraints prevent the mechanism from entering the head.

> **Current status: the Servo loop and Cutter Grid frontend Phase 0–5 are complete. Automated acceptance covers real Chrome and Edge at 1280×720 and 1920×1080.**
>
> Since v0.3 the app also has a **menu, a solo mode and a competitive versus mode**, and can run against the
> HCR backend in `../hcr-backend`. It still runs entirely offline with no backend configured — see
> [Game modes](#game-modes).

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
- An optional **Cutter Grid** language in Practice and five dedicated Lessons: six fixed-world directions, integer distances, Wait, Repeat, deterministic compile-time IK, and frozen C1 joint trajectories.
- Run, Pause, Resume, Step, Stop, Reset, and current-block highlighting.
- Voxel IoU, program efficiency, estimated execution time, and a weighted final score.
- A 3D-first desktop workbench for Chrome and Edge at approximately 1280×720 or larger.

## Using the Demo

1. Start the app, choose a mode, and wait for the local Challenge to load.
2. In Servo mode, arrange absolute joint-angle, Wait, and Repeat blocks. In Practice, select **Cutter Grid** to arrange fixed-axis movement blocks instead.
3. Select **Run** to execute from the Challenge's initial state. While it is running, you can Pause, Resume, or Stop it.
4. Select **Step** while idle or paused to complete exactly one atomic command.
5. Use the right Inspector to view joint angles, end-effector position, voxel counts, command metrics, and scores. The bottom log records important events.
6. Select **Reset** to restore the simulation while preserving the Blockly program. The **Target Hairstyle Preview** can be toggled independently.

## Game modes

The app opens on a menu with Tutorial, Lessons, Solo Practice, and Versus surfaces.

**Solo Practice** is the untimed workbench. Servo is the default; the certified default Challenge also offers Cutter Grid. Cutter Grid scores locally and cannot be submitted to a backend yet.

**Lessons** include eight Servo challenges and five Cutter Grid lessons covering fixed axes, distance, Repeat, swept overcuts, and blocked nodes.

**Versus Round** is a competitive round: everyone in the room gets the *same* challenge at the *same*
moment and has a fixed wall-clock window to submit. Closest to the target wins. No score is visible to
anyone — including yourself — until the round closes, and you may resubmit as often as you like because
only your best attempt counts. The rules and the reasoning behind each are in
[`../hcr-backend/docs/06-MULTIPLAYER.md`](../hcr-backend/docs/06-MULTIPLAYER.md).

Both modes share a **Test** button next to Run. It evaluates the program headlessly — the same engine and
the same result, in milliseconds instead of watching it animate — so how fast you can iterate does not
depend on how fast your machine renders.

### Offline versus is practice, not multiplayer

With no backend configured there is no server to replay your program, so an offline round is scored by
your own browser and the opponents are scripted local bots. The app says so on the menu, in the lobby and
on the scoreboard. It exists so the mode is playable with `npm run dev` alone; nothing it reports is a
result.

### Playing a real round

Point the app at a backend and the identical UI becomes real: programs are replayed server-side, the
deadline is judged by the server's clock, and standings are the server's.

```bash
# terminal 1 — the backend
cd ../hcr-backend
cargo run -p hcr_service --features hotaru --example serve

# terminal 2 — the app
VITE_HCR_API_BASE_URL=http://localhost:18623 npm run dev
```

Open two browser profiles, host in one, and join with the room code in the other. `cargo run ... --example
serve` is a **development** server: it has no authentication layer, so it trusts the player-identity header
as sent and its item-signing key is a placeholder in the source.

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
npm run test:visual
npm run cutter-grid:audit
npm run cutter-grid:profile
```

Production builds are written to `dist/`. Do not commit that directory or generated test reports.

## Explicit Non-goals

Still out of scope:

- Accounts and workspace persistence.
- Real ESP or servo integration, WebSerial, or WebBluetooth.
- Generic runtime inverse kinematics outside the certified Cutter Grid planner, a full physics engine, robot self-collision, realistic hair strands, or scissor actuation.
- Dedicated mobile support, or production deployment.

Two entries moved off this list and are now delivered by `../hcr-backend` rather than by this app: **a
backend** (optional — the simulator still has no network dependency of its own, and makes no request unless
`VITE_HCR_API_BASE_URL` is set) and **multiplayer competition**. MQTT is designed and specified but not yet
wired here; the versus mode currently uses the HTTP binding.
