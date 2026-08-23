# Cutter Grid V4 紧凑同步 PTP 实施计划

## 状态与范围

- 状态：Phase 1–4 已完成；Phase 5 待开始。
- 规划器版本：`cutter-grid-compact-ptp-v4`。
- 本计划取代 V3 中“每个逻辑格严格 Cartesian 直线、每格零速停车、密集姿态轨迹可作为输出”的运动契约。V3 文档、测试和 fixture 保留为历史基线。
- Servo、后端 wire schema、Session、Match、Versus、Electron 下发和固件均不在 V4 前端实施范围内。
- 当前 ArmDock 必须拒绝 V4。未来只有支持本地五关节同步插值、完整关节映射和实机认证的控制器才可消费 V4 的紧凑硬件程序。

## 已确认的 V4 契约

- 方向和距离仍是固定世界轴、整数格距的用户输入；每个 Move 的最终逻辑格心是硬约束，中间末端路径不是直线硬约束。
- Move N 作为一个连续可见叶子动作规划和执行；其命令成本仍是 N。Repeat 展开为稳定的动作 occurrence，Wait 保持独立叶子动作，全部逻辑成本上限仍是 500。
- Step 执行一个展开后的 Move 或 Wait；Move N 不在内部格点停车。Run、Test 和 Step 使用同一冻结 V4 计划。
- 刀头半径保持 `0.12`，按最终实际曲线的真实扫掠删除 Hair Voxel；Worker 在执行前生成确定性接触事件和预计结果集合。
- 运动默认采用 1 条同步五关节 PTP primitive；直接 PTP 与现有头部碰撞时最多允许 1 个避障构型，即每个 Move 最多 2 条 primitive。超出预算必须失败。
- 默认动态请求是额定 `1.5×`。所有速度、加速度和 jerk 仍受 Profile 硬上限约束；每个 primitive 最短 `160ms`。
- 认证密集采样只属于 Worker 内部安全证据，不得成为主线程、Electron 或未来硬件的姿态指令流。

## 版本化接口

```ts
type CutterGridExecutableActionV2 =
  | {
      type: 'move';
      occurrenceId: string;
      sourceBlockId: string;
      direction: CutterGridDirection;
      distance: number;
      startCoord: CutterGridCoord;
      endCoord: CutterGridCoord;
      logicalCommandCount: number;
    }
  | {
      type: 'wait';
      occurrenceId: string;
      sourceBlockId: string;
      durationMs: number;
      logicalCommandCount: 1;
    };

interface CutterArmMotionProgramV1 {
  kind: 'cutter-arm-motion-program';
  version: 1;
  robotProfileSignature: string;
  trajectorySignature: string;
  instructions: Array<SyncPtpInstructionV1 | WaitInstructionV1>;
}
```

- `CutterTrajectoryPlanV4` 保存入口、分组 action、每 action 的 1–2 条 analytic primitive、`q/v/a` 边界、动态限制、认证接触事件、真实剪发集合、诊断和完整签名。
- primitive 使用同步五次 PTP：`q(u)=q0+(q1-q0)(10u³-15u⁴+6u⁵)`。直接边的起止 `v=a=0`；同一 Move 内的避障点共享非零 `q/v/a`，保持 C2 连续。
- V1–V3 Cutter Grid 计划与签名不得由 V4 运行器接受。Servo Program IR 不变。

## 规划与认证设计

- 全局图的层只包含认证入口及每个可见 Move 的终点；Wait 不增加 IK 层。
- 每层首轮使用入口、前层、Servo 初态、关节中位和累计 12 个确定性 Halton seed，去重后最多保留 12 个候选。首个断开层扩展至累计 48 个 seed、最多 24 个候选。
- 相邻层按最近 4 条、最近 8 条、全部候选边的固定顺序验证；全程序共同选择入口和构型链，禁止逐 Move 贪心锁定分支。
- 每条候选直接边先尝试一条同步 PTP；失败时查询 Profile V4 的 256 节点、每节点 8 邻接的确定性安全 joint-space roadmap，并必须 shortcut 到至多一个内部构型。
- 路径选择顺序为：最少 primitive、最小最大归一化关节变化、最短时长、最小关节位移/曲率、最短末端路径及偏移、最大净空/限位余量、稳定字典序。
- 认证自适应细分至普通区域 `≤1°` / `≤voxelSize/8`，近头部区域 `≤0.25°` / `≤voxelSize/16`；使用保守运动上界证明区间净空。无法证明即 fail closed。

## 分阶段实施

每阶段都必须先重读本计划、v0.3、实施计划、验收清单、相关代码和测试；先更新本文件的阶段状态与检查清单，再修改该阶段代码，运行阶段验证后以独立 commit 收尾。

### Phase 1：契约、基线与失败测试

- [x] 同步 v0.3、实施计划和验收清单，明确 V3 固定直线/逐格零速条款已被 V4 取代。
- [x] 固化当前 V3 的全局 IK 回归基线：11 个原子 Move、44 个 Cartesian 层、4,286 个认证样本、6,976ms 玩家计划时长、`1.25×` 动态请求、几何签名 `188fb68c5336a3b4` 和轨迹签名 `73549fa7dad52468`。
- [x] 添加不接入生产入口的 V4 基线、预期失败和待实现性能门禁测试。
- 出口：文档与可复核基线证明 V4 的范围、输出数量和性能目标；不改运行行为。

### Phase 2：分组 IR、V4 类型与 Worker 协议

- [x] 实施前已重读 V4 契约、v0.3 的 15.2–15.4、实施计划、验收清单、现有 V1–V3 类型/编译器/Worker/客户端/Profile 注册表及其单元测试；确认现有生产入口仍只调用 `plan-v3`，本阶段未改变该选择。
- [x] 从现有可序列化 `CutterGridProgramV1` 生成 `CompiledCutterGridProgramV2`：每个展开后的 Move N 只产生一个带稳定 occurrence、起止逻辑坐标、方向、距离和 `logicalCommandCount=N` 的 action；Wait 产生一个独立 action 且成本为 1。Repeat 只展开叶子 occurrence，500 上限继续按逻辑成本而非 action 数计算。
- [x] 定义仅由 V4 接受的 Profile、同步 PTP primitive、分组轨迹 action/plan、诊断、错误和进度类型；计划不含密集认证采样，并以新版本/签名字段与 V1–V3 隔离。
- [x] 增加 `plan-v4` Worker 协议和客户端方法。Phase 2 的 Worker 结构化地返回 `planner-not-ready`，不会回退执行 V1–V3；界面尚不调用该入口。
- [x] 以纯领域测试固定 occurrence、Move N 坐标与成本、Repeat/500 限制、V4 版本边界，以及客户端对 V4 进度、失败和取消的传递。
- 出口：不切换运行入口时，可用纯领域测试构造和序列化 V4 输入输出。

### Phase 3：端点 IK、稀疏图与 PTP 路径

- [x] 实施前已重读 V4 契约、v0.3、实施计划、验收清单，以及 V2 全局 IK、候选去重/多样性、认证入场、头部碰撞、运动学和回归测试；确认 V4 未复用 V2 的逐格 Cartesian 层或 Hermite 直线路径验证。
- [x] 只为可见 Move 终点建立 `12` seed/`12` 候选的稀疏 IK 层；首个断开层按确定性 `48` seed/`24` 候选重新搜索，相邻层按最近 `4`、`8`、全部候选的固定顺序连接。
- [x] 实现与回放共享的同步五次 PTP 求值及内部碰撞/限位认证；直接边失败时从固定 256 节点、8 邻接的安全 roadmap 中只接受一个能形成两条 PTP 的避障构型。
- [x] 从 V2 认证入口派生 V4 直接 PTP 入场和 roadmap 签名，且 V4 Profile 不再携带 V2 的密集入场轨迹作为输出。
- [x] 以纯领域测试固定直接/单避障 primitive 上限、端点全局分支选择、候选/边扩展确定性、碰撞拒绝和 `Up 6 → Left 2 → Forward 3` 的低 Wrist 回归。
- 出口：纯规划器生成紧凑、确定性、无碰撞的 V4 几何计划。

### Phase 4：时间律、实际扫掠与认证

- [x] 实施前已重读 V4 契约、v0.3、实施计划、验收清单、现有 PTP 几何、体素扫掠、评分和 V3 动态/接触认证；确认 V4 的 Worker 内认证样本只能产生压缩诊断与接触事件，不能进入计划、主线程或硬件指令。
- [x] 将紧凑 primitive 重定时到 Profile 的 `1.5×` 请求与 `v/a/j` 硬限，必要时确定性延长时长；两段避障 Move 在同向时以共享的非零 `q/v/a` 边界保持 C2，反向时显式零速转向。
- [x] 以递归自适应采样和保守连杆位移上界认证每一段的限位与头部净空；普通/近头部阈值分别为 `1°`、`voxelSize/8` 与 `0.25°`、`voxelSize/16`，不能证明则 fail closed。
- [x] 从已认证的实际曲线生成按 action 相对时间排序的 `CutterGridContactEventV4`，以 `0.12` 刀头更新预计剪发和剩余 Hair；Wait 与系统入场必须零剪发。
- [x] 固化 V4 fixture 和默认 Challenge 参考程序 100 Completion、精确 12 格、零附带剪除的门禁；fixture 只包含紧凑 primitive、接触事件、诊断和签名。
- 出口：冻结 V4 计划具有真实接触和动态安全证据，不序列化密集样本。

### Phase 5：执行、UI 与硬件边界

- [ ] 接入绝对时间 V4 执行器、按可见动作 Step、真实曲线与预计剪发 UI。
- [ ] 定义并验证 `CutterArmMotionProgramV1`，但 ArmDock 继续拒绝 V4 下发。
- 出口：Run/Test/Step、暂停、隐藏页和取消回放同一 V4 计划。

### Phase 6：全量验收与发布准备

- [ ] 完成质量门、Profile/几何/动态审计、Chrome/Edge 双分辨率人工验收。
- [ ] 审计仅计划内前端变动、后端与硬件下发零变动；只推送 `feat/cutter-grid-control`。

## 量化验收目标

- `Right 2` 五次冷 Worker 规划的 P95 不超过 `3s`；`Up 6 → Left 2 → Forward 3` 的 P95 不超过 `10s`。
- 上述回归程序保持 3 个可见 Move action，玩家 primitive 总数不超过 6；若三条直接 PTP 均安全，必须为 3。
- 当前 Challenge 中该回归程序的玩家动画不超过 `5s`；定位时间另行记录且不计分。
- 运行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`npm run test:e2e`，并在 Chrome/Edge 的 1280×720、1920×1080 验收曲线流畅度。

## 参考依据

- [MoveIt Pilz Industrial Motion Planner](https://moveit.picknik.ai/main/doc/how_to_guides/pilz_industrial_motion_planner/pilz_industrial_motion_planner.html)：同步 joint-space PTP 不要求末端 Cartesian 直线。
- [Ruckig Tutorial](https://docs.ruckig.com/tutorial.html)：Community 版本在 intermediate waypoints 下会切换云 API，因此 V4 不依赖多 waypoint Ruckig 或外部规划服务。
