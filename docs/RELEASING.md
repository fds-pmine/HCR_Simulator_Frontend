# Releasing the desktop app

The web build deploys from `main` to Cloudflare Pages at `web.hcr.rs`. This
document is about the other artifact: the Electron app that goes on the official
website, built by `.github/workflows/desktop.yml`.

## Cutting a release

```sh
# 1. Bump the version. The tag and this number must agree — the pipeline checks
#    and fails the run before spending twenty minutes building.
npm version patch --no-git-tag-version
release_version="$(node -p "require('./package.json').version")"
git commit -am "release: ${release_version}"

# 2. Tag and push. The tag is what starts the build.
git tag "v${release_version}"
git push origin main "v${release_version}"
```

`workflow_dispatch` 构建并上传 Actions artifacts，不发布 Release。先手动验证免费的 macOS ad-hoc 签名流程，再发布新的版本标签。

## What gets built

One job per operating system. Each produces every architecture that platform
supports, because the app has no native modules — packaging a different
architecture only means downloading a different prebuilt Electron binary, not
compiling anything.

| Platform | Formats | Architectures |
|---|---|---|
| Windows | NSIS installer (`.exe`) | x64, **x86 (ia32)**, arm64 |
| macOS | `.dmg`, `.zip` | x64, arm64 |
| Linux | AppImage, `.deb`, `.rpm` | x64, arm64 |

### Why there is no 32-bit build except on Windows

Windows is the only platform where 32-bit is still a target anyone can use.

* **macOS** has refused to run 32-bit binaries since Catalina (2019), and no
  modern Electron ships a 32-bit macOS build.
* **Linux** ia32 support was dropped by Electron after v4. There is no binary to
  package.

Asking electron-builder for either produces a download failure, not a smaller
app.

## macOS 免费签名与安装

此仓库使用免费的 **ad-hoc 签名**，不要求 Apple Account、Apple Developer Program 会员资格、Developer ID 证书或 GitHub Actions secrets。GitHub CI 在生成安装包前，对两个架构的应用、嵌套 framework 和 helper 由内向外签名，用户下载后通常无须再签一次。

ad-hoc 签名提供代码完整性校验，不证明发布者身份，也不提供 Apple 公证。Apple 将这种方式称为 Sign to Run Locally，说明见 [Inside Code Signing: Requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)。

### 1. GitHub CI 设置

1. 将本地 workflow、签名脚本、package.json、package-lock.json 与文档改动提交并推送到仓库。
2. 在 **Actions → Desktop build → Run workflow** 运行手动构建，无须输入签名参数或添加 Apple secrets。
3. macOS job 使用锁定的 electron-builder 25.1.8 的 `mac.sign` 自定义 hook，调用 `@electron/osx-sign`，使用 `-` 身份签名，保留 Electron 所需的 JIT entitlements 和 Hardened Runtime，并关闭时间戳与公证。
4. 上传前，对 x64 和 arm64 的 `.app` 执行 `codesign --verify --deep --strict`，并确认签名为 `adhoc`、Identifier 为 `rs.hcr.simulator`。失败时不上传该平台的安装包。
5. 验证 artifacts 后按前面的版本步骤发布新标签。标签构建沿用相同免费签名流程。

不执行 Developer ID 身份、公证 ticket 或 Gatekeeper 信任通过检查，因为 ad-hoc 签名不提供这些属性。Windows 与 Linux 打包方式保持原有配置。

### 2. 用户首次安装

下载适合自己架构的 `.dmg` 或 `.zip`，将 **HCR Simulator.app** 放入 Applications 后打开。如果 macOS 提示无法验证开发者，且用户确认来源可信，可在尝试打开后进入 **System Settings → Privacy & Security → Open Anyway**，再确认打开。步骤以 [Apple 的打开应用说明](https://support.apple.com/en-us/102445) 为准；受组织管理的 Mac 可能限制此操作。

首次连接机械臂时，用户仍需授予 **Local Network** 权限。`NSLocalNetworkUsageDescription` 已说明用途。签名完整性通过不代表原来的 `EHOSTUNREACH` 已修复；安装新构建后，还需要在 ARM 面板实际验证 Test。

### 3. 用户在自己的 Mac 上重新签名（可选）

新 CI 安装包已经完整签名，通常不需要这一步。如要给旧构建重新做本地签名，先退出应用，使用安装了 Node.js 22 的 Mac，在此仓库运行：

```sh
npm ci
npm run app:sign:mac -- "/path/to/HCR Simulator.app"
codesign --verify --deep --strict --verbose=2 "/path/to/HCR Simulator.app"
```

选择自己可写的应用副本，例如先复制到 `~/Applications`，并将示例路径替换为真实路径。这个脚本会签名嵌套 Electron 组件及主应用，并使用 Electron 的 entitlements。它不需要 Apple ID，不修改 Gatekeeper 设置，也不删除下载隔离属性。重新签名仍不会获得 Apple 公证。

macOS 使用代码签名跟踪本地网络权限。ad-hoc 签名对版本内容敏感，更新或重新签名后可能需要重新授权，也不能保证权限身份稳定；Apple 推荐 Apple 签发的身份来可靠跟踪权限。详见 [Understanding local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)。

## Icons

There are none. `directories.buildResources` points at `build/`, which does not
exist, so every build ships the default Electron icon — a grey atom.

To fix, add a single 1024×1024 PNG at `build/icon.png`; electron-builder derives
the `.icns` and `.ico` from it. `docs/DEPLOY.md` already asks for the same mark
at `public/favicon.png` for the web build.

## Things the pipeline deliberately does

**`if-no-files-found: error` on the upload step.** A build can finish green
having produced nothing if a target silently drops out. Without this the release
job would publish an empty set and nobody would notice until a user clicked a
missing link.

**`rpm` installed on the Linux runner.** electron-builder shells out to
`rpmbuild`, which is not on the GitHub runner image. Omit it and the `.rpm`
disappears from the output while the job still reports success.

**Upload-into-existing-release on re-run.** `gh release create` fails if the
release exists, which is exactly what happens when one platform is re-run after
a partial failure. The job checks first and uploads with `--clobber` instead.

**Tag/version agreement is checked first.** The tag names the release; the
`package.json` version names every file inside it. A mismatch produces a
`v0.4.0` release full of `hcr-simulator-0.3.0-*` files.

## Notes for the config itself

`build` in `package.json` is validated against a strict schema — electron-builder
rejects any key it does not recognise, including the `"//": "comment"`
convention. That is why the reasoning lives in this file instead of inline.
