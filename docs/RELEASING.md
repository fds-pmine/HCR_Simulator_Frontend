# Releasing the desktop app

The web build deploys from `main` to Cloudflare Pages at `web.hcr.rs`. This
document is about the other artifact: the Electron app that goes on the official
website, built by `.github/workflows/desktop.yml`.

## Cutting a release

```sh
# 1. Bump the version. The tag and this number must agree — the pipeline checks
#    and fails the run before spending twenty minutes building.
npm version 0.4.0 --no-git-tag-version
git commit -am "release: 0.4.0"

# 2. Tag and push. The tag is what starts the build.
git tag v0.4.0
git push origin main --tags
```

`workflow_dispatch` runs the same build without publishing, which is the way to
check a change to packaging without burning a version number.

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

## Signing — read before publishing downloads

**Nothing is signed.** `CSC_IDENTITY_AUTO_DISCOVERY: false` is set in the
workflow because no certificate is configured, and electron-builder would
otherwise pick up whatever is in the runner keychain and fail late.

What that means for the people downloading from the website:

* **macOS** refuses to open the app: *"HCR Simulator is damaged and can't be
  opened."* That wording is Gatekeeper's for unsigned *and* un-notarized, and it
  is indistinguishable from a real corruption warning. Users must right-click →
  Open, or run `xattr -dr com.apple.quarantine`, which is an unreasonable
  instruction to put next to a download button.
* **Windows** SmartScreen shows "Windows protected your PC" until the installer
  builds reputation, which an unsigned binary never really does.
* **Linux** does not care.

To fix it properly, add repository secrets and remove the
`CSC_IDENTITY_AUTO_DISCOVERY` line:

| Secret | For |
|---|---|
| `CSC_LINK` | base64 of the Apple Developer ID `.p12` |
| `CSC_KEY_PASSWORD` | its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | notarization |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows Authenticode certificate |

An Apple Developer account is $99/yr; Windows OV certificates are comparable.
Until then, the honest thing is to say on the download page that the app is
unsigned and give the bypass steps, rather than let people meet the warning
cold.

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
