# HCR Simulator

HCR Simulator is a browser-based 3D programming environment for a virtual five-joint robot arm. You can set absolute servo angles or, on certified practice surfaces, guide the cutter through a fixed-world 3D grid. A deterministic planner turns that path into synchronized joint motion. The cutter removes Hair Voxels on contact, while geometric constraints keep the mechanism outside the head.

> **Current status:** Servo and Cutter Grid frontend phases 0–5 are complete. Automated acceptance runs in Chrome and Edge at 1280×720 and 1920×1080.
>
> Since v0.3, the app includes a **menu, solo practice, and competitive versus play**. It can connect to the
> HCR backend in `../hcr-backend`, but it still works entirely offline when no backend is configured. See
> [Game modes](#game-modes).

> **Documentation policy:** This README is the public English entry point. Under the repository policy, the canonical specification, implementation plan, engineering notes, and acceptance criteria remain in Chinese.

## Documentation

| Document | Purpose |
|---|---|
| `AGENTS.md` | Repository rules that Codex and other AI coding agents must follow |
| `docs/HCR_Simulator_SPEC_v0.3.md` | Current, self-contained product and technical specification |
| `docs/IMPLEMENTATION_PLAN.md` | Phased implementation status, module deliverables, and quality gates |
| `docs/ACCEPTANCE.md` | Automated and manual acceptance checklist |
| `docs/HCR_Simulator_SPEC_v0.2.md` | Historical specification retained only for tracing earlier decisions |

## How a run works

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

## What is included

- React, TypeScript, Vite, React Three Fiber / Three.js, and Blockly
- One local **Neat Short Haircut** challenge: **Thick Cap Initial Hairstyle → Symmetric Neat Crop**
- A procedural five-joint robot arm, an impenetrable head, and Hair Voxels
- A `baseYaw → shoulderRoll → shoulder → elbow → wrist` rotation chain, shown as **Base Yaw**, **Shoulder Roll**, **Shoulder**, **Elbow**, and **Wrist**
- Deterministic collision handling that stops at the last safe pose, identifies the source block, and leaves the program in a recoverable error state
- An optional **Cutter Grid** language in Practice, plus five lessons covering six fixed-world directions, integer distances, Wait, Repeat, deterministic compile-time IK, and frozen C1 joint trajectories
- Run, Pause, Resume, Step, Stop, Reset, and current-block highlighting
- Voxel IoU, program efficiency, estimated execution time, and a weighted final score
- A desktop-first 3D workbench for Chrome and Edge at roughly 1280×720 or larger

## Try the simulator

1. Start the app, choose a mode, and wait for the local challenge to load.
2. In Servo mode, arrange absolute joint-angle, Wait, and Repeat blocks. In Practice, choose **Cutter Grid** to work with fixed-axis movement blocks instead.
3. Select **Run** to begin from the challenge's initial state. You can Pause, Resume, or Stop while the program is running.
4. When the simulator is idle or paused, select **Step** to complete one atomic command.
5. Use the Inspector on the right to check joint angles, end-effector position, voxel counts, command metrics, and scores. Important events appear in the log below the workspace.
6. Select **Reset** to restore the simulation without clearing the Blockly program. You can toggle the **Target Hairstyle Preview** separately.

## Game modes

The opening menu leads to Tutorial, Lessons, Solo Practice, and Versus.

**Solo Practice** is an untimed workbench. Servo is the default, and the certified default challenge also supports Cutter Grid. Cutter Grid scores stay local and cannot be submitted to the backend yet.

The **Lessons** section contains eight Servo challenges and five Cutter Grid lessons on fixed axes, distance, Repeat, swept overcuts, and blocked nodes.

**Versus Round** gives everyone in the room the *same* challenge at the *same* time, with one fixed submission
window. The closest result to the target wins. Scores stay hidden from every player, including the person
who submitted them, until the round closes. You can submit more than once. Only your best attempt counts.
The complete rules and their rationale are in
[`../hcr-backend/docs/06-MULTIPLAYER.md`](../hcr-backend/docs/06-MULTIPLAYER.md).

Both modes have a **Test** button next to Run. Test uses the same engine and produces the same result without
rendering the animation, so you can iterate in milliseconds regardless of rendering speed.

### Offline versus is practice, not multiplayer

Without a backend, there is no server to replay your program. The browser scores the round locally and
scripted bots fill the opponent slots. The menu, lobby, and scoreboard all label this mode as offline
practice. It is there so `npm run dev` is enough to try the full interface. Its standings are not real
multiplayer results.

### Playing a real round

Connect the app to a backend to run a real round. The server replays each program, applies its own clock to
the deadline, and owns the final standings.

```bash
# terminal 1: the backend
cd ../hcr-backend
cargo run -p hcr --features hotaru --example serve

# terminal 2: the app
VITE_HCR_API_BASE_URL=http://localhost:18623 npm run dev
```

Open two browser profiles, host a round in one, and join from the other with the room code. The
`cargo run ... --example serve` command starts a **development** server. It has no authentication layer,
trusts the supplied player-identity header, and uses a placeholder item-signing key from the source.

## Local setup and checks

Node.js 22 and npm are required. Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Run the checks you need from the same directory:

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

## Out of scope

The simulator does not currently cover:

- Accounts and workspace persistence.
- Real ESP or servo integration, WebSerial, or WebBluetooth.
- Generic runtime inverse kinematics outside the certified Cutter Grid planner, a full physics engine, robot self-collision, realistic hair strands, or scissor actuation.
- Dedicated mobile support or production deployment.

The optional backend and multiplayer competition are no longer non-goals. They now live in
`../hcr-backend`. The simulator itself still has no required network dependency and sends no requests unless
`VITE_HCR_API_BASE_URL` is set. MQTT has been designed and specified, but the current Versus integration
uses HTTP.
