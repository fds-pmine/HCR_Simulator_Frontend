# HCR Simulator — Class 2 Run Sheet

## 3 hours · Service Learning · Tomorrow

> This document owns the timetable and it owns the slide list. The deck is built from §8 of this sheet, and every slide number quoted in the body refers to that list. Where the sheet and the old deck disagree, the sheet wins.

---

## 0. Read this first

### 0.1 What actually happened in class 1

Class 1 did **not** finish "the curriculum". The Lessons track cannot be finished in one class and nobody did: it is 10 Cutter Grid lessons plus 8 Servo lessons, every one of them 20 sections (`src/features/tutorial/cutterGridLessons.ts:315`, `src/data/challenges/lessons.ts:254`, asserted at `tests/unit/lessons.test.ts:54`), gated strictly in order, with Servo lesson 1 locked behind the last Grid lesson (`src/features/tutorial/LessonPicker.tsx:80,115-117`). That is 360 sections. Nobody cleared it in fifty minutes.

What class 1 *did* exhaust is everything reachable **without** the gate, and that really is under an hour of material:

- **Solo Practice offline is a fixed nine-item sequence** — the eight Servo lessons in written order, then the authored challenge (`src/services/local/LocalSessionProvider.ts:31-35`). **Eight of the nine are solved by typing one or two numbers:** items 1–4 are a single X block (`lessons.ts:85,106,126,146`), items 5–7 are two blocks (`:167,188,209`), and item 9 is a single block again (`REFERENCE_SOLUTION` at `src/features/voxel/hairGenerator.ts:57-62`). Only item 8 needs six (`lessons.ts:231-238`).
- **It advances on any attempt, scored or not.** `respond` increments the index without consulting a score (`LocalSessionProvider.ts:75-93`), so pressing **Submit** nine times walks the whole sequence whether or not anything was solved.
- **The three tutorials are 25 steps total** — Cutter Grid 8, Control Modes 9, Servo Angles 8 (`src/features/tutorial/TutorialPicker.tsx:40,50,60`).
- **The authored challenge prints its own answer.** On screen it reads *"Move X · Base Yaw from 90° to 150°; keep Y, Z, B, and E at Home"* (`src/features/preferences/localization.tsx:47`).

So the correct statement to the room is: *class 1 ran out of the easy half of the app, not out of the subject.* That is fixable today, and the fix is more rounds and harder tasks, not more lessons.

### 0.2 Why two students left

They said they did not understand the cutting procedure. They were right to. Grep `src/` for sectioning, elevation, guide length, parting, taper, blending and you get **exactly one line**: `'Taper'` at `src/features/match/identity.ts:20`. It sits inside `NAME_PARTS`, the array the app draws random player display names from (`identity.ts:17-26`) — its neighbours `'Clipper'`, `'Fade'` and `'Comb'` are barbering words too, but they are not hits on any of the six terms, so a student running the grep live will see one line, not four. **There is no hairdressing content in this product.** What the app teaches is which block to drag. What cutting *is* — set subtraction, a cut box wider than the grid, overcut priced exactly like undercut — is taught nowhere. Teach A (0:10) and P3.1 (2:12) are that missing lesson, and they are the two blocks you never cut.

### 0.3 Two builds, two URLs — read this before §1

The provider set flips **all at once** on one environment variable: with `VITE_HCR_API_BASE_URL` set, the challenge provider, session provider and match provider all become HTTP (`src/services/http/config.ts:21-30`, `src/app/resolveServices.ts:36-38`). That matters more than it sounds:

- **Offline**, Solo Practice is the fixed nine-item lesson sequence and the versus challenge dropdown lists nine items.
- **Online**, Solo Practice is the server's adaptive engine over the backend bank, which is **four items** — the authored challenge plus up to three generated `Cap Trim NN%` items (`hcr-backend/crates/hcr/src/seed.rs:28-81`, names built at `crates/hcr_qbank/src/generator.rs:450`). The lessons are not in it.

Part 1 and Part 3 need the lesson sequence. Part 2 needs the server. So **run Vite twice**:

| Board label | URL | Env | Used for |
|---|---|---|---|
| **PRACTICE** | `http://<IP>:5173` | none | Parts 1 and 3 |
| **ROUND** | `http://<IP>:5174` | `VITE_HCR_API_BASE_URL` | Part 2 only |

Consequences to state out loud once, at the Break-1 switch:

- On PRACTICE the footer chip reads **OFFLINE · PRACTICE** and that is **correct**, not a fault (`localization.tsx:44-45`). On ROUND it must read **BACKEND CONNECTED**.
- A different port is a different origin, so `localStorage` is separate: the consent dialog appears again on ROUND, and everyone gets a fresh random display name (`identity.ts:15,36-39`).

### 0.4 The two structural facts that shape the whole plan

- **Versus and Solo are Servo-Angles-only.** The round workbench reads "Servo Angles Program" and offers no Cutter Grid button (`tests/e2e/versusServoOnly.spec.ts:13-16`); Solo pins the mode too (`src/features/practice/PracticeRun.tsx:217`). The ten Grid lessons the newcomers missed are not on today's critical path. Say that to them at 0:05.
- **The name on the host dropdown is not the name on the workbench.** The provider serves `neat-short-cap` as **"Neat Short Haircut"** (`src/data/challenges/defaultChallenge.ts:11`; the backend fixture agrees, `hcr-backend/crates/hcr/assets/vectors.json`), but both the workbench header and the Inspector substitute the localized name **"Crown Trim"** for that id (`src/components/layout/SimulationWorkbench.tsx:510-515`, `src/components/inspector/InspectorPanel.tsx:60-65`, string at `localization.tsx:46`). Say once: *"On my dropdown it is Neat Short Haircut. On your screen it is Crown Trim. Same thing."* Then never mention it again.

---

## 1. Pre-class checklist

### 1.1 The night before

| # | Task | Verify |
|---|---|---|
| 1 | **Rebuild the server binary from current source.** `cd /Users/jerrysu/HCR_Simulator_Frontend/hcr-backend && cargo build --release -p hcr --features hotaru --bin hcr-server` | **Not optional.** The frontend sends `X-HCR-Player-Utc-Offset-Minutes` on every match call (`src/services/http/HttpMatchProvider.ts:34`) and the server's CORS allowlist now includes it (`crates/hcr/src/hotaru_binding.rs:100-107`, applied at `:209`). An older binary omits it, the preflight fails, and **Open Room fails against the real backend**. A stale binary on disk is the single most likely way tomorrow breaks. |
| 2 | **Do not plan to use `cargo run --example serve`.** It hardcodes a dev-only signing key, loopback binding and a fixed origin list. | `crates/hcr/examples/serve.rs:33,44,59` |
| 3 | **Mint one signing key:** `openssl rand -hex 32`. Write it down; reuse it all session. | Server refuses a key under 32 bytes (`crates/hcr/src/deploy.rs:93-97`) |
| 4 | **Leave `HCR_USAGE_LOG` unset** unless ethics approval covers a classroom recording. | `hcr-backend/docs/DEPLOY.md:199,215-256` — note the path is `docs/DEPLOY.md`, not the repo root |
| 5 | **Print the three handouts (§9.1, §9.2, §9.3).** One per student for §9.1 and §9.2, one per pair for §9.3, plus spares. | |
| 6 | **Build the deck from §8.** Forty slides. | |
| 7 | **Charge the laptop, disable sleep.** All round state is in memory; a restart drops every live round. | `hcr-backend/docs/DEPLOY.md:284-285` |
| 8 | **Write the pairs down.** Each newcomer sits beside a named class-1 student. Do not improvise this in the room. | |

### 1.2 The dry run you must not skip (15 minutes, the night before)

Do this on the actual machine, in the actual browser, on the PRACTICE build. It is here because the previous version of this sheet opened the class with an exercise that could not produce the score it promised.

1. Start the PRACTICE Vite (§1.3, terminal B). Open `http://localhost:5173`.
2. Clear the consent screen. Home → **Solo Practice**.
3. Confirm the header reads **1 · First Cut** and the description reads *"Every motor starts at 90°. One X-axis command makes the first cut."* (`lessons.ts:80-81`).
4. Drag **one** `Set joint angle` block. Joint **X · Base Yaw**, angle **120**. Press **Test**.
5. Confirm the Inspector reads exactly: **Source Blocks 1 · Executed Commands 1 · Estimated Duration 0.50s · Completion 100 · Program Efficiency 100 · Time 100 · FINAL SCORE 100.0**.
6. **Write down the Current Voxels number.** It equals Target Voxels. Put that number on slide 14 and on the board tomorrow — it is the one figure in P1.1 you should read off a real machine rather than derive.
7. Press **Submit** and confirm the panel advances to **2 · Sweep Further** and the counter reads `1 done · 8 to go` (`src/features/practice/PracticePanel.tsx:56-59`).
8. Open the **ROUND** build on 5174, press Versus → Open Room, and **read the challenge dropdown**. Note how many items the backend bank actually has: the three generated items are inserted inside an `if let Some(...)`, so there may be fewer than three (`seed.rs:74-81`). Write the names you see into §5's round table.

### 1.3 In the room, before students arrive (allow 15 minutes)

```bash
# 1. Clear stale servers
lsof -nP -iTCP:18623 -sTCP:LISTEN
lsof -nP -iTCP:5173  -sTCP:LISTEN
lsof -nP -iTCP:5174  -sTCP:LISTEN
# kill anything holding those ports

# 2. LAN address
export IP=$(ipconfig getifaddr en0); echo $IP

# 3. Terminal A — backend on every interface
cd /Users/jerrysu/HCR_Simulator_Frontend/hcr-backend
HCR_SIGNING_KEY=<your 64-hex key> \
HCR_BIND=0.0.0.0:18623 \
HCR_CORS_ORIGIN=http://$IP:5174,http://localhost:5174,http://127.0.0.1:5174 \
./target/release/hcr-server

# 4. Terminal B — PRACTICE build, no backend variable
cd /Users/jerrysu/HCR_Simulator_Frontend/HCR_Simulator_Frontend
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort

# 5. Terminal C — ROUND build
cd /Users/jerrysu/HCR_Simulator_Frontend/HCR_Simulator_Frontend
VITE_HCR_API_BASE_URL=http://$IP:18623 npm run dev -- --host 0.0.0.0 --port 5174 --strictPort
```

**Four checks. All four must pass.**

```bash
curl -s -m 3 http://$IP:18623/api/v1/time                          # {"clientSentAt":0,"serverTime":...}
curl -s -o /dev/null -w '%{http_code}\n' http://$IP:5173/           # 200
curl -s -o /dev/null -w '%{http_code}\n' http://$IP:5174/           # 200
curl -si -m 3 -X OPTIONS http://$IP:18623/api/v1/matches \
  -H "Origin: http://$IP:5174" \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: X-HCR-Player-Utc-Offset-Minutes' \
  | grep -i 'access-control-allow-'                                 # must echo the origin AND list the header
```

The fourth is the one people skip and the one that bites. A plain `curl` sends no `Origin`, so it passes while every browser on the LAN is blocked. The `Access-Control-Request-Headers` line is what catches a stale binary.

**On the board, in three lines:**

```
PRACTICE   http://<IP>:5173     ← Parts 1 and 3
ROUND      http://<IP>:5174     ← Part 2 only
ROOM CODE  __ __ __ __ __ __
```

Use a **bare IPv4 address**. Do not use an mDNS name such as `laptop.local`. **[UNVERIFIED FROM THIS REPO]** — the usual reason given is Vite's `allowedHosts` default, but `vite.config.ts` in this project is 23 lines with no `server` block at all, so nothing here confirms it. Treat "use the IP" as prudence, not as a fact you can cite to a student.

### 1.4 Room-day facts to have in your head

- **Room codes are 6 characters of base32 with no `I`, no `O`, no `0`, no `1`** (`hcr-backend/crates/hcr/src/rounds.rs:111-118`). Say it out loud before the first code.
- **Anyone in the lobby can press Start.** `MatchRegistry::start` takes a room id and no player id, and performs no host check (`rounds.rs:294-310` — it slid down the file when `rematch` landed above it, so §11's older note has it about fifty lines short). Do not release the code until you are ready. The lobby says so itself (`localization.tsx:297`).
- **A room IS reused between rounds — this changed today.** The scoreboard carries a **Next round** button (`MatchScoreboard.tsx:269-280`, `data-testid="next-round"`). It reopens the round you just played: **same room code, same roster, same crews, a new hairstyle** (`MatchRegistry::rematch` at `hcr-backend/crates/hcr/src/rounds.rs:264-291`, the challenge chosen by `HcrService::rematch` at `crates/hcr/src/service.rs:676-689`; served at `POST /api/v1/matches/<id>/rematch`, routed at `binding.rs:345-347` and registered at `hotaru_binding.rs:76`; pinned at `crates/hcr/tests/rounds.rs:266-310`). Every client is still watching the closed round on a deliberately slower three-second poll, so within about three seconds they follow you back into the lobby by themselves (`RESULTS_POLL_MS` at `src/features/match/useMatch.ts:32-40`, the phase-change clear at `:131-140`) — **nobody retypes anything.** Only a finished round can be reopened; a lobby is already open and a running round would have submissions erased under the people who made them (`rounds.rs:276-278`, pinned at `tests/rounds.rs:312-330`).
- **⚠ Anyone in the room can press Next round, exactly like Start — and it wipes the scoreboard everybody is reading.** The button renders on *every* player's scoreboard, not only yours (`MatchScoreboard.tsx:269-280`), and the route takes no player header for the stated reason Start does not: the room code is the whole permission model (`binding.rs:342-347`). Reopening clears `room.entries` server-side (`rounds.rs:284`), so `match_results` errors from that instant onward (pinned at `tests/rounds.rs:302`) and **no photograph, no winner interview and no podium argument survives it.** Season points do survive — each client folds a round into its own table the moment the results land, long before anyone presses anything (`VersusRound.tsx:44-57`). Say it once at 1:15, in one sentence: *"The button marked Next round deletes the scoreboard for the whole room. Do not touch it. I will."*
- **Next round keeps the round length and the ranking metric, and cannot pin a challenge.** `rematch` replaces the phase, the challenge and the entries and never touches `state.config` (`rounds.rs:280-288`); the client posts an empty body (`src/services/http/HttpMatchProvider.ts:105-111`). So it buys you a new hairstyle at the same length under the same metric, and nothing else.
- **Press "Next round" when only the hairstyle is changing; press "Play Again" when anything else is.** Play Again still leaves the room — use it for a different round length, a different metric or a pinned challenge, all of which mean a new code. **"Back to menu" is the one to avoid**: it unmounts the component and that student's season table restarts from zero.
- **A student who missed a round can join the reopened one.** Joining is refused while a round runs, but a reopened room is a lobby again, so latecomers are back in for round two (pinned at `tests/rounds.rs:332-350`).
- **The screen changes in the closing stretch, and the threshold is different in every round length you are running.** Red edge around the whole stage, red **"Submit now"** button, pulsing chip for anyone who has not submitted — at **15 s** left in a 60-second round, **22.5 s** in a 90-second one, **30 s** in the 3-minute one. Full derivation and what to do with it: §5, *Three moments to stand back and let happen*.
- **The scoreboard reveals from last place upward and takes about four seconds** for a room of twenty, with the headline withheld until first place lands. Do not talk over it, and do not start the winner interview until it finishes.
- **The scoreboard prints the margins for you** — *"9.1 behind Crest551"*, a gold **PHOTO FINISH** badge under half a point, *"landed with 3.1s"* on a buzzer-beater. Read them; do not compute them.
- **The lobby has a Class target control, and it is set before Start.** A four-button segmented control labelled **Class target** — **Off / 40 / 60 / 80** — sits immediately under the roster, on the **same card as the crew taps** (`src/features/match/MatchLobby.tsx:146-160`; buttons carry `data-testid` `class-target-0` … `class-target-80`; the values are `CLASS_TARGETS` at `src/features/match/classTarget.ts:57`). Off is the default. It is per-client state held by whoever is hosting (`VersusRound.tsx:43,124-125`), so set it on the projector machine. When it is on, the scoreboard **opens** with a cleared/missed banner above the individual rows (`MatchScoreboard.tsx:148-165`, `data-testid="class-target"`, judged by `classTargetResult` at `classTarget.ts:38-54`).
- **After the scoreboard, students press "Play Again", never "Back to menu".** Play Again clears the room but leaves the component mounted, which is what keeps the season table and the crew assignments alive across rounds (`src/features/match/VersusRound.tsx:38-43,197`). "Back to menu" unmounts it and that student's season table restarts from zero.
- **Room capacity is 24** (`src/types/match.ts:53-63`, `maxPlayers: 24` at `:61`). The 25th join returns `ServiceError::RateLimited` (`rounds.rs:230-232`), which reaches the student as a *submission* rate-limit message that has nothing to do with submissions.
- **Latecomers cannot join a running round.** Plan around it.
- **The consent screen blocks the app on every fresh browser profile.** "Participate in the academic study" admits you immediately; "Necessary only" also admits you but is hidden behind **More settings** (`src/features/preferences/DataConsentDialog.tsx:107,119`; gate at `ResearchParticipationGate.tsx:31-33`). "Exit study" walls the app and is recoverable via "Review study".
- **Crew assignment, the crew totals and the class target are all per-client.** Crews live in the local component state of whoever taps the roster rows (`VersusRound.tsx:42,121-123`), and the class target beside them (`:43,124-125`). Assign crews and set the bar on the projector machine, and read the totals off the projector.

### 1.5 Equipment

- One laptop per student (Chrome or Edge, 1280×720 or better). Two spares for the newcomers.
- Projector plus your laptop. You host every round **from the projector machine**, because the host is a participant: `host` creates then immediately joins (`src/features/match/useMatch.ts:164-172`). **[NEEDS BUILDING]** — a read-only instructor board that does not consume a player slot.
- Whiteboard, divided before class: **URLS** · **ROOM CODE** (huge) · **CUT RULE**. The season table is now in the app; do not draw one.
- A phone stopwatch, as the fallback timer.

---

## 2. Timetable

| Clock | Min | Block | Slides |
|---|---|---|---|
| 0:00–0:10 | 10 | **Arrival gate** — PRACTICE URL, consent screen, pairs seated | 1–3 |
| 0:10–0:25 | 15 | **Teach A · The Cut Rule** — the dropouts' complaint, answered head-on | 4–13 |
| 0:25–0:35 | 10 | **P1.1 · Calibration run** — everyone reaches FINAL SCORE 100.0 | 14–15 |
| 0:35–0:55 | 20 | **P1.2 · The nine-item ladder** — timed, with extensions | 16–18 |
| 0:55–1:05 | 10 | **P1.3 · Debrief and the overcut demo** | 19–20 |
| 1:05–1:15 | 10 | **BREAK 1** — everyone switches to the ROUND URL | 21 |
| 1:15–1:25 | 10 | **P2.0 · Briefing, crews, join drill** | 22–25 |
| 1:25–1:33 | 8 | **Round 1 · Crew Blitz** (60 s) | 26 |
| 1:33–1:41 | 8 | **Round 2 · Blitz** (90 s) | 27 |
| 1:41–1:51 | 10 | **Round 3 · Accuracy** (3 min, winner interview) | 28 |
| 1:51–1:59 | 8 | **Round 4 · Efficiency** (90 s, ranked by final score) | 29 |
| 1:59–2:05 | 6 | **P2.4 · Season table, two podiums, awards** | 30 |
| 2:05–2:12 | 7 | **BREAK 2** — everyone switches back to PRACTICE | 31 |
| 2:12–2:32 | 20 | **P3.1 · The cutting procedure, taught explicitly** | 32–36 |
| 2:32–2:48 | 16 | **P3.2 · Design your own challenge** | 37–38 |
| 2:48–3:00 | 12 | **P3.3 · Pitches, verdicts, vote, close** | 39–40 |

**Total: 10+15+10+20+10+10+10+8+8+10+8+6+7+20+16+12 = 180 minutes.** No gaps, no overlaps.

---

## 3. The two new students

They missed class 1 entirely. **Do not try to catch them up on the Lessons track. It is impossible today and it is unnecessary.**

**Why impossible.** Progression is strictly linear with no skip or unlock control: each Grid lesson needs the previous one (`LessonPicker.tsx:80`) and Servo lesson 1 is locked behind the last Grid lesson (`LessonPicker.tsx:115-117`). Completion lives only in this browser's `localStorage` under `hcr.lesson-progress.v1` (`src/features/tutorial/lessonProgress.ts:1`), so a different machine means zero progress and nothing syncs to you. **[NEEDS BUILDING]** — any instructor unlock, skip, or progress sync.

**Why unnecessary.** Today's competition is Servo-only (`versusServoOnly.spec.ts:13-16`), and everything else the class does runs through Solo Practice and the Tutorials, all of which are ungated: the tutorial picker renders all three tracks with no lock state (`TutorialPicker.tsx:32-63`) and the Solo card on the home screen has no disabled state (`src/app/HomeScreen.tsx:94-103`), with the router reaching that screen unconditionally (`src/app/GameShell.tsx:127-131`).

**Their route, exactly:**

1. **0:00–0:10.** Seat each newcomer beside their named partner. Hand them the **Arm Anatomy card (§9.2)** — not a laptop — for the first two minutes.
2. **0:10–0:25.** They attend Teach A with everybody else. Say out loud that this is new to the whole room: nobody has ever been taught the cut rule, so on this block they are not behind at all. It matters.
3. **0:25–0:35.** While the room does P1.1, they run **Home → Tutorial → Control Modes**, 9 steps (`TutorialPicker.tsx:43-52`). This is the tutorial neither previous document mentioned and it is the right one: it states Home = 90°, the E-axis parking, and the live telemetry mapping in as many words (`src/features/tutorial/controlModesTutorial.ts:63-81`) — exactly the content of the Arm Anatomy card, on screen, with their partner narrating. Their partner runs P1.1 next to them and shows them the Inspector.
4. **0:35 onward.** They join P1.2 on Solo Practice at item 1 and work the ladder like everyone else. They will be two items behind by 0:55. That is fine and expected.
5. **Part 2.** They compete normally. **No handicap** — see P2.0, they are crewed with their partner instead.
6. **Part 3.** They hold the pen on the Challenge Spec Sheet. Making the veteran explain is the whole point.

**Done looks like:** by 0:35 each newcomer has finished the Control Modes tutorial and can state the Home pose (all five hardware axes at 90°) without looking.
**Fallback:** if the tutorial stalls on either machine, drop it. Hand them §9.2 and put them straight on Solo Practice item 1, whose answer is one block: **X · Base Yaw = 120°**. They lose nothing Part 2 needs.

---

## 4. Part 1 — Solo practice (0:10–1:05)

### Teach A · The Cut Rule — 0:10–0:25 (15 min) · Slides 4–13

**This block exists because two students left saying they did not understand the cutting procedure. Do not compress it.**

**Instructor does:** teach six facts from the projector with the app open on the authored challenge (dropdown name **Neat Short Haircut**, on-screen name **Crown Trim**). Demonstrate; do not assert.

1. **A haircut here is set subtraction.** The engine holds one `Set` of voxel keys (`src/features/simulation/SimulationEngine.ts:124`) and the only thing any program does to it is `delete` (the two deletion sites, `:603-604` and `:620-621`). Nothing adds a voxel back except Reset (`:540`, `:642`). There is no length, no strand, no physics. Slides 7, 9.
2. **You cannot aim at a voxel — you can only pass near one.** A cut fires when the straight segment from the tool's previous position to its current one pierces a box around the voxel, expanded on every axis by `halfVoxel + toolRadius = 0.08 + 0.12 = 0.20` (`findSweptVoxelHits`, `src/features/voxel/contactDetection.ts:8-42`, expansion at `:24`; `toolRadius: 0.12` and `size: 0.16` at `defaultChallenge.ts:90,101`). Slides 9, 11.
3. **The cut box (0.20) is wider than the lattice spacing (0.16).** One tool position therefore reaches the whole 3×3×3 neighbourhood, diagonals included. *Precision is choosing where not to go.* Slide 10.
4. **Nothing moves ⇒ nothing cuts.** Contact only fires when the end effector actually moved (`src/features/simulation/programExecutor.ts:93-95`). A stationary tool removes nothing; a **Wait** cuts nothing; re-issuing an angle the joint already holds cuts nothing. All three still cost you a command and its full duration. Slide 6. **Say this in the same breath as fact 3** — "one stop takes 27 cells" and "standing still cuts nothing" sound contradictory and are not: it is the *sweep through* a position that takes the block.
5. **Doing nothing scores zero, and over-cutting costs exactly what under-cutting costs.** Completion is the Jaccard overlap between the cut you made and the cut you were asked for (`src/features/voxel/similarity.ts:39-67`). Put the pinned table on slide 13 verbatim (`tests/unit/scoring.test.ts:21-60`):

   | Run | Completion |
   |---|---|
   | Do nothing | **0** |
   | Half the asked cut | 50 |
   | Exactly the asked cut | **100** |
   | The asked cut **plus as much again** | **50** |
   | Only hair nobody asked for | 0 |

6. **The target is measured, not designed.** The 11 crown voxels are exactly what the arm removes when driven by one block, `baseYaw → 150°` (`src/features/voxel/hairGenerator.ts:12-35`, `TRIM_KEYS` at `:36-48`, `REFERENCE_SOLUTION` at `:57-62`). 241 hair voxels initially, 230 in the target (`tests/unit/voxel.test.ts:37-38`). Every lesson target is built the same way, by running the lesson's own solution headlessly and freezing what is left standing (`src/services/local/lessonChallenges.ts:28-77`). **So when a target looks unreachable, the reading is "try a different motion", never "the app is broken."** Slides 8, 12.

**Students do:** nothing on the laptop except one thing at the end — open the challenge, toggle the Inspector's **Target Hairstyle Preview** to **Off** then **On** (`localization.tsx:120`), and say out loud what the translucent cyan voxels are. They are the hair that must **remain**, not the hair to cut. Most of the room gets this wrong the first time.

**Done looks like:** three different students, cold-called, answer: "What does doing nothing score?" → 0. "What does cutting twice as much as asked score?" → 50. "Can the tool tip sit inside a hair voxel?" → No.

**Fallback:** if the projector fails, this block runs entirely off the **Cut Rule card (§9.1)**. Read it aloud, then run the cold call.

---

### P1.1 · Calibration run — 0:25–0:35 (10 min) · Slides 14–15

**Instructor does:** write on the board *"FINAL SCORE 100.0 — not completion, final."* Then walk the room and say nothing else for eight minutes.

**Students do, exactly:**

> Home → **Solo Practice**. The header reads **1 · First Cut**.
> Drag **one** `Set joint angle` block. Joint **X · Base Yaw**. Angle **120**.
> Press **Test**.

**Exactly what appears** (every figure below is derivable from source, and you confirmed the one that is not in the §1.2 dry run):

| Inspector field | Value | Why |
|---|---|---|
| Source Blocks | **1** | one enabled non-shadow block (`src/features/blockly/programCompiler.ts:69-71`) |
| Executed Commands | **1** | |
| Estimated Duration | **0.50s** | `\|120−90\| ÷ 60 °/s = 500 ms` (`scoring.ts:95-100`; speed at `defaultChallenge.ts:33`); rendered to two decimals (`InspectorPanel.tsx:282-287`) |
| Completion | **100** | lesson 1's target *is* what `baseYaw → 120°` leaves standing (`lessons.ts:85`; `lessonChallenges.ts:36-74`), pinned at `tests/unit/lessons.test.ts:76-85` |
| Program Efficiency | **100** | `programCost = 1 + 0.25×1 = 1.25`, which is exactly `referenceProgramCost` (`scoring.ts:24-33`; `defaultChallenge.ts:115`) |
| Time | **100** | `1000 ÷ 500 × 100 = 200`, clamped to 100 (`scoring.ts:34-41`, `clampScore` at `:134-136`) |
| **FINAL SCORE** | **100.0** | `0.6×100 + 0.25×100 + 0.15×100` (`scoring.ts:42-46`; weights at `defaultChallenge.ts:110-114`) |
| Current Voxels | *= Target Voxels* | Completion 100 means the set you removed equals the set asked for, so the two tiles read the same number. Put the actual figure from your dry run on slide 14. |

**The one sentence that makes this block worth ten minutes** (slide 15): *"The reference program is a 100/100/100 program. Every extra block you add is charged against you — 40% of the final score is length and time, and no lesson in this app has ever told you that."*

**New-student variant:** they are in the Control Modes tutorial. Their partner runs the calibration beside them and narrates the Inspector. They do their own run at 0:35.

**Extension (fast finishers):** *"Get Completion 100 with Program Efficiency below 20 on purpose, then write one sentence saying what you traded."* Wrapping the block in a `Repeat` does it — `Repeat` is charged as a source block **and** for every iteration it expands to (`programCompiler.ts:69-71,73`). Collect the sentences.

**Fallback — the two real failure modes:**
- They pressed **Run** and then **Stop**. Stop clears the score outright (`SimulationEngine.stop()` runs `SimulationEngine.ts:347-356`; `this.scoreResult = undefined` is `:353`) and the Inspector says so: *"Stopped: current metrics are provisional; no official score was generated."* (`localization.tsx:162`). Fix: **Reset**, then **Test**.
- They typed 150 instead of 120. 150 is the *authored challenge's* answer and it is a strict overcut on lesson 1 — the ten-voxel band arrives at 135° and the eleventh at 145° (`lessons.ts:124-131,143-146`), so a 150° sweep removes far more than lesson 1 asks for and completion collapses. This is a useful accident: put it on the projector if it happens. It is P1.3's demo, arriving early.

---

### P1.2 · The nine-item ladder — 0:35–0:55 (20 min) · Slides 16–18

The room now works the Solo Practice sequence. **Tell them how it advances**, because nobody is told: press **Submit** to move to the next item; it advances on any attempt, scored or not (`LocalSessionProvider.ts:75-93`), and the panel counts `N done · M to go` (`PracticePanel.tsx:56-59`). Nobody can get stuck.

Announce the ladder and run a visible countdown. **Do not read the answers out.** In Solo Practice each lesson shows only its `description`, which names the joint but not the angle (`lessons.ts:81,102,123,143,163,184,205,226`, surfaced via `lessonBase` at `:330-345`) — the answer-printing `goal` field is only shown inside the gated Lessons track (`lessons.ts:271`). So these are real puzzles here.

| Item | On screen | Target of the exercise | Perfect score |
|---|---|---|---|
| 1–4 | First Cut · Sweep Further · Ten-Voxel Sweep · Find the Edge | One X block each: 120, 130, 135, 145 (`lessons.ts:85,106,126,146`). Ask *why* 135 gets a ten-voxel band and 145 gets one more. | 100 / 100 / 100 → **100.0** each |
| 5 | **5 · Elbow Band** | `Z · Elbow = 95`, then `X = 135` (`:167`). Z selects a lower three-voxel band. | Eff 50, Time 100 → **87.5** |
| 6 | **6 · Wrist Band** | `B · Wrist = 105`, then `X = 135` (`:188`). B selects the upper band. | **87.5** |
| 7 | **7 · Stop the Lower Band** | `Z = 95`, then stop `X` at **130**, not 135 (`:209`). 135 takes one extra voxel and is an overcut (`:212-213`). | **87.5** |
| 8 | **8 · Two Working Bands** | `Z 95 → X 135 → X 90 → Z 90 → B 105 → X 135` (`:231-238`). The high-water mark of the whole shipped curriculum. | Eff 16.7, Time 38.2 → **69.9** |
| 9 | **Crown Trim** (dropdown: Neat Short Haircut) | One block, `X = 150`. | **100.0** |

**The number that carries the whole afternoon is on item 8: the *perfect* answer scores 69.9.** Derive it on the projector — cost `6 + 0.25×6 = 7.5` → efficiency `1.25/7.5×100 = 16.7`; duration `83.3 + 750 + 750 + 83.3 + 200 + 750 = 2616.7 ms` → time `38.2`; final `0.6×100 + 0.25×16.7 + 0.15×38.2 = 69.9`. Then ask the room the question Part 2 and Part 3 are both built on: *"Item 8 is harder, longer and completely correct, and it scores thirty points below item 1. Is the score wrong, or is the score telling you something?"* Do not answer it. Slide 18.

**Do these two things live, on the projector, inside this block:**

- **Collision hunt (3 min).** Drive the arm into the head deliberately. The run enters status `error` and **no score is produced at all** — `fail()` never reaches `completeProgram` (`SimulationEngine.ts:439-445` vs `:1018`, `:1057`). The banner names the guilty part and the safe stop angle. Eight bodies are checked, not just the tool — base, shoulder joint, upper arm, elbow joint, forearm, wrist joint, tool shaft, end effector (`src/features/robot/headCollision.ts:57-120`, parts at `:64,71,78,85,92,99,106,113`) — and the one that stops a crown sweep is usually the **elbow**.
- **Open the Event Log.** Bottom of the workbench, timestamps every simulation event (`src/components/layout/LogDrawer.tsx:20-58`). Most students have never opened it. It is the only systematic debugging aid the app has, alongside the highlighted block.

**Extensions — this is the real content for a fast class, and it is where class 1's spare hour goes:**

- **E1 · Beat the reference on blocks.** Impossible on item 9; finding out *why* is the exercise. Prove in writing that no program can beat `programCost 1.25`.
- **E2 · Use the joint nobody has used.** `Shoulder Roll` appears in no lesson and has no servo — five servos exist and none rolls the shoulder (`defaultChallenge.ts:36-47`). Report one finding about the swept path.
- **E3 · Make `Repeat` earn its place.** Build a program where a `repeat` beats the flat equivalent. `sourceBlockCount` counts the repeat block itself (`programCompiler.ts:69-71`), so it must save more than it costs.
- **E4 · Servo/geometric conversion.** Using `servoDeg = centerDeg + direction × (geometricDeg − offsetDeg)` (`src/features/robot/servoMapping.ts:33-34`) and `baseYaw`'s mapping `{ axis: 'X', centerDeg: 90, direction: 1, offsetDeg: −45 }` (`defaultChallenge.ts:34`), compute the geometric angle for servo 150°. The app never asks this anywhere.
- **E5 · Re-derive item 8's 69.9 for item 5 and item 7.** Both are 87.5. Show why two different programs with different durations land on the same number. (Answer: both clamp Time at 100.)

**Fallback:** if more than half the room is stuck at four minutes on any one item, stop, solve it on the projector as a worked example, and move on. Do not let one item eat the block.

---

### P1.3 · Debrief and the overcut demo — 0:55–1:05 (10 min) · Slides 19–20

**Cold calls (5 min):** (1) *"Who got Completion 100 and a final under 75? What did you spend?"* (2) *"Which body part stopped your arm?"* (3) *"Why does stopping X at 130° score better than 135°, when 135 cuts more hair?"*

**The overcut demo (5 min) — the single most valuable minute of Part 1.** On the projector, on item 7:

1. Run `Z = 95`, `X = 130`. Completion 100.
2. Run `Z = 95`, `X = 135`. It cuts strictly more hair. Completion falls.
3. Say the sentence, unedited: *"It cut more hair and it scored worse. That is what your two classmates who left did not know, and nothing in this app was ever going to tell them."*

**Done looks like:** the whiteboard's CUT RULE column, in the students' own words: *cut box 0.20 > spacing 0.16 · nothing = 0 · overcut = undercut · absolute angles · nothing moves, nothing cuts · collision = no score at all.*

**Fallback:** if you are late, drop the cold calls, keep the demo. It is not optional.

---

## 5. Part 2 — Versus (1:15–2:05)

### What the app already gives you, and what it does not

**Five of the eight rules are already on the lobby screen — but only four of them are inside the Rules card, and offline only three.** The card is rendered in every lobby (`src/features/match/MatchLobby.tsx:163-206`) and holds four entries at most; the fourth renders only when `kind === 'online'` (`:196-204`), so on an offline lobby it shows three. The fifth rule is on the same screen but **outside** the card — it is `lobbyStartHint`, printed under the Start button (`MatchLobby.tsx:219-221`). What is where:

1. *(card)* Round length, **on the server clock** — *"A submission counts if the server receives it before the deadline. Your own clock is never consulted."* (`localization.tsx:287-289`; a blitz round is stated in seconds, not rounded to minutes — `roundRules.ts:59-66`, wired at `MatchLobby.tsx:55,169-176`).
2. *(card)* **Standings stay hidden** — *"Nobody learns their rank until the round closes. You may test your own program, but every official score remains sealed."* (`:290-291`).
3. *(card)* **Resubmit freely; the best attempt counts** (`:292`), with the online note that the server replays every program it scores (`:293`).
4. *(card, online only — absent on the PRACTICE build)* **Names are not verified** (`:295-296`, rendered at `MatchLobby.tsx:196-204`).
5. *(under the Start button, not in the card)* **Anyone in the room can start** (`localization.tsx:297`, rendered at `MatchLobby.tsx:219-221`).

So **do not read those five out.** Point at the card, then at the line under the Start button, and say "read them". Teach only the three the app does not say:

6. **Test is free and Test does not submit.** It is a headless run of the same engine at a fixed 16 ms tick (`src/features/simulation/headlessRun.ts:17,38-53`), so the *simulated* result does not depend on your frame rate. It is not unconditional: the loop stops after a **2000 ms wall-clock budget** (`:20,46-51`) and, per the comment at `:34-37`, a run that hits it "is simply left where it stands" — the animated ticker finishes it. Since Submit awaits the headless score before sending (`VersusRound.tsx:158-164`), a program near the 500-command ceiling (`programCompiler.ts:12`) can make your own Submit slow on a slow laptop. Short programs — everything today asks for — are unaffected. Slide 23.
7. **The resubmit gap changes with the round length.** 1000 ms for any round of 90 s or less, 2000 ms otherwise (`src/features/match/roundRules.ts:23-38`, wired at `VersusRound.tsx:98`, pinned at `tests/unit/versusSeason.test.ts:221-226`). In a blitz round you can resubmit every second.
8. **Nobody can join after Start, and there is no spectator mode.** If you miss it you sit out that round — and you become the round commentator (see the fallbacks).

### What a fast class runs out of, and the answer

**The online bank is four items:** the authored challenge plus up to three generated `Cap Trim NN%` items (`seed.rs:28-81`; names at `crates/hcr_qbank/src/generator.rs:450`). And **unpinned rounds are worse than repetitive — they are identical**: `pick_for_match` is fully deterministic and prefers the authored, non-generated item every time (`crates/hcr/src/catalog.rs:163-187`). Leaving the dropdown on "Let the server choose" (`MatchSetup.tsx:149`) serves the same hairstyle in every round.

Four challenges is not four rounds' worth of *material*, but it is four rounds' worth of *targets*, and the material comes from varying everything else. Four controls exist for that and all four are built and tested:

- **Round length: 60 s, 90 s, 2, 3 or 5 minutes** (`roundRules.ts:12-18`, rendered at `MatchSetup.tsx:106-118`, pinned at `tests/unit/versusSeason.test.ts:216-220`). The comment at `roundRules.ts:3-11` says in as many words why the short two exist: *"a class that finished the whole curriculum in under an hour does not need a longer round, it needs more rounds."* This class is that class.
- **Ranking metric: Similarity to target, or Final score.** A segmented control on the host screen, `data-testid` `rank-by-completion` / `rank-by-final` (`RANKINGS` at `roundRules.ts:49`, rendered `MatchSetup.tsx:125-139`, forwarded through the host call at `VersusRound.tsx:95-105`, `rankBy` at `:97`). Same challenge, different game.
- **Crews: tap a roster row to cycle a player A → B → C → D → none** (`src/features/match/crews.ts:30-42`, control at `MatchLobby.tsx:128-136`, pinned at `tests/unit/versusSeason.test.ts:179-214`). Crew totals **sum** rather than average, so a crew improves by getting its quietest member to submit at all (`crews.ts:13-14`), and totals render on the scoreboard (`MatchScoreboard.tsx:208-226`).
- **Class target: a co-op bar for the whole room — Off / 40 / 60 / 80.** A four-button segmented control on the **roster card**, directly under the crew taps (`CLASS_TARGETS` at `src/features/match/classTarget.ts:57`, rendered `MatchLobby.tsx:146-160`, host state `VersusRound.tsx:43,124-125`, pinned at `tests/unit/versusSeason.test.ts:238-272`). Every player must reach that **similarity** or the room misses together. The scoreboard then **opens** with the verdict above the individual rows — *"The class cleared it."* in green or *"The class missed it by 12.4"* in amber, with the lowest score in the room and the submitted count underneath (`classTargetResult` at `classTarget.ts:38-54`, rendered `MatchScoreboard.tsx:148-165` under `data-testid="class-target"`). A player who never submitted counts as **zero** (`classTarget.ts:42-44`). Set it before the round, never after.

**Next round works through the whole bank before it repeats.** A room remembers every challenge it has played and the rematch refuses all of them, not just the last one (`Room.played` at `hcr-backend/crates/hcr/src/rounds.rs`, `HcrService::rematch` in `service.rs`, `pick_for_match_excluding` in `catalog.rs`); when the bank runs out the rotation starts again, still refusing an immediate repeat, so a room never stops working. Verified live against the seeded four-item bank: four presses of Next round served **Crown Trim → Cap Trim 35% → Cap Trim 70% → Cap Trim 43%**, on one room code. **Next round still cannot pin a specific challenge** — the dropdown is the only way to choose one, and it only appears when you open a room — but you no longer need it to get four different hairstyles.

**If you finish the four rounds early, run a blitz ladder:** 60-second rounds, same four challenges cycled, alternating the ranking metric. Each one produces a winner, an argument and a fresh start, and each costs about six minutes end to end. Alternating the metric means a new room each time; if you would rather keep one code and one board line, hold the metric fixed and press **Next round** instead — that is the case the button was built for.

### Three moments to stand back and let happen

All three are new since the last version of this sheet, all three happen by themselves, and all three are spoiled by an instructor talking over them. Know what silence to leave before you are standing in it.

**1 · The screen goes red in the closing stretch.** In the last stretch of a running round the whole stage grows a breathing red edge, the roster chip of everybody who has **not** submitted starts pulsing, and the Submit button turns red and changes its word to **"Submit now"** (`isEndgame` at `src/features/match/countdown.ts:48-53`; the edge and the chips at `MatchHud.tsx:43-53`, `.endgame-edge` and `.hud.is-endgame .hud__player:not(.is-submitted)` at `src/styles.css:2528-2547`; the button at `VersusRound.tsx:215-218` → `SubmitAction.urgent` at `src/components/controls/SimulationControls.tsx:15-28`, rendered `:153-170` with the word swap at `:168`). It is screen-wide rather than a badge in a corner on purpose: the person who needs it is the one not watching the clock (`countdown.ts:35-45`).

**The thresholds are now proportional to the round**, each capped at a share of it — a third for amber, a quarter for the red stage, a sixth for the red timer (`WARNING_SHARE`, `ENDGAME_SHARE`, `CRITICAL_SHARE` at `countdown.ts:27-33`, applied at `:48-53` and `:58-70`, pinned at `tests/unit/versusSeason.test.ts:366-389`). So "thirty seconds" is the wrong number for three of today's four rounds. Work off this table:

| Round length | Timer turns amber | **Stage goes red · "Submit now"** | Timer turns red |
|---|---|---|---|
| **60 s** (Round 1) | last **20 s** | last **15 s** | last **10 s** |
| **90 s** (Rounds 2 and 4) | last **30 s** | last **22.5 s** | last **10 s** |
| **3 min** (Round 3) | last **60 s** | last **30 s** | last **10 s** |

This also fixes a real bug the blitz lengths introduced: under the old flat 60-second warning a 60-second round was amber from its very first second, so "running out of time" was the round's only state and therefore meant nothing (`countdown.ts:17-26`). Call the submitted count when the stage turns red, not off a stopwatch — every student sees that instant at the same moment you do.

**2 · The scoreboard reveals from last place upward, and it takes about four seconds.** Rows land bottom-first, ordinary places 90 ms apart, with a 750 ms beat before each of the top three; the headline and your own standing are withheld until first place lands, and until then the header reads **"Counting down the field…"** (`REVEAL_STEP_MS` and `PODIUM_BEAT_MS` at `MatchScoreboard.tsx:48-49`, `revealDelays` at `:72-82`, `useRevealed` at `:62-70` and `:126`, the withheld headline at `:136-143`, the withheld own-standing at `:180-186`, the string at `localization.tsx:319`). Every player in the room gets a row whether or not they submitted, so the row count is the roster count (`rounds.rs:457-482`).

For a room of twenty that is: **third place at 1.5 s, second at 2.3 s, first at 3.0 s, the headline at 3.4 s, and the winner's number finishing its roll-up at 3.7 s** (`ROW_IN_MS` at `MatchScoreboard.tsx:53`, `COUNT_UP_MS` at `:378`). A full room of 24 takes **4.0 s**. **Say nothing for four seconds.** It is the one place all afternoon where the app does the dramatic work for you, and it is exactly long enough to feel wrong if you fill it.

**3 · The margins are printed, so do not compute them.** Under each name the scoreboard prints the distance to the row above — *"9.1 behind Crest551"* — plus a gold **PHOTO FINISH** badge when the gap is under half a point, an exact tie included, and *"landed with 3.1s"* when the attempt arrived inside the last ten seconds (`src/features/match/margins.ts:44-76`, `PHOTO_FINISH = 0.5` at `:32`, rendered at `MatchScoreboard.tsx:343-367`, pinned at `tests/unit/versusSeason.test.ts:274-364`). The leader gets *"ahead by N"* instead. A player with no attempt gets no margin line at all and is never in a photo finish (`margins.ts:68-72`). The margin is read on whichever metric ranked the round (`margins.ts:34-35`), so in Round 4 it is a final-score gap, not a similarity one.

Two cheap things to do with them out loud. **Read a photo finish and ask what actually separated them** — the answer is that the haircut did not: the server broke the tie on efficiency, then duration, then arrival time, and printing two identical numbers one above the other would have said the opposite (`margins.ts:18-25`). And in a blitz round, **read the smallest "landed with" figure**, because somebody submitting with 0.4 s to spare is the whole story of a sixty-second round.

- **Line numbers in this sheet are a convenience, not a contract.** The versus files moved while it was being written, so a pointer may be off by ten or twenty lines. File names and symbol names are correct; search for the symbol rather than jumping to the line.

### P2.0 · Briefing, crews, join drill — 1:15–1:25 (10 min) · Slides 22–25

**Instructor does:**

1. Everyone switches to **`http://<IP>:5174`** and clears the consent dialog again. Confirm the footer chip reads **BACKEND CONNECTED** on at least four student machines.
2. Point at the lobby Rules card. Read rules 6, 7, 8 above. Slide 23.
3. **Announce the season table** (slide 25). It is in the app now, on every scoreboard: **5 / 3 / 2** for the podium, **1** for getting a submission in, **+1** for beating your own best similarity — never on your first round, because everyone's first score is a personal best by definition (`src/features/match/season.ts:46,49,51-58,75-102`, rendered under `data-testid="season-table"` at `MatchScoreboard.tsx:228-252`). It totals across rounds automatically and it is keyed by player id, so it survives every new room (`season.ts:66-74`). **Do not draw a whiteboard table. The numbers would disagree with the projector.**
4. **Announce crews instead of a handicap** (slide 24). Each newcomer and their partner are one two-person crew; the rest of the room splits into crews of two or three. Assign them by tapping names in the lobby, on the projector, in front of everyone. Say why: *"A crew's score is the sum, not the average. The fastest programmer in your crew has a direct reason to lean over and explain."* This replaces the whiteboard handicap entirely — it is public, it is in-app, and it needs no hand arithmetic.
5. **Announce the class target for Round 1** (slide 24). Say the number out loud before anyone opens an editor: *"Round one, the whole room clears 60 or nobody does. Someone who does not submit counts as zero, so the fastest thing you can do with a spare minute is help the person next to you."* You set it in the lobby, under the roster.
6. **Run one throwaway join.** Open a room, put the code on the board, everyone joins, everyone confirms they can see their own name in the roster, then everyone leaves.

**Students do:** join once, confirm their name, note their crew letter.

**Done looks like:** N names in the roster on the projector for N students, every chip reading BACKEND CONNECTED, and every player showing a crew letter rather than a `+`.

**Fallback:** if a chip reads **OFFLINE · PRACTICE** on the ROUND URL, that machine is on the wrong port or the CORS preflight is failing — and note that the app will still *look* like it works, filling the lobby with three scripted bots (`src/services/local/LocalMatchProvider.ts:65`). If the LAN is dead for everyone, go to §7.

### The four rounds — 1:25–1:59

Pin a **different challenge every round** from the dropdown (`MatchSetup.tsx:141-157`). Fill this table in during the §1.2 dry run from the names your backend actually serves.

| # | Clock | Length | Ranked by | Pin | The point |
|---|---|---|---|---|---|
| **1 · Crew Blitz** | 1:25–1:33 | **60 s** | Similarity | Neat Short Haircut (screen: *Crown Trim*) | Everyone already solved this in P1.2 item 9. Sixty seconds, one block. **Set `CLASS TARGET` to 60 in the lobby before you start**: the round is won or lost by the whole room together, and the scoreboard says so in one line. The only thing that matters is whether *everyone* got a submission in — a player who did not counts as zero, so helping your neighbour is the optimal move and is explicitly allowed. Crew totals are the tie-break story underneath. **The stage turns red with 15 seconds left** — that is your cue for the submitted count, and the chip of everyone still missing is already pulsing on the projector, so you can name them. |
| **2 · Blitz** | 1:33–1:41 | **90 s** | Similarity | Cap Trim (1st generated) | An unseen hairstyle, 90 seconds, resubmit every second (`roundRules.ts:36-38`). Nobody polishes; everybody ships. **Red stage at 22.5 seconds.** This is the round where the *"landed with 0.4s"* line under a name is worth reading aloud — in ninety seconds somebody always arrives on the buzzer. |
| **3 · Accuracy** | 1:41–1:51 | **3 min** | Similarity | Cap Trim (2nd generated) | The one long round, and **the only one today whose closing stretch is the full 30 seconds** the design was written for. Afterwards, a **2-minute winner interview**: bring them to the projector, have them show their program and name the one decision that made the difference — but start it *after* the reveal has finished, about four seconds, not over it. |
| **4 · Efficiency** | 1:51–1:59 | **90 s** | **Final score** | Cap Trim (3rd generated) | Press `rank-by-final` on the host screen. Same arm, same hairstyle, different game: *"accuracy, plus shorter and faster programs"* (`localization.tsx:308`). State this **before** the round so people choose a strategy. The margins under each name are then measured in final score rather than similarity (`margins.ts:34-35`), which is precisely the number P2.4 argues about. |

**Every round, without exception:**

- **Open the room, write the code on the board huge, wait for a full roster.** Do not release the code until you are ready to start; anyone in the lobby can press Start.
- **Which button between rounds depends on what is changing.** Next round keeps the code, the roster, the length and the metric and hands you a new hairstyle; changing the length, the metric or the pin needs Play Again and a fresh room. **On the script above, Rounds 2, 3 and 4 each change the length or the metric, so all three need a new room and a new code line.** Round 4 is the one to watch: it switches the ranking metric to Final score, and **Next round cannot carry a metric change** — press it there and you get a fourth round still ranked by Similarity, which quietly cancels the second-podium argument P2.4 is built on. Any round that wants *only* a different hairstyle is a Next round press and costs nothing. If you are running behind, hold the metric fixed and take every round after the first with Next round — same code, same board, four different hairstyles. Next round is the button for the blitz ladder and for any repeat at identical settings — which, if you are running behind, is the cheapest round you can add: no code, no retyping, no lobby drift.
- **Project the HUD during the round.** The roster shows a tick for each player who has submitted (`src/features/match/MatchHud.tsx:51-78`). That is legal to show: it reveals participation, not scores. Announce the submitted count **when the stage turns red** — 15 s in Round 1, 22.5 s in Rounds 2 and 4, 30 s in Round 3.
- **When the scoreboard opens, stop talking.** It reveals from last place upward and the winner does not land for about three seconds, four in a full room. Let it run, then read the margins off the screen.
- **Nobody presses Next round but you**, and not until you have photographed the board. See §1.4.
- **After the scoreboard, everyone presses "Play Again", not "Back to menu."** Season table and crews depend on it.

**If the bank has fewer than four items** (the generated three sit inside an `if let Some`, `seed.rs:74-81`): repeat Round 1's challenge in Round 4 and say so out loud. A repeated hairstyle ranked by Final score instead of Similarity is a genuinely different round, and being straight about it is better than a mystery. **If the bank holds only one playable item, Next round fails outright** with a bank-exhausted error rather than serving the same hairstyle twice (`catalog.rs:211`) — one more reason the §1.2 dry run counts the dropdown.

**Fallback for any round:** a student who cannot join becomes the **round commentator** — they stand at the projector and call the submitted count. Nobody sits out doing nothing.

### P2.4 · Season table, two podiums, awards — 1:59–2:05 (6 min) · Slide 30

Everything here is on the last scoreboard already. You are reading it, not computing it.

**Before you say a word: let Round 4's scoreboard reveal.** Last place upward, three seconds to the winner in a room of twenty, four in a full one, with the headline held back until first place lands. Then start. And **do not let anyone press Next round for the next six minutes** — it clears the entries server-side and every board in the room goes back to a lobby within three seconds, taking the podiums, the crew totals and the photograph with it (§1.4).

1. **The second podium — and stage it *inside Round 4's scoreboard alone*.** Every scoreboard shows the top three by the metric that did *not* decide the round, under `data-testid="other-podium"` — labelled **"Efficiency podium"** when the round was ranked by similarity, **"Accuracy podium"** when it was ranked by final score (`MatchScoreboard.tsx:188-206`, labels at `localization.tsx:309-310`). The comment at `MatchScoreboard.tsx:103-109` says it exists to settle exactly one argument. **Do not try to hold Round 3 and Round 4 side by side: Round 3's scoreboard no longer exists.** The scoreboard renders only from `session.results` (`VersusRound.tsx:184-202`) and Play Again is `actions.leave` (`:197`), so the instant anyone pressed it the previous round's results left the screen. There is no route back to them: a room still in its results phase refuses a fresh join (`rounds.rs:227-229`), and reopening it with Next round clears the entries outright (`rounds.rs:284`). So run the comparison on **one screen**: Round 4 was ranked by **Final score**, and its second podium is the **Accuracy podium** — same round, same programs, two different orderings, both in front of you. Read the official top three, then read the Accuracy podium, and ask whether they contain the same names. If they do, that student traded nothing. If they do not, ask the room: *"Is a 40-block accurate haircut better than a tidy 6-block one?"* If a **PHOTO FINISH** badge is sitting anywhere near the top, use it: two people separated by under half a point were not separated by the haircut at all — the server broke the tie on efficiency, then duration, then arrival time (`margins.ts:18-25`) — and that is the same argument one layer down. Then reveal the weights — 0.6 completion, 0.25 efficiency, 0.15 time (`defaultChallenge.ts:109-118`) — and point back at item 8's 69.9. Their answer and the app's answer are both defensible. That is the lesson, and it is the setup for Part 3. *(A cross-round comparison still needs a photograph. Shoot Round 3's scoreboard at 1:51 before anybody leaves it, and compare the photo against Round 4 on screen. Do not plan the block around a photo you might not have.)*
2. **The two marks beside the names.** A green **PB** means that player beat their own best similarity in that round; **×3** means three podium finishes in a row. Read at least one of each out loud — they are the only line on the board that says something to a student who is not winning, and the whole reason the table is there rather than a single scoreboard.
3. **The season table.** Read the top three off the projector and name the season winner. Do the arithmetic once out loud so they trust it: a win is 5, second 3, third 2, a submission 1, and +1 any round after your first in which you beat your own best similarity.
4. **One "best explanation" award**, chosen by you from the winner interview and the crew rounds.
4. **Photograph the scoreboard, before anybody touches Next round.** It shows, in one frame, every player with their margin, every crew, both podiums and the cross-round points table. It is the cheapest and most durable proof-of-coverage artifact you have — better than anything on paper, because lesson progress does not sync and never will.

**The co-op bar is now in the app.** Set it in the lobby before you start — `CLASS TARGET · Off / 40 / 60 / 80` sits under the roster on the same card as the crew taps (`src/features/match/MatchLobby.tsx:146-160`, `data-testid` `class-target-0` … `class-target-80`, values from `classTarget.ts:57`) — and the scoreboard opens with the verdict above the individual rows: *"The class cleared it."* in green, or *"The class missed it by 12.4"* in amber, with the lowest score in the room and the submitted count underneath (`classTargetResult` at `src/features/match/classTarget.ts:38-54`, rendered at `MatchScoreboard.tsx:148-165` under `data-testid="class-target"`). A player who never submitted counts as **zero**, deliberately (`classTarget.ts:42-44`): a bar that ignores whoever ran out of time would be cleared by the room abandoning its slowest member, which is the opposite of the point (`classTarget.ts:34-36`). Set it before the round, never after — it is a promise the room makes, not a result you flatter.

---

## 6. Part 3 — The cutting procedure and design your own (2:12–3:00)

Everyone switches back to **`http://<IP>:5173`** (PRACTICE) at Break 2.

### P3.1 · The cutting procedure, taught explicitly — 2:12–2:32 (20 min) · Slides 32–36

**Label the block honestly on slide 32:** *"None of the next four words appear anywhere in this software. They exist in the trade."* That is true and it is checkable — see §0.2.

| Human procedure | What a barber does | What it is here | Where they see it |
|---|---|---|---|
| **1. Section** | Divide the head into working areas and clip the rest out of the way | You cannot clip hair away — the cutter is always live. Sectioning here means **choosing a joint pose that selects a band**, then sweeping inside it | `Z · Elbow = 95°` selects the lower three-voxel band, `B · Wrist = 105°` the upper (`lessons.ts:163-167,184-188`) |
| **2. Set a guide** | Cut one small section to the finished length; everything else is matched to it | Your guide is the **reference program**: one motion that provably lands where you want. The whole shipped target was derived from one (`hairGenerator.ts:12-35,57-62`) | Solo item 9 |
| **3. Work to the guide** | Take successive sections and cut to match | Re-pose, sweep, re-pose, sweep — with an explicit **return to Home between bands**, because angles are absolute states, not relative moves | Item 8: `Z 95 → X 135 → X 90 → Z 90 → B 105 → X 135` (`lessons.ts:231-238`) |
| **4. Check and refine** | Cross-check, comb through, correct | **You cannot correct.** Cutting is irreversible inside a run; nothing adds a voxel back except Reset (`SimulationEngine.ts:540,642`). So checking happens *before* cutting: predict, then Test, then Reset | The **Step** button, the **Target Hairstyle Preview** toggle, the **Event Log** |

**The sentence to leave in their heads (slide 36):** *"A barber can always take more off. This machine cannot put it back — so every decision is made before the arm moves, and the score charges you the same for cutting too much as for cutting too little."*

**Two live exercises inside this block (6 min):**

- **Predict-then-Step (3 min).** Turn **Target Hairstyle Preview OFF**. Write down how many voxels you think your program removes. Then press **Step** repeatedly and watch **Current Voxels** count down in the Inspector (`InspectorPanel.tsx:264-269`). Compare. Most students are wrong by a factor of two — that is the 3×3×3 cut box.
- **The irreversibility drill (3 min).** Run a program that overcuts. Now try to fix it *without* pressing Reset. You cannot. Press Reset. Say why the button exists.

**Done looks like:** each pair can state one thing a human barber does that this machine cannot, and one thing this machine does that a human cannot.

**Extension — a real service-learning deliverable:** *"The spec document is wrong in four places about this procedure. Find one."* Give them `docs/HCR_Simulator_SPEC_v0.3.md` and the code. **Warn them first that the spec is written in Chinese and the rest of today is in English** — hand it only to a pair who can read it, or the twenty minutes goes on translation. The four real drifts: the spec's completion formula is the old target-overlap metric while the code uses the trim Jaccard (`similarity.ts:39-67`); the spec says sphere sweep, the code is an axis-aligned box test (`contactDetection.ts:24-42`); the count of target voxels disagrees with `TRIM_KEYS`, which has 11 (`hairGenerator.ts:36-48`); and `tests/unit/reachability.test.ts` states a different unreachable count from the committed fixture, which records `reachable: 142` of `hairVoxels: 241` (`tests/fixtures/reachability.json`). **Finding a documentation bug is a legitimate deliverable. Collect it.**

**Fallback:** if the room is flagging, cut the table to steps 1 and 4 only and keep both live exercises. The exercises carry the block.

### P3.2 · Design your own challenge — 2:32–2:48 (16 min) · Slides 37–38

**State the constraint up front so nobody is disappointed: there is no challenge editor.** The screen router has eight screens and none is one (`GameShell.tsx:25-33`), and the local challenge registry takes its definitions as a fixed constructor argument (`src/services/local/LocalChallengeProvider.ts:13-23`). **[NEEDS BUILDING]** — an in-app "capture my run as a challenge" path. The machinery genuinely exists: `buildLessonChallenge` already builds a challenge by running a program headlessly and freezing what is left standing (`lessonChallenges.ts:28-77`). No UI reaches it.

**So it runs on paper, and it is verified in the app.** That is not a downgrade — it is exactly how every shipped target was made.

**Instructor does:** hand out the **Challenge Spec Sheet (§9.3)**, one per pair. Set the rule that makes it real:

> **A challenge is only legal if you can write the program that produces it.** This is the same rule the codebase enforces on itself: `buildLessonChallenge` throws rather than ship a lesson whose solution does not complete (`lessonChallenges.ts:57-64`).

**Students do, in pairs, newcomer holding the pen:**

1. **Name it.** One line of flavour.
2. **Write the reference program** — at most **6 blocks**, actual joints, actual absolute angles.
3. **Build it and press Test.** Record Current Voxels before and after, Source Blocks, Executed Commands, Estimated Duration, and the FINAL SCORE.
4. **Declare the target — and the target is the hair left *standing*.** So your target hairstyle is the **Current Voxels reading after your run**, written down as it appears. That is exactly how the app does it: `buildLessonChallenge` runs the solution headlessly and freezes `snapshot.hairVoxels` as the new `targetHair` (`lessonChallenges.ts:66-73`). The subtraction `241 − Current Voxels` is a different number and it means something else — it is how many voxels you **removed**, and it is that number that must land inside 1–11. Say both out loud; this is the same point as the translucent cyan preview on slide 35, and it is the one pairs get backwards.
5. **Set your rubric.** Three weights summing to 1.00 — they must, or `validateScoringConfig` throws (`scoring.ts:106-115`). Then answer in one sentence: **what does your rubric reward, and who does it punish?** This is where Round 4's argument lands.
6. **The give-away test.** Does your description reveal the answer, the way the shipped one does (`localization.tsx:47`)? If yes, rewrite it.

**The legal range is 1 to 11 voxels removed, and here is where that comes from.** The calibrated Home sweep removes **at most 11** — stated twice in the source, at `hairGenerator.ts:31-32` ("this one-axis Home sweep removes 11") and `src/data/challenges/lessons.ts:35-36` ("the calibrated Home sweep removes at most 11"). Every shipped target sits inside it: item 7 asks for 2, items 5 and 6 for 3, item 8 for 6, item 3 for 10 (`lessons.ts:123-126`), item 4 and the authored challenge for 11. The figure **142** that appears in the fixture is the union of everything reachable across the *entire* joint sweep (`tests/fixtures/reachability.json`), which is not a thing any one small program can remove. **A pair told "1–142 is legal" will write a spec no six-block program can satisfy — which is precisely the hand-drawn-target failure described at `hairGenerator.ts:20-31`, where the best achievable score was worse than doing nothing.** Do not let that happen twice.

**Extensions:**

- **X1 · Break someone else's challenge.** Swap sheets. Find a *different* program that also scores 100 on their target. If you find one, their challenge has more than one answer — is that good or bad? Argue it.
- **X2 · Design an anti-challenge.** Write a challenge where the naive one-block sweep scores *worse than doing nothing*. This is not hypothetical: the old shipped starter scored 84.65 against 89.21 for running nothing at all (`hairGenerator.ts:20-31`). Reproduce that failure mode deliberately and explain it.
- **X3 · Write the missing lesson.** `wait` is never practised in Servo mode, `repeat` is never the answer to any servo lesson, and `Shoulder Roll` appears in none. Draft the 20-section outline that fixes one of those gaps.

**Fallback:** if the app is unusable, this runs **entirely on paper** with no loss — steps 1, 2, 4, 5 and 6 need no computer. Step 3 becomes "state your prediction and mark it unverified."

### P3.3 · Pitches, verdicts, vote, close — 2:48–3:00 (12 min) · Slides 39–40

**Pitches (6 min).** 45 seconds per pair at the front — 30 if there are more than eight pairs. Name, target voxel count, rubric weights, and the one sentence about who the rubric punishes. Give a live **feasibility verdict** on each as they sit down: **LEGAL** (reference program was built and tested), **UNPROVEN** (no run), **IMPOSSIBLE** (asks for more than the Home sweep can take).

**Vote (2 min).** Show of hands for the one you will build into the app for a future class.

**Close (4 min).**

- Collect: extension write-ups, spec sheets, documentation-bug findings.
- Photograph: the final scoreboard (season table, both podiums, crew totals) and the winning spec sheet.
- Announce next week: the winning student challenge gets built; the newcomers start the Cutter Grid track at their own pace from **Grid 1 · Fixed World Axes**.
- One sentence back to the two students who left: *"Cutting is set subtraction, the cut box is bigger than the grid, and over-cutting costs exactly what under-cutting costs. That was the missing lesson. Today it was the first one."*

---

## 7. Contingencies

| Failure | Signal | Do this |
|---|---|---|
| **LAN not up at 1:15** | Chip reads OFFLINE · PRACTICE on the ROUND URL | **Reorder, do not swap.** Run **P3.1 at 1:15–1:35** and **P3.2 at 1:35–1:51** on the PRACTICE build; take **Break 2 at 1:51–1:58**; run all of **Part 2 at 1:58–2:48**; run **P3.3 at 2:48–3:00**. Arithmetic: 75 (through Break 1) + 20 + 16 + 7 + 50 + 12 = **180**. The break stays roughly mid-class, the pitches still close the session, and you buy 43 extra minutes to fix the network. Slide order in §8 is unchanged; you present 32–38 before 22–31. **The two break slides then read backwards, so say this once at each break, out loud:** *"Ignore the URL printed on this slide — it is written for the normal running order and today we are running Part 3 first. At this break we **stay on PRACTICE**; at the next break **everybody moves to the ROUND URL**. The board is right, the slide is not."* |
| **LAN dead for the whole session** | `curl` to `$IP:18623` refuses, or Wi-Fi client isolation blocks student→laptop | Run **offline Versus on the PRACTICE build**. Every student hosts their own room in their own tab. **The challenge dropdown does appear offline** — it lists nine items, the authored challenge plus all eight lessons (`LocalChallengeProvider.ts:33-42`), so you can name a pinned challenge and everyone can select it. You call start and stop on a stopwatch and scores are read aloud. Season table and both podiums still render (all client-side). **Crews and the class target are useless offline** — one human per room. **And never build an award on the seconds figure offline: it is a hardcoded zero** (`LocalMatchProvider.ts:165-175` stores `ZERO_METRICS` plus `sourceBlockCount` only). Blocks are real in both modes. |
| **Backend reachable but everyone sees "Could not reach the server"** | CORS preflight returns no `access-control-allow-origin`, or no `access-control-allow-headers` | Either the IP changed / Vite moved port — re-read `$IP`, restart with corrected `HCR_CORS_ORIGIN`, always `--strictPort` — or **you are running a stale server binary** that predates the `X-HCR-Player-Utc-Offset-Minutes` allowlist entry (`hotaru_binding.rs:100-107`). Rebuild. See §1.1 row 1. |
| **More than 24 in one room** | Roster reads 24 / 24; next student gets a submission rate-limit message | Two parallel rooms on the same pinned challenge. The season table is per-client and will not merge; announce two separate tables rather than pretending otherwise. |
| **Someone starts a round early** | Joiners get "The session has already terminated" | Open a fresh room. Do not try to recover the old one, and do not release the next code until you are ready. |
| **Two rounds show the same hairstyle** | Identical target at T0 | The dropdown was left on "Let the server choose", which is deterministic (`catalog.rs:163-187`). Pin explicitly, every round. |
| **A student's season table is empty** | Their scoreboard shows no season section | They pressed "Back to menu" instead of "Play Again" after a previous round. Nothing recovers it. Their points from this round forward still accumulate. |
| **A student is walled out by the consent screen** | Door icon, "study declined" heading | "Review study" → **More settings** → "Necessary only". |
| **A student's laptop dies** | — | Round commentator at the projector; scribe in Part 3. Nobody sits idle. |
| **Fifteen minutes behind** | — | Cut in this order: Round 4 (8 min) → P1.3 cold calls (5 min) → pitches down to five pairs (3 min). **Never cut Teach A or P3.1.** Those two blocks are the answer to the actual student feedback. |
| **Fifteen minutes ahead** | — | Blitz ladder: 60-second rounds on the same four challenges, alternating `rank-by-completion` and `rank-by-final`, ~6 minutes each. The season table absorbs any number of them. |

---

## 8. Slide deck — 40 slides (proof of coverage)

| # | Title | Block |
|---|---|---|
| 1 | Session 2: three parts, three hours | Arrival |
| 2 | House rules — nicknames, plain HTTP, no grades | Arrival |
| 3 | Two URLs: PRACTICE 5173, ROUND 5174 | Arrival |
| 4 | What two classmates said, unedited | Teach A |
| 5 | The five joints: ranges, speeds, Home = 90° | Teach A |
| 6 | Absolute destinations, not turns — and nothing moves, nothing cuts | Teach A |
| 7 | A haircut here is set subtraction on 241 voxels | Teach A |
| 8 | The head: an ellipsoid you can never cut, eight bodies checked | Teach A |
| 9 | What actually removes a voxel: the swept segment and the 0.20 box | Teach A |
| 10 | 0.20 > 0.16 — one sweep takes a 3×3×3 tube | Teach A |
| 11 | You can never touch the voxel you are cutting | Teach A |
| 12 | The target was **measured, not designed** — 241 → 230, eleven voxels | Teach A |
| 13 | The score table: nothing = 0, overcut = undercut | Teach A |
| 14 | P1.1 on the board: Solo Practice → item 1 → **X = 120** → Test | P1.1 |
| 15 | Where 100/100/100 comes from: cost 1.25, 500 ms clamped, weights .6/.25/.15 | P1.1 |
| 16 | The nine-item ladder, and how Submit advances it | P1.2 |
| 17 | Collision: no score at all — read the banner, open the Event Log | P1.2 |
| 18 | **Item 8 is perfect and scores 69.9.** Is the score wrong? | P1.2 |
| 19 | The overcut demo: 130° beats 135° | P1.3 |
| 20 | The cutting procedure so far, in eight lines | P1.3 |
| 21 | BREAK — switch to the ROUND URL | Break 1 |
| 22 | Versus: five rules are already on your lobby screen | P2.0 |
| 23 | The three rules the lobby does not tell you | P2.0 |
| 24 | Crews: tap a name, A to D. Totals sum, they do not average | P2.0 |
| 25 | The season table: 5 / 3 / 2, +1 to submit, +1 for a personal best | P2.0 |
| 26 | Round 1 · Crew Blitz — 60 seconds, get everyone in | Round 1 |
| 27 | Round 2 · Blitz — 90 seconds, resubmit every second | Round 2 |
| 28 | Round 3 · Accuracy — 3 minutes, then the winner explains | Round 3 |
| 29 | Round 4 · Efficiency — same arm, ranked by **Final score** | Round 4 |
| 30 | Two podiums, one scoreboard — and the season standings | P2.4 |
| 31 | BREAK — switch back to PRACTICE | Break 2 |
| 32 | None of the next four words are in the software | P3.1 |
| 33 | Section · Guide · Work to the guide · Check | P3.1 |
| 34 | The mapping table: human procedure ↔ this machine | P3.1 |
| 35 | Predict, Step, Reset — checking happens *before* cutting | P3.1 |
| 36 | A barber can take more off. This machine cannot put it back | P3.1 |
| 37 | A challenge is only legal if you can solve it | P3.2 |
| 38 | Your target must be **1 to 11 voxels** — and why 142 is not the limit | P3.2 |
| 39 | Your rubric: what does it reward, and who does it punish? | P3.3 |
| 40 | Coverage record · Session 2 | Close |

**Slide 40 must sum to 180, including both breaks.** Use these figures: Arrival 10 · Cut Rule 15 · Solo practice 40 · Breaks 17 · Versus 50 · Cutting procedure 20 · Design your own 16 · Pitches and close 12. **10 + 15 + 40 + 17 + 50 + 20 + 16 + 12 = 180.**

---

## 9. Handouts

### 9.1 The Cut Rule card — one per student

> 1. Cutting is **deletion from a set**. It cannot be undone inside a run. Only **Reset** puts hair back.
> 2. The tool tip can **never** sit inside a hair voxel. Hair is cut by **passing near** it.
> 3. The cut box reaches **0.20** on every axis. The grid spacing is **0.16**. One sweep takes a **3 × 3 × 3** tube, diagonals included.
> 4. **Nothing moves ⇒ nothing cuts.** Standing still, waiting, and re-issuing an angle you already hold all cut nothing — and all still cost you a command and its full duration.
> 5. Score = overlap between **the cut you made** and **the cut you were asked for**. Nothing = **0**. Twice as much as asked = **50**.
> 6. Angles are **absolute destinations**. `Repeat 5 × [Set X to 120]` moves once and no-ops four times, and charges you for all five.
> 7. Hitting the head = **error, no score at all**. Not a partial score. None.
> 8. Completion is only **60%** of the final score. Blocks are 25%, simulated time is 15%.

### 9.2 The Arm Anatomy card — for the newcomers, and anyone who wants one

> Five hardware axes, all at **90° = Home**.
> **X · Base Yaw** — the sweep. 30–150°, 60°/s. This is the joint that does the cutting.
> **Y · Shoulder** — leave at 90 today. 30–150°, 45°/s.
> **Z · Elbow** — selects the **lower** working band. 17.5–162.5°, 60°/s.
> **B · Wrist** — selects the **upper** working band. 0–180°, 75°/s.
> **E** — the cutter. Parked at 90; actuation is not modelled.
> **Shoulder Roll** — simulation only. No servo, no lesson, no mapping.
> Buttons: **Test** (instant score, no animation) · **Run** · **Step** · **Stop** (*clears the score*) · **Reset** · **Submit** (advances Solo Practice; sends your program in Versus).
> Inspector: Current Voxels · Target Voxels · Source Blocks · Executed Commands · Estimated Duration · Completion · Program Efficiency · Time · FINAL SCORE.
> The screen calls the main challenge **Crown Trim**. The host's dropdown calls it **Neat Short Haircut**. Same thing.

### 9.3 The Challenge Spec Sheet — one per pair

```
CHALLENGE NAME: ______________________  AUTHORS: ______________________

1. REFERENCE PROGRAM  (the proof it can be solved — at most 6 blocks)
   Block 1: ______________   Block 4: ______________
   Block 2: ______________   Block 5: ______________
   Block 3: ______________   Block 6: ______________

2. MEASURED FROM A REAL TEST RUN
   Current Voxels before: 241        after: ______
   TARGET HAIRSTYLE = the hair left STANDING = Current Voxels after = ______
   Voxels this program removes = 241 − ______ = ______      (must be 1–11)
   Source Blocks: ____   Executed Commands: ____   Estimated Duration: ______ s
   FINAL SCORE of your own reference program: ______

3. MY RUBRIC   (the three must sum to exactly 1.00)
   completion ____  +  efficiency ____  +  time ____  = 1.00
   What does this rubric reward? _______________________________________
   Who does it punish? _________________________________________________

4. DESCRIPTION SHOWN TO THE PLAYER   (must NOT give away the answer)
   _____________________________________________________________________

5. INSTRUCTOR VERDICT:   [ ] LEGAL   [ ] UNPROVEN   [ ] IMPOSSIBLE
```

*Why 1–11: that is the count of voxels **removed**, and the calibrated Home sweep removes at most eleven. The number 142 you may have seen is everything reachable across the whole joint sweep, not what one short program can take. The **target** is the other number — the hair still standing when your program finishes.*

---

## 10. Everything still marked [NEEDS BUILDING]

Nothing in this run sheet **depends** on any of these. Each has a substitute that runs tomorrow.

| Feature | Why it is not available | Today's substitute |
|---|---|---|
| Rookie handicap column | `MatchConfig` is entirely round-wide; no per-player fields (`src/types/match.ts:35-43`) | **Do not use a handicap.** Crew each newcomer with their partner: in-app, public, sums rather than averages (`crews.ts:13-14,30-42`; `MatchLobby.tsx:128-136`) |
| Read-only instructor / projector board | No such screen; `GameShell` has eight and none is one (`GameShell.tsx:25-33`) | Host from the projector machine. The host is a participant — `host` creates then immediately joins (`useMatch.ts:164-172`) |
| Host control for `maxPlayers` | Fixed at 24 in `DEFAULT_MATCH_CONFIG` (`src/types/match.ts:53-63`), no UI | 24 is above class size. Two parallel rooms if it is ever exceeded |
| Choosing the challenge, length or metric of a **reopened** round | `rematch` takes no config and no challenge ref: it replaces the phase, the challenge and the entries and leaves `state.config` alone (`rounds.rs:280-288`), and the client posts an empty body (`HttpMatchProvider.ts:105-111`). The server picks, refusing every challenge this room has already played (`service.rs:676-689`, `catalog.rs:172-178,200-209`) | **Next round** for a repeat at identical settings; **Play Again** and a new room whenever the length, the metric or the pin changes — on today's script that is Rounds 2, 3 and 4 |
| Cutter Grid in Versus | Versus and Solo are both Servo-only (`versusServoOnly.spec.ts:13-16`; `PracticeRun.tsx:217`) | Cutter Grid stays in the Lessons and Tutorial tracks. Nothing today needs it |
| In-app challenge authoring | No editor screen; the local registry takes a fixed constructor argument (`LocalChallengeProvider.ts:13-23`). The derivation machinery exists (`lessonChallenges.ts:28-77`) but no UI reaches it | Paper spec sheet §9.3, verified by building and testing the reference program in the workbench |
| Instructor unlock / skip / progress sync for Lessons | Gating is strictly linear (`LessonPicker.tsx:80,115-117`); progress is per-browser `localStorage` (`lessonProgress.ts:1`) | Newcomers use the Tutorials and Solo Practice. Both are ungated, and Solo Practice advances on any attempt |

---

## 11. Verification notes

- **Every derived number in this sheet was recomputed from source and reproduced independently**: the endgame thresholds for each round length, the reveal timings, item 8's 69.9, the 241 → 230 → 11 voxel counts, the 0.9822 maximum normalized radius, and the 142 reachable voxels. Those are the figures you will say out loud, and they hold.
- **Line numbers are not maintained.** The versus files moved substantially while this sheet was being written — the rematch and the closing-stretch work inserted lines into `MatchScoreboard.tsx`, `MatchLobby.tsx`, `VersusRound.tsx` and `hcr-backend/crates/hcr/src/rounds.rs` — so a pointer here may be off by ten or twenty lines. File names and symbol names are correct throughout; search for the symbol rather than jumping to the line.
- **One claim is deliberately not asserted:** that Vite's `allowedHosts` rejects mDNS names. `vite.config.ts` has no `server` block, so nothing in this repository supports or contradicts it. Use the bare IP anyway.
