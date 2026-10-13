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

`workflow_dispatch` builds and uploads Actions artifacts without publishing a Release. Manually verify the free macOS ad-hoc signing process before publishing a new version tag.

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

## Free macOS signing and installation

This repository uses free **ad-hoc signing**, which requires no Apple Account, Apple Developer Program membership, Developer ID certificate, or GitHub Actions secrets. Before generating installers, GitHub CI signs the apps, nested frameworks, and helpers for both architectures from the inside out; users generally do not need to sign them again after downloading.

Ad-hoc signing verifies code integrity; it does not establish publisher identity or provide Apple notarization. Apple calls this approach Sign to Run Locally; see [Inside Code Signing: Requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements).

### 1. GitHub CI setup

1. Commit and push the local workflow, signing script, package.json, package-lock.json, and documentation changes to the repository.
2. Run a manual build through **Actions → Desktop build → Run workflow**; no signing parameters or Apple secrets are required.
3. The macOS job uses the custom `mac.sign` hook in pinned electron-builder 25.1.8 to call `@electron/osx-sign`, signs with identity `-`, retains the JIT entitlements and Hardened Runtime required by Electron, and disables timestamps and notarization.
4. Before uploading, run `codesign --verify --deep --strict` on the x64 and arm64 `.app` bundles and confirm that the signature is `adhoc` and the Identifier is `rs.hcr.simulator`. If verification fails, do not upload that platform's installers.
5. After verifying the artifacts, publish a new tag using the version steps above. Tag builds follow the same free signing process.

Developer ID identity, notarization ticket, and Gatekeeper trust checks are not performed because ad-hoc signing does not provide those properties. Windows and Linux packaging retain their existing configuration.

### 2. First installation for users

Download the `.dmg` or `.zip` for your architecture, place **HCR Simulator.app** in Applications, and open it. If macOS says it cannot verify the developer and you have confirmed that the source is trustworthy, after attempting to open it go to **System Settings → Privacy & Security → Open Anyway**, then confirm opening. Follow [Apple's instructions for opening apps](https://support.apple.com/en-us/102445); organization-managed Macs may restrict this action.

Users still need to grant **Local Network** permission when connecting to the arm for the first time. `NSLocalNetworkUsageDescription` explains its purpose. Passing signature integrity verification does not mean the original `EHOSTUNREACH` is fixed; after installing the new build, you still need to verify Test in the ARM panel on the actual device.

### 3. Re-signing on your own Mac (optional)

New CI installers are already fully signed, so this step is usually unnecessary. To re-sign an older build locally, quit the app first and run the following in this repository on a Mac with Node.js 22 installed:

```sh
npm ci
npm run app:sign:mac -- "/path/to/HCR Simulator.app"
codesign --verify --deep --strict --verbose=2 "/path/to/HCR Simulator.app"
```

Choose an app copy you can write to, for example by first copying it to `~/Applications`, and replace the example path with the actual path. This script signs the nested Electron components and the main app using Electron's entitlements. It requires no Apple ID, does not change Gatekeeper settings, and does not remove the download quarantine attribute. Re-signing still does not provide Apple notarization.

macOS uses code signatures to track local network permissions. Ad-hoc signatures are sensitive to version contents, so updates or re-signing may require permission to be granted again and do not guarantee a stable permission identity; Apple recommends an Apple-issued identity for reliable permission tracking. See [Understanding local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).

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
