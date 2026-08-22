# HCR Simulator 前端 Demo 技术设计说明（v0.3）

> 用途：作为首个可执行 Demo 的产品定义、技术契约、实现边界与验收依据。
>
> 状态：**当前生效的文档基线**。v0.2 保留用于历史追溯；如两者冲突，以 v0.3 为准。
>
> 当前仓库阶段：**Servo 主闭环、五关节与头部防穿模以及 Cutter Grid 首版 Phase 0–5 已实现；Cutter Grid 全局多分支 IK 修复按独立阶段实施中**。
>
> 依据：v0.2、2026-07-30 计划模式确认结果及后续范围说明。

---

## 1. 一句话定义

HCR Simulator 是一个纯前端可运行的 Web 3D 编程 Demo：用户通过 Blockly 编排真实舵机语义的绝对关节角度指令，驱动 R3F / Three.js 中的程序化五关节机械臂；机械臂末端扫过 Hair Voxel 时完成剪除，整套机械装置由确定性几何约束阻止进入头部；系统基于目标发型 Voxel IoU、程序效率和确定性估算时间计算加权得分。

## 2. 目标、观众与成功标准

### 2.1 目标观众

首版面向内部研发和产品团队，用于验证：

- Blockly → Program IR → Runtime Command 的编程链路；
- 关节命令 → 正向运动学 → 程序化机械臂运动；
- 末端扫掠检测 → Hair Voxel 状态删除；
- 当前发型 → Target Hairstyle → 独立评分服务；
- 可暂停、单步和观察的确定性执行闭环；
- Local Provider 可在未来被 HTTP Provider 替换。

### 2.2 成功标准

- 无后端、无网络、无真实硬件时可以完成完整流程。
- 预置示例程序能够稳定剪除 voxel，并在自然结束后获得不低于 80 的 Completion Score。
- 相同 Challenge 和程序在不同设备上产生相同的命令数、估算时间和得分。
- Blockly、仿真、3D、voxel、评分和数据 Provider 边界清楚，可分别测试。
- Chrome / Edge 在 1280×720 与 1920×1080 下可完成核心操作。

## 3. 首版范围

### 3.1 必须实现

- React + TypeScript + Vite 单页应用。
- React Three Fiber、Three.js 与 OrbitControls。
- 一个本地 `Neat Short Haircut` Challenge，发型流程为 `Thick Cap Initial Hairstyle → Symmetric Neat Crop`。
- 程序化头部、Hair Voxel 和五关节机械臂。
- 头部不可穿透几何约束、最后安全姿态回退和碰撞错误定位。
- Blockly 绝对角度、Wait 和 Repeat 积木。
- Program IR 编译、校验、循环展开和顺序执行。
- Run、Pause、Resume、Step、Stop 和 Reset。
- 当前执行积木高亮、关节/末端状态、指标和事件日志。
- 连续末端扫掠接触检测与 Hair Voxel 删除。
- Completion、Efficiency、Time 与 Final Score。
- ChallengeProvider、ScoreProvider 及 Local 实现。
- Vitest 核心单元测试与 Playwright 关键 E2E。
- 运行时用户可见文案统一使用英文，包括 Challenge 数据、Blockly、工作台、日志、错误与无障碍标签。
- 可选 `Cutter Grid` 前端模式：玩家以固定世界轴的六方向和整数格距控制末端球，系统在执行前使用确定性 IK 生成冻结同步五关节轨迹。

### 3.2 明确不做

- 后端、账户、数据库、工作区持久化、导入导出。
- HTTP API 的真实调用或网络作为运行前提。
- ESP、真实舵机、MQTT、PWM、WebSerial、WebBluetooth。
- 通用任意 Cartesian Move、运行时 IK 或 Servo 模式中的多个舵机并发运动。Cutter Grid 只允许本文第 15 节定义的固定轴单格移动、编译期 IK 和冻结同步轨迹。
- 相对角度、条件、传感器、变量或自定义函数积木。
- 物理引擎、碰撞反弹/摩擦/滑动、机械臂自碰撞、真实发丝或剪刀开合。
- 外部 GLB / FBX 机械臂和头发资产。
- 多 Challenge、多人竞赛、手机专项适配或生产部署。

## 4. 技术栈与分层

### 4.1 技术栈

| 层级 | 技术 | 职责 |
|---|---|---|
| 应用 | React + TypeScript | 页面、组件、Provider 注入和低频状态 |
| 构建 | Vite | 开发服务器、生产构建和环境配置 |
| 3D | R3F + Three.js + Drei | 场景、相机、灯光、模型和 OrbitControls |
| 可视化编程 | Blockly | 工作区、自定义积木和结构化序列化 |
| 低频状态 | Zustand | 运行状态、Hair Set、指标、日志和 UI 开关 |
| 测试 | Vitest + Playwright | 领域单测、编译测试和主闭环 E2E |

### 4.2 数据流

```text
React Workbench
  ├── BlocklyEditor
  │       ↓
  │   ProgramCompiler
  │       ↓
  │   Program IR
  │
  ├── Simulation Controls
  │       ↓
  │   SimulationEngine
  │     ├── ProgramExecutor
  │     ├── RobotController / Forward Kinematics
  │     └── Swept Contact Detection
  │               ↓
  │          Hair Voxel State
  │
  ├── SimulatorCanvas ← engine snapshot / refs
  └── Inspector / Logs / Result
                  ↓
             ScoreProvider
```

### 4.3 强制边界

- Blockly 只能产生 Program IR，不得直接操作 Mesh、Robot Controller、Hair State 或评分。
- 3D 组件只读取仿真状态并渲染，不得实现评分和业务规则。
- UI 控件调用仿真引擎公开方法，不得直接修改关节 ref 或删除 voxel。
- 关节插值和末端位置等 60 FPS 高频数据保留在引擎/控制器实例中；React/Zustand 只接收低频快照和离散事件。
- Challenge 与 Score 必须通过接口注入；组件不得直接导入 Local Provider 内部数据。
- 所有角度、速度、尺寸、限制、颜色语义和评分参数集中定义，组件内不得散落 magic numbers。

## 5. 领域模型与序列化边界

### 5.1 通用类型

```ts
export type JointId = string;
export type VoxelKey = `${number},${number},${number}`;
export type Axis = 'x' | 'y' | 'z';
export type Vec3Tuple = readonly [number, number, number];
export type AllowedBlockType =
  | 'set-joint-angle'
  | 'wait'
  | 'repeat';

export interface VoxelCoord {
  x: number;
  y: number;
  z: number;
}
```

`VoxelKey` 由整数网格坐标以 `x,y,z` 形式生成。生产和测试代码必须共用同一组 `coordToKey` / `keyToCoord` 纯函数。

### 5.2 机械臂配置

```ts
export interface JointConfig {
  id: JointId;
  name: string;
  axis: Axis;
  minAngleDeg: number;
  maxAngleDeg: number;
  initialAngleDeg: number;
  speedDegPerSec: number;
}

export interface RobotGeometryConfig {
  basePosition: Vec3Tuple;
  shoulderHeight: number;
  upperArmLength: number;
  forearmLength: number;
  toolLength: number;
  toolRadius: number;
  collision: RobotCollisionConfig;
}

export interface RobotCollisionConfig {
  linkRadius: number;
  jointRadius: number;
  toolShaftRadius: number;
  headClearance: number;
}

export interface RobotState {
  joints: Record<JointId, number>;
}
```

UI 必须由 `JointConfig[]` 动态产生关节名称、角度范围和指标行，不允许假定数组长度。`JointConfig.name` 是英文运行时显示文案，内部 ID 与显示名必须保持分离。

### 5.3 可序列化 Challenge Definition

```ts
export interface HairstyleDefinition {
  id: string;
  name: string;
  voxels: VoxelCoord[];
}

export interface ChallengeDefinition {
  id: string;
  name: string;
  description: string;
  robotConfig: {
    joints: JointConfig[];
    geometry: RobotGeometryConfig;
  };
  voxelConfig: {
    origin: Vec3Tuple;
    size: number;
    headCenter: Vec3Tuple;
    headScale: Vec3Tuple;
  };
  initialHair: HairstyleDefinition;
  targetHair: HairstyleDefinition;
  allowedBlocks: AllowedBlockType[];
  starterWorkspace: Record<string, unknown>;
  scoring: ScoringConfig;
}
```

### 5.4 运行时 Challenge

Local Challenge Provider 负责校验 Definition，并将坐标数组规范化为运行时集合：

```ts
export interface HairstyleTarget {
  id: string;
  name: string;
  voxels: ReadonlySet<VoxelKey>;
}

export interface Challenge
  extends Omit<ChallengeDefinition, 'initialHair' | 'targetHair'> {
  initialHair: HairstyleTarget;
  targetHair: HairstyleTarget;
}
```

Provider 必须返回独立集合，避免调用方修改共享数据。Reset 从 Challenge 的初始集合创建新 `Set`。

## 6. 默认 Challenge

默认运行时显示名称固定如下；这些英文字符串属于 Challenge 的用户可见数据契约：

| 对象 | 英文显示名 |
|---|---|
| Challenge | `Neat Short Haircut` |
| 初始发型 | `Thick Cap Initial Hairstyle` |
| 目标发型 | `Symmetric Neat Crop` |

### 6.1 机械臂

| ID | 显示名 | 轴 | 角度范围 | 初始角度 | 速度 |
|---|---|---|---:|---:|---:|
| `baseYaw` | `Base Yaw` | Y | -60°～60° | -45° | 60°/s |
| `shoulderRoll` | `Shoulder Roll` | X | -45°～45° | 0° | 45°/s |
| `shoulder` | `Shoulder` | Z | -20°～100° | 45° | 45°/s |
| `elbow` | `Elbow` | Z | -135°～10° | -80° | 60°/s |
| `wrist` | `Wrist` | Z | -100°～100° | 35° | 75°/s |

首版关节按 `baseYaw → shoulderRoll → shoulder → elbow → wrist` 顺序构成嵌套链。完整旋转顺序为 `Ry(baseYaw) × Rx(shoulderRoll) × Rz(shoulder/elbow/wrist)`；`shoulderRoll = 0°` 时与原四关节平面姿态兼容。所有命令一次只驱动一个关节。

推荐默认几何参数：

| 参数 | 值 |
|---|---:|
| Shoulder Height | 0.40 |
| Upper Arm Length | 1.05 |
| Forearm Length | 0.90 |
| Tool Length | 0.35 |
| Tool Collision Radius | 0.12 |
| Link Collision Radius | 0.075 |
| Joint Collision Radius | 0.18 |
| Tool Shaft Collision Radius | 0.075 |
| Head Clearance | 0.02 |

这些值属于 Challenge 配置，而不是机械臂组件常量。实现阶段允许为满足示例程序验收而微调几何位置，但必须同步本文件、Challenge 数据和测试。

### 6.2 头部与发型

- 头部使用不可剪的圆角低多边形几何体，视觉与 Hair Voxel 分离。
- Voxel Size 默认 0.16。
- 目标短发由确定性纯函数生成，整体左右对称且非空。
- 初始厚帽型必须严格包含全部 Target Voxel，并额外包含可由示例程序扫过的外层/边缘 voxel。
- 禁止随机生成；相同配置必须得到相同坐标顺序和集合。
- 生成器测试必须断言 `target ⊂ initial`、无重复坐标、左右对称及固定 voxel 数量。

### 6.3 示例程序

- 首次加载时反序列化一个可编辑的 Blockly Workspace。
- 程序使用绝对关节角度，可包含 Wait 与 Repeat 以验证嵌套 IR。
- 程序至少包含一条非零 `shoulderRoll` 命令，并在全路径头部安全校验下自然结束。
- 程序自然结束后 Completion Score 必须不低于 80。
- 示例程序应保留可优化空间，不要求 100 分。
- 示例工作区属于 Challenge 数据，不写在 BlocklyEditor 组件中。
- 当前校准程序包含 5 个源积木/原子命令，`shoulderRoll = 15°`，参考程序成本为 6.25，参考时间为 5645ms。

## 7. Blockly 与 Program IR

### 7.1 允许的积木

| 类型 | UI 语义 | 编译结果 | 限制 |
|---|---|---|---|
| `set-joint-angle` | 英文积木：将所选 Joint 设置到绝对 Angle | Robot Command | Joint 来自 Challenge，Angle 必须在范围内 |
| `wait` | 英文积木：等待指定毫秒 | Robot Command | 0～5000ms |
| `repeat` | 英文积木：重复内部语句 | Program Node | 1～20 次 |

Blockly 积木字段、工具箱分类和 tooltip 均使用英文；Blockly 内置的 shadow number 不计入 Source Block Count。

### 7.2 Program IR

```ts
export type RobotCommand =
  | {
      type: 'set-joint-angle';
      jointId: JointId;
      angleDeg: number;
      sourceBlockId: string;
    }
  | {
      type: 'wait';
      durationMs: number;
      sourceBlockId: string;
    };

export type ProgramNode =
  | RobotCommand
  | {
      type: 'repeat';
      count: number;
      body: ProgramNode[];
      sourceBlockId: string;
    };

export interface Program {
  nodes: ProgramNode[];
  sourceBlockCount: number;
}
```

不使用 Blockly JavaScript Generator，不通过 `eval` 或动态代码执行运行程序。

### 7.3 编译规则

- 工作区必须恰好包含一个启用的顶层程序栈。
- 空工作区、多个顶层栈、未知/禁用的积木类型和空 Repeat Body 均为编译错误。
- Joint ID 必须存在于当前 Challenge，角度不得被静默 clamp。
- Wait、Repeat 字段必须为有限数值并满足约束。
- Repeat 在运行前展开为 Runtime Command 列表；展开后上限为 500。
- `sourceBlockCount` 统计全部启用、非 shadow 源积木，包括 Repeat。
- `executedCommandCount` 等于展开后原子命令数量，Repeat 本身不计入。
- Runtime Command 保留原始 `sourceBlockId`，用于高亮和日志定位。

## 8. 仿真引擎与运行状态机

### 8.1 状态

```ts
export type SimulationStatus =
  | 'loading'
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'error';
```

### 8.2 控制语义

| 操作 | 允许状态 | 行为 |
|---|---|---|
| Run | idle/completed/stopped/error | 重置仿真、重新编译、从第一条命令连续执行 |
| Pause | running | 冻结当前命令进度和仿真时间 |
| Resume | paused | 从冻结位置继续 |
| Step | idle/paused | idle 时先重置和编译；完整执行一条原子命令后回到 paused |
| Stop | running/paused | 停止执行并保留当前现场，不生成正式成绩 |
| Reset | 非 loading | 恢复初始机械臂、头发、指标与日志，保留 Blockly 内容 |

运行和暂停期间 Blockly 只读。程序自然结束后状态变为 completed，并调用 Score Provider。到达目标发型不提前结束程序；后续命令仍可能产生误剪。

### 8.3 关节命令

- 关节角度按 `speedDegPerSec` 线性插值，不使用缓动。
- 命令时长为 `abs(targetAngle - currentAngle) / speedDegPerSec`。
- 相同目标角度的命令时长为 0，但仍计入 Executed Command Count 和日志。
- Wait 不移动机械臂，也不触发静止接触检测。
- 高频插值由引擎的 `tick(deltaMs)` 推进；Pause 时不调用有效时间推进。
- 每个活动关节按最多 0.5° 子步校验头部安全约束；首次碰撞后执行 12 次二分搜索并提交最后安全角度。
- 碰撞命令不计入 Executed Command Count，后续命令不再执行，状态进入 `error` 且不生成正式成绩。
- 碰撞错误保留 Hair、关节、临时指标和当前源积木定位；Reset 或重新 Run 恢复 Challenge 初始安全姿态。

### 8.4 确定性估算时间

在执行前从 Challenge 初始关节状态顺序模拟全部 Runtime Commands：

```text
SetJointDurationMs =
  abs(targetAngle - simulatedCurrentAngle)
  / speedDegPerSec
  × 1000

EstimatedDurationMs =
  Σ SetJointDurationMs + Σ WaitDurationMs
```

该值用于 Time Score。真实墙钟、帧率、暂停和单步停留时间不计入。

## 9. 运动学、接触与 Hair State

### 9.1 正向运动学

- 世界坐标使用 Y Up。
- Base Yaw 绕 Y 轴，Shoulder Roll 绕局部 X 轴，Shoulder / Elbow / Wrist 绕各自局部 Z 轴。
- 旋转链固定为 `Ry(baseYaw) × Rx(shoulderRoll) × Rz(shoulder) × Rz(elbow) × Rz(wrist)`，后续关节使用其父级累计旋转。
- 每个关节变换顺序必须与 R3F 嵌套 Group 一致。
- 提供纯函数 `computeRobotPose(config, jointAngles)`，返回各关节和末端世界坐标，供控制器、碰撞与测试共用。
- 禁止从 Three.js Scene Graph 反向读取位置作为唯一业务事实。

### 9.2 头部防穿模

- 头部逻辑碰撞体为 `headCenter/headScale` 定义的不可穿透椭球，Hair Voxel 可剪除，Target Ghost 不参与碰撞。
- 底座、上臂、前臂和工具杆使用线段加半径的胶囊近似；关节与末端使用退化线段表示的球体。
- 检测时将胶囊线段转换到“部件半径 + Head Clearance”扩张后的椭球单位空间，计算线段到原点的最近距离。
- Challenge 加载时必须验证初始姿态安全；非法初始配置由 Provider 拒绝。
- 不实现反弹、摩擦、滑动、自动绕障、机械臂自碰撞或刚体动力学。

### 9.3 连续扫掠接触

每次有效运动 tick：

1. 保存上一个末端世界位置；
2. 推进关节角度；
3. 计算新的末端世界位置；
4. 将两点构成线段；
5. 对当前 Hair Set 做球体沿线段的扫掠重叠；
6. 一次性删除全部命中 voxel，并记录一次碰撞事件。

Sphere 与 Voxel AABB 的重叠应使用确定性几何函数。静止初始姿态、Wait 和纯相机操作不剪发。已经删除的 voxel 不重复计数或记录。

### 9.4 Hair State

- 运行时 Hair State 为 `Set<VoxelKey>`。
- 删除操作返回新集合或由 Store 的受控 action 完成。
- 渲染层根据 Hair Set 显示当前 voxel；目标预览使用独立的只读集合。
- 目标预览为半透明冷色，不参与碰撞、当前 voxel 计数或评分输入。

## 10. 评分契约

### 10.1 类型

```ts
export interface ProgramMetrics {
  sourceBlockCount: number;
  executedCommandCount: number;
  estimatedDurationMs: number;
}

export interface ScoringConfig {
  weights: {
    completion: number;
    efficiency: number;
    time: number;
  };
  referenceProgramCost: number;
  referenceTimeMs: number;
  commandWeight: number;
}

export interface ScoreResult {
  completionScore: number;
  efficiencyScore: number;
  timeScore: number;
  finalScore: number;
  programCost: number;
}

export interface ScoreInput {
  targetVoxels: ReadonlySet<VoxelKey>;
  resultVoxels: ReadonlySet<VoxelKey>;
  programMetrics: ProgramMetrics;
  scoring: ScoringConfig;
}
```

### 10.2 公式

```text
CompletionScore =
  |Target ∩ Result| / |Target ∪ Result| × 100

ProgramCost =
  SourceBlockCount
  + CommandWeight × ExecutedCommandCount

EfficiencyScore =
  min(100, ReferenceProgramCost / ProgramCost × 100)

TimeScore =
  min(100, ReferenceTimeMs / EstimatedDurationMs × 100)

FinalScore =
  0.60 × CompletionScore
  + 0.25 × EfficiencyScore
  + 0.15 × TimeScore
```

默认 `commandWeight = 0.25`。参考成本和参考时间在示例程序校准后固化到 Challenge。

### 10.3 边界规则

- 所有分项和 Final Score clamp 到 0～100。
- 内部保留完整精度，界面显示一位小数。
- `Target` 和 `Result` 同为空时 Completion 为 100；只有一方为空时为 0。
- ProgramCost 或 EstimatedDuration 为 0 时，相应分项为 100；空程序仍在编译阶段被拒绝。
- Score Provider 必须校验权重和约等于 1，非法配置返回可解释错误。
- Stop 不调用正式评分；右侧面板可显示带“临时”标识的实时 Completion。

## 11. Provider 边界

```ts
export interface ChallengeSummary {
  id: string;
  name: string;
  description: string;
}

export interface ChallengeProvider {
  listChallenges(): Promise<ChallengeSummary[]>;
  getChallenge(id: string): Promise<Challenge>;
}

export interface ScoreProvider {
  score(input: ScoreInput): Promise<ScoreResult>;
}
```

首版只提供 `LocalChallengeProvider` 和 `LocalScoreProvider`。应用组合根负责注入 Provider；其他组件只依赖接口。未来可以增加 HTTP 实现，但本版本不创建网络请求。

预留但不实现的 API 方向：

```text
GET  /api/challenges
GET  /api/challenges/:id
POST /api/score
POST /api/simulations
```

## 12. 工作台与交互

### 12.1 布局

- 单页、全视口、深色技术工作台。
- 顶栏：产品名、当前 Challenge 和连接状态“LOCAL”。
- 中心：3D Canvas，占据第一视觉层级。
- 左侧：默认展开、约 400～440px 的 Blockly 可折叠面板。
- 右侧：约 300～340px 的 Challenge、关节、指标和结果面板。
- 底部：Run / Pause / Resume / Step / Stop / Reset 工具栏。
- 日志为底部可展开抽屉，默认展示最近事件摘要。
- 所有按钮、面板标题、状态、指标、tooltip、空状态和 `aria-label` / `title` 等无障碍文案使用英文；类型、API、内部 ID 和序列化字段不因翻译改变。

1280×720 下允许面板覆盖 Canvas 边缘，但不得遮挡核心运行控制。小于目标宽度时可折叠右侧面板，不承诺手机可用性。

### 12.2 3D 场景

- 程序化机械臂使用工业灰/蓝；活动关节使用强调色。
- 当前 Hair 使用暖色不透明方块；Target Ghost 使用冷色半透明方块。
- 末端工具和碰撞范围应可辨识，但不显示真实剪刀。
- 提供环境光、方向光、地面网格与柔和阴影。
- OrbitControls 支持旋转、缩放和平移，并设置合理距离和极角限制。

### 12.3 信息与结果

右侧至少显示：

- 当前状态；
- 五个关节的当前角度；
- 末端 X/Y/Z；
- 当前/初始/目标 voxel 数量；
- Source Block Count；
- Executed Command Count；
- Estimated Duration；
- Completion / Efficiency / Time / Final Score。

程序未完成时正式成绩区域显示占位；Stop 后不得把临时指标伪装成最终成绩。

## 13. 日志与错误

### 13.1 日志事件

日志至少覆盖：

- Challenge 加载与 Reset；
- 编译成功/失败；
- Run、Pause、Resume、Step、Stop；
- 每条 Runtime Command 开始和结束；
- 碰撞删除数量；
- 程序完成和评分结果；
- Provider、WebGL 或引擎错误。

日志使用递增序号或仿真时间，不使用墙钟作为确定性排序依据。为避免无限增长，只保留最近 200 条。
所有用户可见日志消息使用英文，稳定的状态值、部件 ID 和 Source Block ID 可作为技术标识保留。

### 13.2 用户可见错误

- Challenge 加载失败：展示错误面板和重试按钮。
- WebGL 不可用：展示浏览器能力说明，不渲染空白 Canvas。
- 编译失败：保留工作区，在面板展示错误并尽可能选择/高亮相关积木。
- 运行时错误：状态进入 error，保留现场，允许 Reset 或重新 Run。
- 头部碰撞：日志包含碰撞部件、活动关节、安全角度和源积木；Blockly 保持高亮并恢复编辑。
- 非法 Challenge 配置：由 Local Provider 拒绝并报告字段位置。

上述错误标题、说明、重试/恢复操作和 WebGL 降级文案均使用英文；不得只翻译正常流程而保留中文错误或无障碍文本。

## 14. 测试与验收

### 14.1 Vitest

- Voxel key 转换和发型生成器不变量。
- IoU、效率、时间和最终评分边界。
- 五关节正向运动学的已知姿态，并验证 `shoulderRoll = 0°` 的兼容姿态与非零三维侧摆。
- 扩张椭球的外部、相切、穿入、胶囊穿越、关节球与安全间距。
- 大帧/小帧的碰撞安全边界、命令不完成、无正式评分和 Reset 恢复。
- Sphere Sweep 与 Voxel AABB 的命中、不命中、端点和多命中。
- Blockly 编译、Source Block Count、嵌套 Repeat 和 500 命令上限。
- 角度、Wait、Repeat、空程序和多顶层程序校验。
- 时间估算对关节状态的顺序更新。
- Local Challenge / Score Provider 的正常和失败路径。
- 仿真状态机的 Run、Pause、Step、Stop、Reset 和 Complete。

### 14.2 Playwright

关键闭环：

1. 页面加载一个本地 Challenge 和预置 Workspace；
2. Canvas、机械臂、Hair Voxel 和核心控制存在；
3. Run 自动重置并锁定 Blockly；
4. Pause 冻结指标，Step 完成一条命令，Resume 继续；
5. 程序结束后 voxel 数减少、状态为 completed；
6. 第五关节在 Blockly 与 Inspector 中可见，安全示例 Completion Score ≥80，四项成绩可见且为有限数；
7. Reset 恢复初始 voxel/关节并清除正式结果；
8. 故意碰头的程序停在安全姿态、进入 error、定位源积木且不显示正式成绩；
9. 空程序或非法数据能显示错误且不开始执行。
10. Challenge/发型/关节名称、Blockly、工作台、日志、错误和无障碍标签均显示英文，且关键术语与本规格一致。

### 14.3 质量门

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

人工验收见 `docs/ACCEPTANCE.md`。

## 15. Cutter Grid 可选控制模式

### 15.1 范围和隔离

- 模式 ID 为 `cutter-grid`，显示名为 `Cutter Grid`；`servo` 始终为默认模式。
- 首阶段只在 Practice 和专属 Lessons 开放。Versus、后端 Session/Program 提交、远端评分和 Electron Arm Bridge 保持 Servo-only。
- Servo 与 Cutter Grid 使用独立内存 Workspace；只允许在 `idle` 切换，切换时重置仿真但保留两侧积木内容。
- Cutter Grid 共享默认 Challenge 的初始 Hair、12 个目标剪除 voxel 及现有评分配置，但不与 Servo 分数作公平性比较。
- 未匹配已认证 Profile 的 Challenge 必须保持 Servo-only。

### 15.2 坐标和 Blockly

- 网格格距等于 `voxelConfig.size`；边界为初始 Hair 坐标包围盒每轴扩展两格，并包含认证起点。
- 固定映射为 Right `+X`、Left `-X`、Up `+Y`、Down `-Y`、Forward `-Z`、Backward `+Z`，不随相机或工具姿态变化。
- 六个 Move 积木分别接受 `1–12` 的整数距离；每格展开为一个原子动作。Wait、Repeat 分别沿用 `0–5000ms`、`1–20` 限制，展开后单格移动与 Wait 上限为 500。
- 剪发器始终启用，沿实际末端轨迹以现有 `toolRadius = 0.12` 删除全部接触 Hair；系统不绕发、不白名单删除，也不静默缩短移动。
- Step 每次执行一个单格移动或 Wait；Move N 对 `executedCommandCount` 贡献 N。

### 15.3 入场、规划和轨迹

- 从 Servo 初始姿态进入最近的、已认证零头发接触格心；当前首选 Hair lattice 为 `(0,-5,8)`。入场使用 `positioning` 状态，不剪发、不计时、不计分。
- Run/Test/Step 前进入 `planning`，在可取消 Web Worker 中对整段程序求解。相同规范化输入只生成一个冻结 `CutterTrajectoryPlanV1`，三个入口不得分别求解。
- 每格世界轴直线按末端位移不大于 `voxelSize/4` 细分；使用五关节阻尼最小二乘 IK，最大 80 次迭代、`0.1°` 数值 Jacobian、阻尼 `0.05`、单次最大 `2°` 更新、最终 `0.1°` 量化，末端误差不大于 `voxelSize/16`。
- 同方向连续段生成 C1 连续同步轨迹；转向格点切断切线。轨迹按关节速度统一拉伸，并以最大 `0.5°` 关节变化和 `voxelSize/4` 末端位移重新采样验证。
- 任一关节限位、IK 收敛、头部碰撞、路径偏差或连续性失败都在执行前定位首个来源积木并拒绝整段程序；不得执行可行前缀或在运行时重新规划。

### 15.3.1 全局多分支 IK 修复（实施中）

- 首版 `cutter-grid-dls-v1` 的单一前序构型贪心和静态 `reachable` 节点预筛选已知会错误拒绝 `Up 6 → Left 2 → Forward 3`：末端在 `(-2,6,-3)` 的第三个四分层有无碰撞低 Wrist 解，但高 Wrist 局部分支会提前走入死路。静态存在 IK 解不再等价于从任何入场姿态、沿任何程序路径均可达。
- 新版本为 `cutter-grid-ladder-v2`。它在 Worker 内为每个 Cartesian 分层保留多组无碰撞 IK 候选，并以程序兼容的认证入口作为图第 0 层，在全段路径上选择连续构型链；不得接入 ROS、MoveIt、Tesseract、后端或任意外部规划服务。
- V2 必须用 `24 → 96 → 384` 的确定性 Halton seed 累计枚举，候选按 `0.01` 归一化关节距离去重，每层以确定性最远点采样最多保留 128 个。内部候选不量化，实际执行计划在最终验证后才量化。
- V2 不得以固定归一化关节跳变阈值删除分支。相邻候选只由真实平滑插值的关节限位、头部碰撞、末端轴向路径偏差和采样连续性判定；转向、Wait 和程序端点的切线为零。
- V2 Profile 保存最多 32 个安全原点构型及各自认证的零接触入场轨迹。Run、Test 与 idle 下首次 Step 把所有入口和完整玩家路径一并规划；入场属于冻结计划且不剪发、不计命令、不计玩家耗时或成绩。
- V2 区分静态 `Safe IK known` / `No safe IK found` 与当前 `Program connected` / `Program disconnected`。候选不存在、入口不兼容、连续边不存在与有限搜索预算耗尽必须分别报告，搜索耗尽不得表述为物理不可达。

### 15.3.2 限 jerk 运动稳定试验（V3，前端验证中）

- V3 保持 V2 已选定的无碰撞 IK 构型链和玩家指定 Cartesian 轴向路径；重定时、平滑或渲染播放不得重新选择 IK 分支、缩短距离、抄近路或改变扫掠接触集合。
- V3 先在前端以纯领域函数完成确定性试验。所有规划输入、输出、诊断、签名和误差必须可序列化且不依赖 DOM、Worker 或渲染时钟；经前端回归验证后，同一领域契约迁移到 Rust `hcr_sim`，由后端成为最终路径规划权威。
- V3 Worker 在不影响冻结计划、签名或候选顺序的前提下，版本化报告 V2 图搜索以及 `geometric-smoothing`、`time-parameterization`、`jerk-smoothing`、`playback-validation` 阶段。前四个阶段以 Cartesian 层计数，后四个阶段以真实运动段（系统入场加玩家 Move）计数，使 UI 能定位不稳定发生在哪一类计算中。
- V3 Profile 为每个关节增加显式仿真速度、加速度与 jerk 硬上限；缺少任一限制时 fail closed。V3 计划保存连续内部角度、全局 C2 五次几何样条的 knot `q/v/a`、动态限制签名、实际速度比例、可按绝对时间采样的段参数、pause-safe 原子检查点和完整轨迹签名。系统零接触入场与玩家段使用同一 V3 动态限制和时间律，不得以 V2 插值回放。
- 每个原子移动边界、逻辑转角、Wait 两侧、入场起止和程序终点必须为 pause-safe checkpoint，具有零速度和零加速度。这样 Run/Test 连续回放以及 Step 的停留/恢复均不产生速度或加速度阶跃。
- 固定关节几何路径先经过速度/加速度受限的确定性重定时，再以本地逐段 state-to-state jerk 平滑生成 C2 轨迹。平滑后必须按不超过 `5ms`、`0.5°` 和 `voxelSize/16` 的联合分辨率重新验证关节限制、头部碰撞、Cartesian 管道和接触集合；任一失败均 fail closed。
- 全局最小 jerk 五次样条若在既有安全 knot 间发生关节限位 overshoot，必须保持相同 knot 序列并切换到签名可见的确定性单调 C2 约束解；不得放宽限位、缩短玩家路径或退回 V2 C1 插值。若该约束解仍不能通过 Cartesian、碰撞或接触审计，规划继续失败关闭。
- 仅允许本地实现或在 Worker 中固定版本的本地 WASM 调用。禁止 Ruckig Community intermediate-waypoint 云 API、ROS、MoveIt、Tesseract 或任何外部路径规划服务。
- 当前本地 WASM 可行性门禁固定 Ruckig Community `v0.19.4`（MIT）与 Emscripten `4.0.20`，只暴露五关节离线 state-to-state `q/v/a` ABI，构建时排除 cloud client，并以 Chromium/Edge Worker 的端点和本地请求测试审计。它只是独立 Spike，未完成固定路径的连续边界状态、完整碰撞/接触回归前不得接入运行时规划。
- 前端纯领域预备层已在固定 C2 几何上执行保守的 TOPP-RA 风格速度/加速度前向/后向可达传播，并输出确定性 path speed 及 `q/v/a` 边界；原子起止保持零速度/零加速度。它不改变几何或接触，并且在与本地 Ruckig、完整验证器接通前不是运行时轨迹来源。
- 前端纯领域 Ruckig 分段编排已把相邻 TOPP-RA 边界作为完全共享的 state-to-state `q/v/a` 输入，以 `5ms` 或更密采样验证端点与动态限制；失败只增加同一段的最小时长（`1.1x`，累计不超过 `50x`）。它在 Worker 资产加载和完整几何/接触认证完成前不是运行时轨迹来源。
- 动画提速是规划输入而非渲染时钟倍率：默认请求 `1.25x`，实际速度、加速度和 jerk 分别受 V3 硬上限 clamp，实际时长和比例写入计划并参与计分/签名。禁止把每帧 `delta` 或冻结轨迹时钟直接相乘。
- 渲染以单调的绝对计划时间采样冻结轨迹；隐藏页、暂停和调试时冻结计划时间，恢复时不追赶墙钟。接触、评分与原子动作事件由计划扫掠区间驱动，不依赖某个中间渲染帧是否出现。
- V3 前端在每个实际播放 rAF 后以有界、只读的诊断环记录渲染时间、计划时间、阶段/单格、入口分支、解析的五关节 `q/v/a/j`、控制器关节/末端跟踪误差及帧间隔。长帧阈值为 `50ms`；诊断副本不参与 Worker、轨迹签名、碰撞或评分，Inspector 默认折叠显示其摘要。

### 15.3.3 Rust 迁移边界

- 前端 V3 仅是验证和可视化实现，不是最终规划权威。稳定后在 `hcr-backend/crates/hcr_sim` 实现相同的纯 Rust V3 领域规划器；后端 API、Session、Match 与实体机械臂桥接在 Rust 规划器完成、跨语言向量一致且另行授权前保持现状。
- 前端与 Rust 必须共享版本化 JSON fixture：输入 Challenge、已引用的版本化 Profile fixture、Program 和动态限制；每个成功向量输出完整 V3 计划的轨迹/几何签名、原子检查点、预计接触集合及诊断摘要，失败向量输出结构化错误。为避免重复存储每 `5ms` 认证样本，fixture 可省略完整 waypoint 数组，但 Rust 必须重建完整计划并匹配签名和所有摘要字段。任何浮点容差、枚举顺序、量化规则和签名字段改变都必须先更新 fixture 并在两端通过。
- UI 只消费可序列化 V3 计划并作绝对时间显示；它不得以浏览器特有状态修补或改变 Rust 规划结果。

### 15.4 版本化边界

- `CutterGridProgramV1` 是独立、可序列化的玩家 IR，包含 `plannerVersion`、方向、距离、Wait/Repeat 和 `sourceBlockId`；它不扩展或伪装当前后端 Servo Program IR。
- `CutterGridProfileV1` 的完整签名覆盖关节顺序/范围/初始值/速度/Servo 映射、机械臂和碰撞尺寸、voxel/head 几何、完整初始/目标 Hair、刀头半径、Profile 与规划器版本。
- `CutterTrajectoryPlanV1` 保存单格同步 waypoints、每关节同步速度、逻辑坐标、预计剪发集合、预计时间和稳定轨迹签名；角度量化到 `0.1°`，时间使用整数毫秒，速度以六位小数稳定序列化，集合稳定排序。执行器以冻结的角度和速度作 Hermite 回放，不在运行时重新规划。
- 内部 IK waypoint 不计玩家命令数；预计时间按冻结同步轨迹加 Wait 计算。Cutter Grid 完成后只使用本地评分器。
- 过渡期内 V1 Profile、V1 轨迹和 V1 签名不得被 V2 Worker 接受；V2 运行资产必须使用独立 `CutterGridProfileV2`、`CutterTrajectoryPlanV2`、入口 ID 和覆盖入场的稳定签名。Servo Program IR、后端 wire schema、Session/Match、Versus 和 ArmDock 不变。

### 15.5 启用门禁

- Phase 0 几何审计只证明有限网格、`0.12` 接触半径、六方向安全边及 12 个目标覆盖不存在直接矛盾；其 `trajectoryCertification` 必须保持 `pending-planner`。
- 只有后续规划器生成认证起点、零接触入场、可达节点/边和参考程序，并证明参考程序精确剪除 12 个目标、无附带删除且 Completion 为 100，入口才可启用。
- 任一门禁失败时停止启用，不修改共享 Challenge、刀头半径或安全余量换取通过。

## 15. 未来扩展 / 仍未决定

以下内容不影响首版实现，不得在首版中提前固化：

- 正式机械臂型号、真实舵机误差与加速度；
- 相对角度、并发关节、传感器和高级 Blockly；
- Target Hairstyle 的正式创作工具与题库格式；
- 最终竞赛评分权重、最优程序和难度公式；
- 多 Challenge、双人竞赛和 CAT / Dynamic QBank；
- 后端正式协议、鉴权与数据存储；
- 真实 ESP / MQTT 接入；
- 物理引擎、碰撞响应、机械臂自碰撞和更大规模 voxel 优化。

这些能力只能通过新增配置、接口实现或版本化协议扩展，不得破坏首版 Program IR、Provider 和 Score Result 的既有语义。
