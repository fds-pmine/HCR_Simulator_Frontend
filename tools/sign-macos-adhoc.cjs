const path = require('node:path');
const { signAsync } = require('@electron/osx-sign');

// Keep the explicit ad-hoc identity and per-file Electron entitlements when
// signing through electron-builder's custom hook or the local CLI.
async function sign(options) {
  if (process.platform !== 'darwin' || options.platform === 'mas') {
    throw new Error('Ad-hoc signing requires macOS and a direct-download app.');
  }

  await signAsync({
    ...options,
    identity: '-',
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: (filePath) => ({
      // Ad-hoc code has no Team ID. The CLI needs the same library-loading
      // entitlement as electron-builder, as well as V8's JIT entitlements.
      entitlements: path.join(__dirname, 'entitlements.mac.plist'),
      hardenedRuntime: true,
      ...options.optionsForFile?.(filePath),
      timestamp: 'none',
    }),
  });
}

module.exports = sign;

if (require.main === module) {
  if (process.argv.length !== 3) {
    console.error('Usage: npm run app:sign:mac -- "/path/to/HCR Simulator.app"');
    process.exitCode = 1;
  } else {
    sign({ app: path.resolve(process.argv[2]), platform: 'darwin' }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
