# Cutter Grid 本地 Ruckig WASM 可行性审计

日期：2026-08-22。范围仅限 `feat/cutter-grid-control` 的前端 Spike；不修改 `hcr-backend`，不调用后端、ROS、MoveIt、Tesseract 或任何规划 API。

## 锁定输入

| 项目 | 固定值 |
| --- | --- |
| 上游 | `pantor/ruckig` |
| 版本/提交 | `v0.19.4` / `a8db97a4e9c55e5160a3855f739fa3b270df8e4c` |
| 许可证 | MIT；发布时须保留上游版权与许可证文本 |
| 编译器 | Emscripten `4.0.20` / `c387d7a7e9537d0041d2c3ae71b7538cc978104e` |
| 目标 | ES module + WebAssembly，`ENVIRONMENT=worker`、无文件系统、固定 16 MiB 初始内存 |
| ABI | `ruckig-local-5d-v3`；五自由度、完全本地、离线 state-to-state `q/v/a` 加可选最小时长；输出带绝对时间的 `q/v/a/j`，并保留全部有效 jerk 切换时刻 |

`cloud_client.cpp` 从源文件清单中显式排除，`BUILD_CLOUD_CLIENT` 在 CMake 契约中固定关闭。没有 intermediate waypoint、URL、HTTP 客户端、程序、场景或头发数据能进入该 ABI；因此它不能触发 Ruckig Community 的 waypoint 云 API。

## 已复现实测

固定输入为静止起点 `q=[0,0,0,0,0]`，静止目标 `q=[10,-5,3,1,-2]`，每关节上限 `v/a/j=[20,50,200]`，最小时长 `2s`。本地 Worker 返回成功状态 `0`、时长不少于 `2s`、目标端点误差不大于浮点舍入，目标 `v/a` 为零；v3 审计同时验证采样时间严格递增、首尾为 `0/duration`，以及 5ms 基础网格与额外 jerk 切换点。

Emscripten `-O3` 构建结果：

| 产物 | 大小 |
| --- | ---: |
| `hcr_ruckig_local.mjs` | 7,022 bytes |
| `hcr_ruckig_local.wasm` | 138,821 bytes |
| 总计 | 145,843 bytes |
| WASM SHA-256 | `50a4baff744e7d38df8dd259cf44ad5f2e461e6ecd23ebe536a825a96966b407` |

Chromium Worker 探针只观察到本地审计服务器的 `/`、`/hcr_ruckig_local.mjs` 和 `/hcr_ruckig_local.wasm` 请求；没有任何外部请求。`verify-ruckig-local-wasm.mjs` 会在可用时同时运行 Edge，并将此门禁固化为可重复命令。

前端还以纯 TypeScript ABI 适配器固定九组五关节输入的顺序、sample-major 时间戳 `q/v/a/j` 解码、非有限值拒绝与任意错误路径的 WASM 内存释放。Worker 加载器只接受固定的同源 `/vendor/ruckig/hcr_ruckig_local.mjs` 和同目录的 `hcr_ruckig_local.wasm`；它拒绝所有其他 `locateFile` 名称。`npm run ruckig:wasm:stage` 会再次校验 ABI、提交、许可证、字节数和 SHA-256，才将四个审计产物复制到忽略的 `public/vendor/ruckig/`。默认 `npm run build` 不会隐式生成或联网下载该二进制。

## 结论与后续门禁

该 Spike 证明固定版本 Ruckig 可被压缩为体积可接受、无云依赖的前端 Worker 子段求解器；不证明其已满足 Cutter Grid 的完整运动契约。当前 V3 的固定 C2 几何与解析回放仍是默认运行路径。`VITE_HCR_CUTTER_GRID_RUCKIG_TRIAL=1` 仅用于显式本地审计：它会使用真实 WASM 预规划，绝不在缺少该开关时改变玩家体验。

2026-08-22 的试运行曾发现：完整 Move 为了满足 `5ms`、`0.5°` 和 `voxelSize/16` 的认证，会形成较大的全量采样流。该问题现已按以下契约修复：密集 `q/v/a/j` 样本只在 Worker 中进行动态、碰撞、Cartesian 管道和扫掠接触认证；传给主线程的计划只保留 Ruckig 的首尾及实际 jerk 切换控制结点，以及按首次命中时间排序的 voxel 剪发事件。控制结点由分段常 jerk 三次式精确回放，剪发事件由冻结时间轴派发，因此不依赖 rAF 帧率，也不会把稀疏控制点之间的末端轨迹误作长弦。稀疏、可序列化的对象数据已在 Chromium Worker 中验证足够小，因而不需要为这个已受控的数据量引入额外二进制协议；不得以降低采样、放宽关节/头部/Cartesian/接触门禁或提高播放倍率掩盖问题。

替换运行时前必须完成以下事项：

1. 已完成：在保持 V2 已选 IK 分支和固定 Cartesian 管道不变的前提下，纯领域预备层生成确定性的保守 TOPP-RA 风格 path speed 及 `q/v/a` 边界；该输出尚未作为运行时轨迹。
2. 已完成纯领域编排：对每个局部 Ruckig 段传递精确共享边界，按 `1.1x` 最小时长扩展并以 `50x` 上限 fail closed，逐样本检验端点与动态限制；不得传 intermediate waypoints。空间认证回调会把关节限位、头部净空、固定 Cartesian 管道、`0.5°`/`voxelSize/16` 联合采样和零接触/允许接触集作为不可重试的 fail-closed 门禁。它尚未作为 Worker 运行轨迹。
3. 已完成纯领域完整玩家 Move 的局部段空间结果聚合、冻结接触集合精确比对，以及“密集认证样本 / 稀疏回放控制结点 / 时间戳剪发事件”分离；真实 WASM 使用带 jerk 切换点的分段常 jerk 三次 C2 表示，而非用端点 quintic 近似制造虚假 jerk 峰值。Chromium 实测通过双格 Practice Step（约 20 秒全流程）和 `Up 6 → Left 2 → Forward 3` 全局 IK 回归的完整预规划及首个 Step 边界（约 2.1 分钟）。
4. 已完成：输入变化、模式/Challenge 切换或组件卸载会终止当前专用规划 Worker，并以 `planning-cancelled` 结束旧请求；主线程只接受当前 request id，旧回调不能写入新计划。尚未完成的是生产级默认启用的性能基线与 Chrome/Edge 双浏览器完整回归。因此 Ruckig 仍由 `VITE_HCR_CUTTER_GRID_RUCKIG_TRIAL=1` 显式开启；默认 Cutter Grid 继续使用已认证的解析 V3 轨迹。任何失败均 fail closed；不回退到网络 API、渲染滤波或旧 V2 插值。

完成这些前，Rust 后端迁移继续延后，且 Cutter Grid 的后端提交、Session、Match 和 ArmDock 均保持不变。
