# HCR Simulator Demo 验收清单

> Phase 1–6、五关节/头部防穿模增量和自动化集成已实施。功能项按当前验证结果勾选；Phase 7 的跨浏览器人工视觉验收仍保持未勾选。`scalp-turtle` 路径编程改造的验收项从下方“Scalp Turtle”章节开始单独追踪。

## 文档基线

- [x] v0.2 作为历史规格保留。
- [x] v0.3 可独立描述目标、接口、执行语义和边界。
- [x] README 作为英文公共入口明确当前状态、中文规范文档政策并提供文档导航。
- [x] AGENTS.md 明确文档优先级、模块边界和当前阶段限制。
- [x] 实施计划包含阶段依赖、出口条件、风险与完成定义。
- [x] 本清单区分自动化、功能、错误和人工视觉验收。

## 自动化质量门

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run test:e2e`

## Scalp Turtle

> 当前产品决策：Scalp Path 是可选模式。默认 Servo Angles 保留原有绝对角度积木、编译器和工作区；切换到 Scalp Path 后才仅显示相对路径积木。两种工作区切换后均须保留，运行中不可切换。

- [x] 原 8 个 Servo Lessons 与新增 8 个 Scalp Path Lessons 同时可用；各课程目标都由本轨道参考程序生成并经可达性快照覆盖。

- [x] `hcr.v1` Program IR 快照锁定 `set-joint-angle`、`wait`、`repeat` 的可序列化结构、Repeat 展开与 500 命令上限。
- [x] 玩家 Blockly 工具箱仅显示相对海龟路径、Hover/Cut、Wait 和 Repeat，不显示可编辑 Servo/Joint Angle。
- [x] 7×12 网格全部可见，不可达/不可连通节点被禁用且不能编译进入。
- [x] 同步路径与兼容顺序 IR 在前端无头双回放中校验终态、删发集合和评分时长一致；任一差异均阻止编译。
- [x] Hover/Transit 接触头发、头部/连杆碰撞、命令溢出和 Profile 签名不匹配均会阻止执行或提交。
- [x] Practice、Session 与 Versus 的提交 payload 仍只有既有 `Program`，无需后端 schema 或 API 改动。
- [x] 冻结服务端计分参数下，默认参考海龟路径精确达到目标删发集合且最终分数 ≥ 80。认证参考路径使用 6 个高层积木和 15 条兼容 IR，在现有 `referenceProgramCost=6.25`、`referenceTimeMs=5645` 下为 82.66；未修改后端计分输入。

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
