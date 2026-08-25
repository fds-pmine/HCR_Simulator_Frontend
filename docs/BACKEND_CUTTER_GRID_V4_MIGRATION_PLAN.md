# CAT、Cutter Grid V4 与机械校准同步计划

## 当前基线

- 前端审查基线：`a45a832`（`origin/feat/cutter-grid-control`）。
- 后端审查基线：`54a8582`（2026-08-25 拉取的 `hcr-backend/main`）。
- 固件事实：X/Y/Z/B 的协议行程为 `0…180°`，`/api/home` 为 `90°`；E 为 `45…100°`，home 同为 `90°`。
- 规格优先级仍为 `HCR_Simulator_SPEC_v0.3.md > IMPLEMENTATION_PLAN.md > ACCEPTANCE.md`。实机测量值确认后必须同步更新规格，不能只改 fixture。

最新后端已经完成 Rust V4 Profile、规划接口、紧凑 PTP、动态认证、实际扫掠和结构化错误；本计划不再把这些已存在能力列成待办。剩余边界是：CAT 会话接线、V4 权威提交，以及未测量的实体机械校准。

## 本轮已修正的前端边界

1. 在线 Practice 先创建 `programmingMode: "servo"` 的 Session，再读取第一条签名 `itemRef`。浏览器不再用一个未入库的固定首题分数自行反推 `initialTheta`。
2. 每个 Practice 响应都遵循 `next -> submit -> respond`，由后端重放分数推动 θ；服务端的 WarmupSelector 和 EAP prior 成为唯一 CAT 起点。
3. V4 Submit 尚未被后端权威评分前，Practice 只开放 Servo。不能让一个 Cutter Grid 响应进入 Servo θ，也不能显示可选模式后再禁用提交。
4. `SimulationWorkbench` 默认使用本地 Worker；只有在线 Practice 显式选择 Rust planner，并把 `NextItem.challengeVersion` 传给规划请求。Lessons、Tutorial、普通 Workbench 不会因为设置了 API URL 而意外改走网络。
5. Rust 成功响应在执行前验证完整关节集合、有限且正数的时长、运动限值、primitive 连续性、接触事件、剪除/结果体素一致性和诊断字段。仅重算 FNV 签名不能再掩盖缺字段计划。

## “死区”应怎样解释

这里有三个容易混淆的量：

| 名称 | 当前含义 | 是否可直接改 |
| --- | --- | --- |
| 固件协议行程 | X/Y/Z/B 为 `0…180°` | 不能等同于安全机械行程；协议能接收不代表连杆可安全走满 |
| Challenge 关节行程 | 当前为 X `30…150`、Y `30…150`、Z `17.5…162.5`、B `0…180` | 必须由实机端点与碰撞测量确认 |
| 头模可达死区 | 241 个头发体素中缓存测得 91 个在当前几何/行程下不可达 | 是测量结果，不是题目默认要求剪除 91 格 |

`tests/unit/reachability.test.ts` 已保证所有人工题目的 `initialHair - targetHair` 不包含死区体素。后端生成题目则从成功重放的 reference program 反推 target，确保 reference 本身 100 Completion。因此不能为“消除 91”直接放宽关节范围；第一次试验已经证明，未经测量同时改行程、offset 和 90° 起始角会令 Lesson 5 官方解撞头。

## 默认角度的正确分层

- `SERVO_LIMITS.*.homeDeg = 90` 是固件归中命令。
- `JointConfig.initialAngleDeg` 是带头模挑战的碰撞安全起始姿态，不应自动等于固件 home。
- `servo.offsetDeg` / `direction` 描述 90° 时实体连杆的几何姿态，当前仍是从旧规格迁移的占位值，不是实机测量。
- ArmDock 的 Home 按钮继续调用固件 `/api/home`；运行程序前的 prologue 则必须进入 Challenge 的安全起始姿态。两者不可复用同一个“默认角度”概念。

## Phase A — 实机校准（需要硬件测量）

每个 X/Y/Z/B 轴记录以下数据，并以一个版本化 calibration artifact 同步给前端 Challenge 和后端 catalog：

1. 90° home 时的几何角；
2. 从 90° 单轴增加 30° 后的几何角，用于确定 `direction`；
3. 不接触机械止挡、线材和头模的最小/最大安全舵机角；
4. 四轴同时 home 时的照片/姿态，以及建议的无头安全归中顺序；
5. 带头模时可作为 Challenge 开场的安全 servo 姿态。

测量后：

- 更新 `servo.offsetDeg`、`direction`、Challenge min/max/initial；
- 运行 `npm run reachability` 重建死区缓存并记录新数量；
- 重建 V1/V2/V4 Profile、V3/V4 conformance fixture 与 reference plan；
- 重放八课、默认挑战和 CAT 生成题目；任何官方解碰撞都必须回退校准或重做题目；
- Challenge/Profile/题库版本必须递增，已提交记录继续固定旧版本，禁止原地改历史难度。

阶段出口：实机端点、模拟姿态、所有官方解、可达性缓存和后端同版本 Challenge 完全一致。

## Phase B — V4 权威提交与 CAT Cutter Grid

当前 `POST /api/v1/cutter-grid/plans` 只规划，不评分、不写 Session。下一步应复用该 Rust planner 增加服务器拥有的提交路径：

1. `SubmissionCreate` 接收玩家 `CutterGridProgramV4` IR，不接收客户端 Profile、接触事件或权威轨迹；
2. 服务器用固定 `(challengeId, challengeVersion, profileSignature)` 独立规划并重放；
3. 成功后产生与 Servo 相同的 `SubmissionResult`，但 `programmingMode = "cutter-grid"`；
4. Session 创建时按 `programmingMode` 过滤 `ChallengeMeta.programmingModes`，`respond` 拒绝跨模式 submission；
5. 至少 15 个跨难度、跨 family 的 linking items 完成标定前，Servo θ 与 Cutter Grid θ 保持两套尺度；
6. 前端只有在能力元数据、Challenge version、plannerVersion 和 Profile 全匹配时才开放 Cutter Grid Submit。

阶段出口：在线 Practice 的 Cutter Grid 也走 `next -> server plan/replay -> respond`，客户端本地预览不进入 θ。

## Phase C — CAT 质量门

- 对 mastery threshold `τ` 建立题目级审计；默认 `0.5` 只能作为显式默认，不得被误称为连续分数模型。
- 记录 raw score、阈值后的 correct、θ before/after、模式与 Challenge version。
- Warmup、max items、SE termination、bank exhausted 都要有 HTTP 集成测试。
- 每个 calibrated item 必须有可解 reference 或人工 reachability 审计；不可达题目不得用于能力测量。
- 校准参数变化必须 mint 新版本；旧响应不能被新 `b/a/τ` 重解释。

## 验收命令

前端：

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run reachability
npm run cutter-grid:audit
npm run cutter-grid:profile
npm run cutter-grid:plan
```

后端：

```text
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
```

生产合并前还必须跑 TypeScript/Rust conformance bundle，并分别报告离散结果（action、primitive、cut/result voxels、错误 code）与浮点容差；不得只比较易受运行时浮点格式影响的 raw JSON hash。
