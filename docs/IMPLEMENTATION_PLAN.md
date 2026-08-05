# HCR Simulator Demo 实施计划

> 本文记录分阶段实施状态。Phase 1–6、五关节/头部防穿模增量、自动化集成与质量门已完成；Phase 7 仅剩跨浏览器人工视觉验收。2026-08 起，`scalp-turtle` 分支按主路径 `docs/SCALP_GRID_PATH_PROGRAMMING_PLAN.md` 实施头皮网格路径编程改造；该改造保持 `hcr.v1` Program IR 与后端提交接口不变。

## 1. 实施原则

- 按“纯领域逻辑 → Provider → Blockly → 仿真 → 3D → 工作台 → E2E”的依赖顺序推进。
- 每个阶段先建立可测试契约，再连接 UI。
- 优先保证一个 Challenge 的完整、确定性闭环，不提前扩充产品范围。
- 所有阶段持续遵守 `AGENTS.md` 和 v0.3 规格。

## 2. 目标工程结构

```text
src/
├── app/
│   ├── App.tsx
│   └── providers.tsx
├── components/
│   ├── layout/
│   ├── controls/
│   ├── inspector/
│   └── result/
├── features/
│   ├── blockly/
│   │   ├── BlocklyEditor.tsx
│   │   ├── blockDefinitions.ts
│   │   ├── programCompiler.ts
│   │   └── workspaceFactory.ts
│   ├── robot/
│   │   ├── RobotModel.tsx
│   │   ├── RobotController.ts
│   │   ├── headCollision.ts
│   │   └── kinematics.ts
│   ├── voxel/
│   │   ├── VoxelHair.tsx
│   │   ├── hairGenerator.ts
│   │   ├── contactDetection.ts
│   │   └── similarity.ts
│   ├── simulation/
│   │   ├── SimulationEngine.ts
│   │   ├── programExecutor.ts
│   │   ├── simulationStore.ts
│   │   └── SimulatorCanvas.tsx
│   └── scoring/
│       ├── scoring.ts
│       └── types.ts
├── services/
│   ├── contracts.ts
│   └── local/
│       ├── LocalChallengeProvider.ts
│       └── LocalScoreProvider.ts
├── data/challenges/
├── types/
│   └── domain.ts
├── main.tsx
└── styles.css

tests/
├── unit/
└── e2e/
```

目录可在不破坏模块边界的前提下小幅调整；不要为首版建立路由、后端或通用插件系统。

## 3. 分阶段任务

### Phase 8 — Scalp Turtle 路径编程

- [x] 建立 `hcr.v1` Program IR 快照基线，确认路径模式只能导出既有 `set-joint-angle`、`wait`、`repeat`。
- [x] 建立 7×12 头皮网格、静态安全姿态 Profile 和几何签名校验；完整网格保持可渲染，已认证的 3×9 连通安全补丁可供后续路径编译使用。
- [x] 实现相对海龟 Blockly 积木、Scalp Program 编译、兼容 IR 导出和 500 命令上限；路径计划和旧 IR 在领域层独立，编辑器切换留待工作台集成阶段。
- [x] 实现多关节同步轨迹、连续碰撞/接触验证和同步/顺序双回放等价校验；同步插值以兼容 IR 时长为准，角度与末端位移共同细分，Hover/Transit 接触和回放差异均会阻止编译。
- [ ] 集成网格可视化、Hover/Cut 状态、路径教学、Practice/Versus 提交和端到端验收。

阶段出口：玩家界面不暴露可编辑关节角度；已认证路径可安全驱动真实机械臂动画、剪除 voxel，并以未修改的 `Program` 提交给现有后端。

### Phase 0 — 文档基线

- [x] 保留 v0.2 历史规格。
- [x] 建立可独立阅读的 v0.3 规格。
- [x] 建立根 README 和 AGENTS.md。
- [x] 建立实施计划与验收清单。
- [x] 明确当前阶段不创建代码和依赖。

### Phase 1 — 工程与质量门

- [x] 创建 React + TypeScript + Vite 工程。
- [x] 安装 R3F、Three.js、Drei、Blockly、Zustand。
- [x] 配置 ESLint、Vitest、jsdom 和 Playwright。
- [x] 提供 `dev`、`typecheck`、`lint`、`test`、`build`、`test:e2e` 命令。
- [x] 建立应用入口、全局样式和测试初始化。

阶段出口：空应用可以启动和构建，全部质量命令存在。

### Phase 2 — 领域模型、Challenge 与评分

- [x] 实现 v0.3 中的 domain types、VoxelKey 转换和配置校验。
- [x] 实现确定性目标短发生成器和初始厚帽型生成器。
- [x] 建立唯一 Challenge Definition、机械臂配置和示例 Workspace 数据，并固定 `Neat Short Haircut`、`Thick Cap Initial Hairstyle`、`Symmetric Neat Crop` 英文显示名。
- [x] 实现 ChallengeProvider / ScoreProvider 接口与 Local 实现。
- [x] 实现 IoU、Program Cost、时间估算和加权评分。
- [x] 覆盖集合不变量、Provider 与评分边界单测。

阶段出口：不依赖 React 或 Three.js 即可加载 Challenge 并得到确定性评分。

### Phase 3 — Blockly 与 Program IR

- [x] 注册使用英文标签与 tooltip 的绝对关节、Wait 和 Repeat 积木。
- [x] 根据 Challenge 动态建立关节下拉框、角度验证和工具箱。
- [x] 实现预置 Workspace 的反序列化。
- [x] 实现单顶层栈校验和结构化 Program IR 编译。
- [x] 实现 Repeat 展开、500 原子命令限制和 Source Block ID 保留。
- [x] 覆盖空程序、多顶层、字段越界、嵌套 Repeat 和计数规则单测。

阶段出口：示例 Workspace 可编译为稳定、可检查的 Runtime Command 列表，不执行动态 JavaScript。

### Phase 4 — 机械臂、仿真和碰撞

- [x] 实现纯正向运动学函数和已知姿态测试。
- [x] 增加 `shoulderRoll` 并将旋转链升级为五关节完整三维正向运动学。
- [x] 实现 RobotController 的当前角度、目标角度和线性推进。
- [x] 建立机械装置胶囊/球体与扩张头部椭球的确定性安全约束。
- [x] 以最多 0.5° 子步和 12 次二分搜索停在最后安全姿态。
- [x] 实现 Sphere Sweep / Voxel AABB 连续接触检测。
- [x] 实现 Program Executor 与 SimulationEngine 状态机。
- [x] 实现 Run、Pause、Resume、Step、Stop、Reset 和完成回调。
- [x] 实现 Hair Set 删除、指标累积、日志上限和评分触发。
- [x] 覆盖帧率无关剪发/头部碰撞、暂停冻结、单步边界、错误定位和 Reset 单测。

阶段出口：无 UI 时可用注入 delta 的测试完整运行程序，并得到命中集合和 ScoreResult。

### Phase 5 — R3F 场景

- [x] 创建 Canvas、相机、灯光、地面和 OrbitControls。
- [x] 使用嵌套 Group 渲染程序化五关节机械臂和 X 轴肩部万向环。
- [x] 使用当前 Hair Set 渲染可删除 voxel。
- [x] 渲染不可剪头部、末端工具和可切换 Target Ghost。
- [x] 在 `useFrame` 中推进引擎并更新高频 refs。
- [x] 增加 WebGL 不可用的降级错误界面。

阶段出口：机械臂动画、Hair 删除和目标预览与引擎状态一致，3D 组件不包含业务评分。

### Phase 6 — 工作台与调试交互

- [x] 建立 3D 主视图、左 Blockly、右 Inspector、底部控制和日志抽屉。
- [x] 连接 Challenge 加载、状态机控制和 Blockly 只读状态。
- [x] 实现当前 Block 高亮和相关编译错误定位。
- [x] 展示关节、末端、voxel、程序指标和结果分解。
- [x] 实现面板折叠、键盘焦点、按钮禁用和 1280×720 降级布局。
- [x] 统一工作台、Blockly、日志、错误、降级界面与无障碍标签的英文文案，并使用 `Base Yaw`、`Shoulder Roll`、`Shoulder`、`Elbow`、`Wrist` 关节显示名。
- [x] 校准含非零 `shoulderRoll` 的安全示例程序，使其自然结束且 Completion Score ≥80。

阶段出口：人工可以完成从加载、运行、调试到评分和重置的完整流程。

### Phase 7 — 集成测试与交付

- [x] 完成 Playwright 主闭环、错误流程和英文运行时文案断言。
- [ ] 在 Chrome / Edge 的目标视口人工验收。
- [x] 运行全部质量门并修复失败。
- [x] 按实际工程更新 README 启动说明和验收清单。
- [x] 确认没有后端、硬件、持久化或部署依赖。

阶段出口：`docs/ACCEPTANCE.md` 全部适用项通过。

## 4. 关键实现约定

### 仿真与 React

- `SimulationEngine` 是长期存在的可测试实例，不在 React render 中反复创建。
- R3F `useFrame` 只调用引擎 tick 和更新 Group refs。
- Zustand 存储状态枚举、Hair Set、低频关节快照、指标、日志和 UI 开关。
- 高频角度与末端位置以控制器为权威；向 UI 发布快照时限频。

### Blockly

- Workspace 由编辑器组件拥有，通过显式 API 提供 `compile`、`setReadOnly`、`highlightBlock` 和 `resetHighlight`。
- 编译器只接收 Blockly Workspace 与 Challenge 配置，返回成功结果或结构化错误。
- UI 不遍历 Block 来自行生成命令。
- 积木字段、工具箱分类和 tooltip 使用英文；翻译不得改变 Blockly 类型、字段名或 Program IR。

### 接触

- 运动 tick 先取得 previous position，再推进关节并取得 current position。
- 碰撞函数无副作用，只返回命中的 VoxelKey。
- SimulationEngine 统一删除 voxel、更新计数和写日志。
- 头部安全约束在 RobotController 提交每个角度子步前执行，渲染层不得覆盖结果。
- 头部碰撞命令保持未完成，SimulationEngine 进入 `error`、保留现场且不触发评分。

### 评分

- 评分输入为不可变快照。
- LocalScoreProvider 只调用纯评分函数。
- UI 只格式化 ScoreResult，不重算任何分项。

## 5. 风险与处理

| 风险 | 处理 |
|---|---|
| 示例机械臂路径误剪 Target | 将初始额外层与目标层留出碰撞半径安全间距，并用确定性集成测试校准 |
| 低帧率漏碰撞 | 使用线段扫掠而非只检测当前帧端点 |
| 机械装置穿入头部 | 对全部连杆、关节和工具执行扩张椭球约束，并对子步边界二分回退 |
| Blockly 版本 API 变化 | 把注册、序列化和编译封装在 feature 内，不让版本细节扩散 |
| 每帧 React 更新造成卡顿 | 高频状态留在引擎/ref，UI 快照限频 |
| E2E WebGL 不稳定 | 主断言读取可见状态和业务结果，3D 视觉由人工验收补充 |
| 重复运行结果不一致 | Run 强制从 Challenge 初始状态重建，时间分使用指令估算 |

## 6. 最终交付定义

- v0.3 规格中的首版范围全部实现。
- 示例程序自然结束、至少删除一个 voxel，Completion Score ≥80。
- 所有自动化质量门通过。
- 1280×720 和 1920×1080 人工验收通过。
- 文档与实际行为一致，没有保留已解决的首版 TBD。
- 不包含明确非目标功能或隐式网络依赖。
