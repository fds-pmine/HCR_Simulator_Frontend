# HCR Simulator Agent Guide

## 当前阶段

仓库已按用户明确授权完成原 `docs/IMPLEMENTATION_PLAN.md` 的 Phase 1–6、五关节升级与确定性头部防穿模；当前正在 `feat/cutter-grid-control` 按 Cutter Grid Phase 0–5 分阶段实施。原 Phase 7 与 Cutter Grid 最终阶段均不包含部署。

- 每个 Phase 开始前重读实施计划与相关规格；
- 每个 Phase 只实现该阶段范围，完成验证后独立 commit；
- 不执行部署；除已在 v0.3 明确授权的 Cutter Grid 编译期 IK 与同步多关节轨迹外，不引入其他首版非目标能力；
- 遇到跨阶段依赖时优先保持可测试接口，不以越层实现绕过计划。

## 文档优先级

1. 用户当前指令。
2. 本文件。
3. `docs/HCR_Simulator_SPEC_v0.3.md`。
4. `docs/IMPLEMENTATION_PLAN.md`。
5. `docs/ACCEPTANCE.md`。
6. `docs/HCR_Simulator_SPEC_v0.2.md` 仅作为历史背景。

说明文档使用中文；类型、API、标识符、文件名和必要代码注释使用英文。

## 文档维护规则

- v0.3 必须可以独立阅读，不得要求实现者从 v0.2 拼接关键决策。
- 产品或技术决策变化时，同时更新 v0.3、实施计划和验收清单。
- 已确认决策使用明确陈述；尚未确认内容标记为“未来扩展/TBD”，不得伪装成首版要求。
- 示例类型与公式是接口契约；修改字段或语义时必须同步所有引用。
- 不覆盖 v0.2；它是历史记录。

## 模块边界

- Blockly 只能生成 Program IR，不得直接操作 Three.js、Hair State 或评分。
- R3F 组件只负责渲染和每帧驱动，不得包含评分规则。
- Simulation Engine 负责命令执行、时间推进和碰撞协调。
- 头部防穿模使用纯几何约束；碰撞时必须保留最后安全姿态并进入 `error`，不得在渲染层静默修正。
- Hair Voxel 必须由可测试的逻辑集合表示，不能只存在于 Mesh。
- Challenge 和评分必须通过 Provider 接口进入应用。
- 所有机械臂、voxel、碰撞和评分参数必须来自集中配置。
- React State 不得承担 60 FPS 高频关节插值；高频数据保留在控制器实例与 R3F refs 中。

## 首版禁止事项

- 不增加通用相对角度、任意 Cartesian Move、运行时 IK、剪刀开合或物理引擎。Cutter Grid 仅允许规格定义的固定世界轴单格移动、编译期确定性 IK 和冻结同步轨迹。
- 不增加 ESP、MQTT、WebSerial、WebBluetooth 或真实网络依赖。
- 不引入外部 GLB/FBX 机械臂或头发资产。
- 不把 Local Provider 实现直接导入业务 UI。
- 不用 JavaScript `eval` 或 Blockly JavaScript Generator 执行用户程序。

## 修改流程

1. 先核对 v0.3 规格与 `docs/ACCEPTANCE.md`。
2. 编码阶段开始后，按 `docs/IMPLEMENTATION_PLAN.md` 的依赖顺序实施。
3. 保持领域逻辑为纯函数或可注入时钟的类，并先补相应测试。
4. UI 改动必须保持 1280×720 下主控制无遮挡。
5. 新增配置字段时同步更新类型、本地 Challenge、文档和测试。
6. 不提交构建产物、测试报告或本地环境文件。

## 完成定义

以下命令必须全部通过：

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

并完成 `docs/ACCEPTANCE.md` 中的人工验收项。
