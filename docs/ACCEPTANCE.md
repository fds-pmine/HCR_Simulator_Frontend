# HCR Simulator Demo 验收清单

> Servo Phase 1–6、五关节/头部防穿模增量、自动化集成、Cutter Grid 首版 Phase 0–5 与紧凑同步 PTP V4 Phase 1–6 均已实施并验收。全局多分支 IK 与限 jerk 条目仅保留为 V4 取代前的历史证据；功能项只在具有直接验证证据时勾选。

## 文档基线

- [x] v0.2 作为历史规格保留。
- [x] v0.3 可独立描述目标、接口、执行语义和边界。
- [x] README 作为英文公共入口明确当前状态、中文规范文档政策并提供文档导航。
- [x] AGENTS.md 明确文档优先级、模块边界和当前阶段限制。
- [x] 实施计划包含阶段依赖、出口条件、风险与完成定义。
- [x] 本清单区分自动化、功能、错误和人工视觉验收。
- [x] v0.3 独立定义 Cutter Grid 的模式边界、IR/Profile/轨迹契约、规划参数和 fail-closed 语义。

## Cutter Grid Phase 0 门禁

- [x] 功能分支从重新获取的最新 `origin/main` 创建，未在 `main` 落代码。
- [x] 完整 Challenge 签名覆盖关节、几何、碰撞、voxel/head、初始/目标 Hair、刀头及版本输入。
- [x] 固定方向为 Right `+X`、Left `-X`、Up `+Y`、Down `-Y`、Forward `-Z`、Backward `+Z`。
- [x] 默认 Hair 包围盒每轴扩展两格，并包含首选 Hair lattice 起点 `(0,-5,8)`。
- [x] 首选起点格心以 `0.12` 半径静止检测不接触 Hair。
- [x] 六个方向各至少存在一条不接触非目标 Hair 的轴向边。
- [x] 当前 12 个目标 voxel 均至少被一条不接触非目标 Hair 的轴向边覆盖。
- [x] 审计缓存与当前 Challenge 签名一致，并明确标记关节轨迹认证为 `pending-planner`。
- [x] 认证 Profile 证明零接触入场、启用节点分类、六方向认证边和参考程序的完整关节轨迹安全。

## Cutter Grid 功能验收

- [x] Servo 默认选中，Cutter Grid 仅在 Practice 和专属 Lessons 可选。
- [x] 六种 Move 距离为整数 `1–12`，Move N 展开为 N 格，展开后上限为 500。
- [x] Servo/Cutter Grid Workspace 独立保留，只能在 `idle` 切换。
- [x] 编译期 IK、同步轨迹、Worker 取消和签名满足 v0.3 参数。
- [x] 入场零接触且不计命令/耗时/成绩；Step 每次执行一格或 Wait。
- [x] Run、Test、Step 复用同一冻结计划并产生相同终态、剪发集合和指标。
- [x] 网格、轴向图例、当前/下一坐标、路径与阻塞节点可见且可关闭。
- [x] Cutter Grid 只本地评分，不提交 Session/Match，不驱动 ArmDock；Versus 保持 Servo-only。
- [x] 参考程序精确剪除 12 个目标、无附带删除并取得 100 Completion。

## Cutter Grid 全局多分支 IK 修复

- [x] 固定回归程序、失败 Cartesian 层、低 Wrist 静态安全分支、反向连续分支和真实 5 格扫掠基线已有自动化诊断证据。
- [x] V2 Profile、轨迹、进度和错误接口已与 V1 运行资产隔离，尚未提前切换生产入口。
- [x] 同层多解 IK、候选去重/多样性、净空与连续边验证通过确定性单元测试。
- [x] V2 Profile 至少认证两个不同原点构型及零接触入场；参考程序的几何 12 格/0 附带结果、六方向和签名门禁不退化。完整 V2 参考轨迹将在全局图实现后认证。
- [ ] `Up 6 → Left 2 → Forward 3` 以低 Wrist 分支完成至 `(-2,6,-3)`，无碰撞、无 Cartesian 抄近路，并保留 5 格真实扫掠结果。
- [ ] Run、Test、Step 选择相同入口和 V2 冻结计划，入场不计分且不同 tick 结果一致。
- [ ] UI 明确区分静态安全 IK、当前程序连通性、搜索进度和搜索预算耗尽。

## Cutter Grid 限 jerk 运动稳定（V3，历史基线）

以下 V3 项目是历史基线。V4 不再接受固定 Cartesian 管道、逐格 zero-velocity checkpoint、`1.25x` 请求或将密集认证点作为输出指令；V4 的验收项以紧随其后的章节为准。

- [x] 本地 Ruckig Community WASM Spike 已固定 `v0.19.4`/MIT、Emscripten `4.0.20` 和五关节 state-to-state ABI；Chromium/Edge module Worker 只请求本地 JS/WASM，云客户端未编译。该 Spike 尚未成为运行时规划器。
- [x] 前端 Ruckig ABI 适配器已固定五关节 `q/v/a` 输入顺序、`q/v/a/j` sample-major 输出、非有限值拒绝与错误路径内存释放；它不加载网络或 DOM，尚未接入播放器。
- [x] 纯领域 Ruckig 分段编排复用 TOPP-RA 边界，验证共享 `q/v/a`、`5ms` 采样动态限制及 `1.1x` 至 `50x` 的 fail-closed 时长扩展；调用方可注入本地空间认证，逐段检查关节范围、头部净空、固定 Cartesian 管道、`0.5°`/`voxelSize/16` 联合采样与零接触/允许接触集，并在完整玩家 Move 后聚合为精确冻结接触集合。该契约尚未接入 Worker 或当前播放器。
- [x] 纯领域 TOPP-RA 风格可达传播在固定 V3 C2 几何上确定性地产生 pause-safe `q/v/a` 边界，端点为零且所有节点不超过有效速度/加速度限制；它尚未改变运行时重定时或接触语义。
- [x] V3 Worker 以独立版本化消息报告全局 IK 图搜索、几何平滑、时间参数化、jerk 平滑和播放验证；观察进度不改变候选顺序、冻结轨迹或签名，并显示层数/真实运动段数的正确单位。
- [x] V3 rAF 回放产生有界只读遥测：每个播放帧的计划/渲染时间、`q/v/a/j`、末端、分支与单格、帧间隔和 `50ms` 长帧统计均可复核；隐藏页重锚不追赶墙钟，Inspector 默认折叠该开发信息，遥测不影响运动语义。
- [x] 前端试验的动态限制仍请求 `1.25x` 速度，但把加速度/jerk 收紧为额定速度的 `1250x`/`200000x`；全局 IK 回归中最短单格为至少 `90ms`，不再出现已记录的 `56ms` 三帧关节突跳。
- [ ] V3 Profile/Plan/诊断、签名和失败结果为纯可序列化领域数据，并有前端—Rust 共享 fixture；成功向量包含全计划签名、原子 checkpoint、接触和诊断摘要，失败向量包含结构化错误。
- [x] 前端 V3 conformance bundle 已固定认证参考程序、`Up 6 → Left 2 → Forward 3` 和缺少动态限制错误；当前 fixture 仍只在前端仓库，待 Rust 获准迁移后须由 `hcr_sim` 逐项消费验证。
- [ ] V3 保持 V2 全局选定的 IK 构型链、固定 Cartesian 路径、头部净空和 `0.12` 扫掠接触语义。
- [ ] V3 对每个固定路径使用确定性的全局 C2 五次几何样条；原子移动和系统入场均以共享 knot `q/v/a`、同一动态限制和绝对时间律回放，不得回退到 V2 C1 插值。
- [ ] 每个原子移动边界均为 `v=a=0` 的 pause-safe checkpoint；所有段满足关节速度、加速度和 jerk 硬限制，且没有角度 wrap/量化反馈跳变。
- [ ] 平滑后的完整轨迹经不超过 `5ms` 的自适应验证，保持关节限位、头部无碰撞、`voxelSize/16` Cartesian 管道及接触集合不变。
- [ ] `Up 6 → Left 2 → Forward 3` 保持低 Wrist 安全分支、终点 `(-2,6,-3)` 与既定 5 格真实扫掠结果。
- [ ] 运行/测试/逐格 Step、`30/60/90/120/144Hz`、长帧、暂停和隐藏页在相同计划时刻产生相同关节、终态与剪发集合；不再以渲染 `delta` 倍率提速。
- [ ] 默认请求 `1.25x` 的动态限制重定时，实际时长至少比同一 V2 基线路径缩短 `15%`，或明确报告硬约束限制而不超限播放。
- [ ] Rust `hcr_sim` 迁移前不启用 Cutter Grid 的后端提交、Session、Match 或 ArmDock；迁移后以共享 fixture 证明 Rust 为规划权威。

## Cutter Grid 紧凑同步 PTP（V4）

- [x] 受 Git 管理的 V4 计划、v0.3、实施计划和本清单已同步，且明确取代 V3 严格直线、逐格停车与密集输出条款。
- [x] 历史 V3 基线已由自动测试固定：全局 IK 回归有 11 个原子 Move、44 个 Cartesian 层、4,286 个认证样本、6,976ms 玩家计划时长、`1.25x` 动态请求、几何签名 `188fb68c5336a3b4` 和轨迹签名 `73549fa7dad52468`。
- [x] `CutterGridExecutableActionV2` 将 Move N 合并为一个可见 action，并保留 Repeat occurrence、Wait 和 500 逻辑成本；Step 一次完成该 Move。
- [x] V4 仅为认证入口和可见 Move 终点构建全局 IK 图；首轮/扩展候选预算分别为 `12/48` seed 和 `12/24` 保留候选，边按 `4/8/全部` 顺序确定性验证。
- [x] 直接边生成一条同步五次 PTP；碰撞时最多一个避障构型、两条 primitive，超过预算以 `motion-primitive-budget-exhausted` fail closed。
- [x] V4 默认请求 `1.5x`，每 primitive 至少 160ms；所有 `q/v/a/j`、限位、净空和自适应区间证明通过。
- [x] 剪发按实际曲线和半径 `0.12` 预认证；Run/Test/Step 回放同一冻结计划，已覆盖小 tick、长 tick、单动作 Step、入场零接触，以及 Chrome/Edge 双视口的实际曲线与 Inspector。
- [x] 独占单 Worker 五次冷启动的 `Right 2` P95 为 `1,671.8ms`（≤3s），`Up 6 → Left 2 → Forward 3` P95 为 `2,886.2ms`（≤10s）；两条回归的玩家动画均由测试限制为 ≤5s，参考程序为 `1,034ms`，且回归程序保持 3 个可见 Move、至多 6 条玩家 primitive。
- [x] 计划只序列化紧凑 primitive 与接触事件，密集认证样本不进入主线程或硬件协议。
- [x] `CutterArmMotionProgramV1` 可序列化与校验；当前 ArmDock 明确拒绝 V4，后端、Electron 下发和固件没有越权启用。

## 自动化质量门

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run test:e2e`
- [x] `npm run test:performance`：单 Worker 五次冷启动 P95 通过 `3s/10s` 门禁。
- [x] `npm run cutter-grid:audit`：114 条安全剪发边、0 个未覆盖目标、0 个缺失方向。
- [x] `npm run cutter-grid:profile`：2535 个节点、精确剪除 12 格、六方向认证。
- [x] `npm run test:visual`：实际 Chrome/Edge 的 1280×720 与 1920×1080 共 4 项通过。

## 英文运行时文案

- [x] Challenge、Blockly、工作台、日志、错误/降级界面和无障碍标签的用户可见文案均为英文，并由自动化测试覆盖关键路径。
- [x] Challenge 使用 `Neat Short Haircut`，初始发型使用 `Thick Cap Initial Hairstyle`，目标发型使用 `Symmetric Neat Crop`。
- [x] 五个关节依次显示为 `Base Yaw`、`Shoulder Roll`、`Shoulder`、`Elbow`、`Wrist`，且内部 Joint ID、Blockly 字段和 Program IR 保持不变。

## P0 闭环

- [x] 本地 Challenge 通过 Provider 加载。
- [x] Blockly 显示预置可编辑程序并能编译为 Program IR。
- [x] 工作区只有一个顶层程序栈；不通过 JavaScript Generator 或 `eval` 执行。
- [x] 五关节机械臂按 `baseYaw → shoulderRoll → shoulder → elbow → wrist` 顺序执行绝对角度和 Wait。
- [x] Blockly 与 Inspector 从 Challenge 动态显示第五关节。
- [x] 示例程序包含非零 `shoulderRoll`，安全自然结束且实际剪除 voxel。
- [x] 末端扫掠 Hair Voxel 时，逻辑集合和画面同步删除。
- [x] Run 自动重置；Reset 恢复头发、关节、指标和日志。
- [x] Stop 保留现场但不生成正式成绩。
- [x] 程序结束后输出完成度、效率、时间及最终分。
- [x] 示例程序结束后的 Voxel IoU 不低于 80%。

## 调试体验

- [x] 相机支持旋转、平移和缩放。
- [x] Pause 冻结当前命令；Resume 可继续。
- [x] Step 每次只完成一条原子命令。
- [x] 当前执行积木被高亮。
- [x] 日志记录运行、命令、碰撞、暂停、停止、完成和错误。
- [x] 可切换半透明目标发型预览。

## 错误与恢复

- [x] 空程序、多个顶层程序、非法角度和超限展开不能运行，并显示错误。
- [x] Wait、Repeat 和未知积木的非法数据不能进入执行器。
- [x] Provider 失败和 WebGL 不可用时显示可理解的错误界面。
- [x] Stop 不生成正式成绩，之后可 Reset 或重新 Run。
- [x] 运行时错误保留现场，Reset 后可恢复正常执行。
- [x] 底座、全部连杆、关节和工具不会提交进入头部的姿态。
- [x] 碰头命令停在最后安全角度、保持未完成、进入 `error` 且不生成正式成绩。
- [x] 碰撞日志说明部件、活动关节和安全角度，并保留源积木高亮。

## 人工视觉验收

- [x] Chrome/Edge 1280×720 下核心控制无遮挡。
- [x] Chrome/Edge 1920×1080 下布局不过度拉伸。
- [x] 3D 主视图、Blockly 与指标层级清楚。
- [x] 机械臂、当前头发、目标预览、网格和剪发器容易区分。
- [x] Cutter Grid 单格 Step 的五关节同步姿态、当前/下一坐标和执行/待执行路径清楚，运行全过程受碰撞复验保护。

上述视觉项由 `tests/e2e/visualAcceptance.spec.ts` 在实际 Chrome/Edge 通道生成四张截图并检查视口、溢出和核心控件；2026-08-13 对截图完成肉眼复核。截图位于被忽略的 `test-results/`，不提交构建或验收产物。

## 关键人工场景

### 场景 A：完整运行

1. 打开页面并确认本地 Challenge 与示例 Workspace 已加载。
2. 记录初始 voxel 数量并点击 Run。
3. 确认 Blockly 锁定、当前积木高亮、机械臂开始运动。
4. 等待自然结束，确认 voxel 数减少且状态为 completed。
5. 确认四项分数为有限数，Completion Score ≥80。

### 场景 B：暂停与单步

1. Run 后在关节运动中点击 Pause。
2. 确认关节、末端、命令进度和仿真时间冻结。
3. 点击 Step，确认只完成当前/下一条原子命令并回到 paused。
4. 点击 Resume，确认程序继续并可自然结束。

### 场景 C：停止与重置

1. Run 后点击 Stop。
2. 确认现场保留、正式结果不存在且 Blockly 恢复可编辑。
3. 点击 Reset，确认关节角度、Hair Set、指标和日志恢复初始状态。
4. 确认当前 Blockly 内容没有被 Reset 清空。

### 场景 D：编译错误

1. 构造空工作区、多个顶层栈或越界角度。
2. 点击 Run。
3. 确认机械臂不运动，错误信息可定位到原因或相关积木。
4. 修复程序后可以重新 Run，无需刷新页面。

### 场景 E：头部防穿模

1. 将示例程序修改为会让腕部或连杆接触头部的关节序列。
2. 点击 Run，确认机械装置停在首次接触前的最后安全姿态。
3. 确认状态为 error、危险命令未完成、后续命令未执行且没有正式成绩。
4. 确认错误日志指出碰撞部件、活动关节和安全角度，相关 Blockly 积木仍高亮。
5. 点击 Reset 或重新 Run，确认关节恢复 Challenge 初始安全姿态。
