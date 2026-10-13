# Local Ruckig WASM Spike

This directory is the feasibility gate for offline, segment-by-segment state-to-state Ruckig in Cutter Grid V3, not a runtime dependency of the current player. The app still uses the certified V3 frontend retimer; this wrapper must not replace any player trajectory until the complete fixed geometric path, TOPP-RA-style boundary states, and contact regressions are integrated.

- Upstream: `pantor/ruckig` `v0.19.4`, pinned commit `a8db97a4e9c55e5160a3855f739fa3b270df8e4c`, MIT.
- Toolchain: Emscripten `4.0.20`, release mapping `c387d7a7e9537d0041d2c3ae71b7538cc978104e`.
- ABI: five joints only, offline, synchronous state-to-state `q/v/a → q/v/a`; an optional minimum duration in seconds follows nine five-joint vectors, and output is per-sample `q/v/a/j`. Paths, scenes, programs, hair, and network data are not accepted.
- Isolation: `cloud_client.cpp` is not compiled, and Ruckig's cloud waypoint feature is absent from the ABI; the build disables the filesystem and targets only the Worker environment.
- Artifacts: `out/` is an ignored generated directory containing `.mjs`, `.wasm`, upstream `RUCKIG_LICENSE.txt`, and a manifest with SHA-256; do not commit it.

First prepare the pinned version locally using the official Emscripten SDK, then run:

```powershell
$env:HCR_EMSDK_ROOT = 'C:\path\to\emsdk'
npm run ruckig:wasm:build
```

The builder verifies the upstream commit, excludes the cloud client, limits the total bundle to less than 256 KiB, and uses Chromium and Edge when available to verify endpoint `q/v/a` and requests restricted to local `.mjs/.wasm` files in a module Worker. `-SkipBrowserProbe` may be passed only to diagnose compilation failures; it cannot serve as evidence that the audit passed.
