# 本地 Ruckig WASM Spike

这个目录是 Cutter Grid V3 的离线、逐段 state-to-state Ruckig 可行性门禁，不是当前播放器的运行时依赖。应用仍使用已认证的 V3 前端重定时器；在完整的固定几何路径、TOPP-RA 风格边界状态和接触回归接入前，禁止以此包装器替换任何玩家轨迹。

- 上游：`pantor/ruckig` `v0.19.4`，固定提交 `a8db97a4e9c55e5160a3855f739fa3b270df8e4c`，MIT。
- 工具链：Emscripten `4.0.20`，发布映射 `c387d7a7e9537d0041d2c3ae71b7538cc978104e`。
- ABI：仅五关节、离线、同步的 state-to-state `q/v/a → q/v/a`；输出逐样本 `q/v/a/j`。不接受路径、场景、程序、头发或网络数据。
- 隔离：`cloud_client.cpp` 不编译，Ruckig 的 cloud waypoint 功能也不在 ABI 中；构建产物禁用文件系统，目标环境限定为 Worker。
- 产物：`out/` 是忽略的生成目录，包含 `.mjs`、`.wasm`、上游 `RUCKIG_LICENSE.txt` 和带 SHA-256 的 manifest；不得提交。

先用官方 Emscripten SDK 在本机准备固定版本，然后运行：

```powershell
$env:HCR_EMSDK_ROOT = 'C:\path\to\emsdk'
npm run ruckig:wasm:build
```

构建器会校验上游提交、排除云客户端、限制总 bundle 小于 256 KiB，并以 Chromium 和可用的 Edge 在 module Worker 中验证端点 `q/v/a` 和仅本地 `.mjs/.wasm` 请求。可传入 `-SkipBrowserProbe` 仅用于诊断编译失败，不能作为审计通过依据。
