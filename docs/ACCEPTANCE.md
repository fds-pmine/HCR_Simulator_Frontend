# HCR Simulator Demo 验收清单

> Servo Phase 1–6、五关节/头部防穿模增量和自动化集成已实施；Cutter Grid 正按 Phase 0–5 实施。功能项只在具有直接验证证据时勾选。

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

- [ ] Servo 默认选中，Cutter Grid 仅在 Practice 和专属 Lessons 可选。
- [x] 六种 Move 距离为整数 `1–12`，Move N 展开为 N 格，展开后上限为 500。
- [x] Servo/Cutter Grid Workspace 独立保留，只能在 `idle` 切换。
- [x] 编译期 IK、同步轨迹、Worker 取消和签名满足 v0.3 参数。
- [ ] 入场零接触且不计命令/耗时/成绩；Step 每次执行一格或 Wait。
- [ ] Run、Test、Step 复用同一冻结计划并产生相同终态、剪发集合和指标。
- [ ] 网格、轴向图例、当前/下一坐标、路径与阻塞节点可见且可关闭。
- [ ] Cutter Grid 只本地评分，不提交 Session/Match，不驱动 ArmDock；Versus 保持 Servo-only。
- [x] 参考程序精确剪除 12 个目标、无附带删除并取得 100 Completion。

## 自动化质量门

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run test:e2e`

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

- [ ] Chrome/Edge 1280×720 下核心控制无遮挡。
- [ ] Chrome/Edge 1920×1080 下布局不过度拉伸。
- [ ] 3D 主视图、Blockly 与指标层级清楚。
- [ ] 机械臂、当前头发、目标预览和碰撞工具容易区分。
- [ ] 非零肩部侧摆具有清晰的三维运动，运行全过程无头部穿模。

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
