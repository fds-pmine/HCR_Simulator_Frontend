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

2026-08-22 的试运行发现：完整 Move 为了满足 `5ms`、`0.5°` 和 `voxelSize/16` 的认证，会形成较大的全量采样流。将该流连同所有 q/v/a/j 控制点从 Worker 传到主线程会超过当前 Practice 页面可接受的规划预算。因此，升为默认前必须把“用于碰撞/接触认证的密集样本”与“用于回放的稀疏 jerk 控制结点”分离，并以可转移的紧凑二进制布局传输；不得以降低采样、放宽关节/头部/Cartesian/接触门禁或提高播放倍率掩盖该问题。

替换运行时前必须完成以下事项：

1. 已完成：在保持 V2 已选 IK 分支和固定 Cartesian 管道不变的前提下，纯领域预备层生成确定性的保守 TOPP-RA 风格 path speed 及 `q/v/a` 边界；该输出尚未作为运行时轨迹。
2. 已完成纯领域编排：对每个局部 Ruckig 段传递精确共享边界，按 `1.1x` 最小时长扩展并以 `50x` 上限 fail closed，逐样本检验端点与动态限制；不得传 intermediate waypoints。空间认证回调会把关节限位、头部净空、固定 Cartesian 管道、`0.5°`/`voxelSize/16` 联合采样和零接触/允许接触集作为不可重试的 fail-closed 门禁。它尚未作为 Worker 运行轨迹。
3. 已完成纯领域完整玩家 Move 的局部段空间结果聚合与冻结接触集合精确比对；真实 WASM 试运行也会使用带 jerk 切换点的分段常 jerk 三次 C2 表示，而非用端点 quintic 近似制造虚假 jerk 峰值。仍须完成“认证样本/回放控制结点”分离后，才可在 Worker 的实际 WASM 输出上以 `5ms`、`0.5°` 和 `voxelSize/16` 联合分辨率复验完整回放的速度、加速度、jerk、头部净空、Cartesian 偏差和扫掠接触集合。
4. 添加 Worker 取消、确定性签名、紧凑传输及 Chrome/Edge 回归。任何失败均 fail closed；不回退到网络 API、渲染滤波或旧 V2 插值。

完成这些前，Rust 后端迁移继续延后，且 Cutter Grid 的后端提交、Session、Match 和 ArmDock 均保持不变。
