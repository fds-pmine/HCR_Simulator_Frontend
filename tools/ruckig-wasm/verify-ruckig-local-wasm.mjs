import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const outputDirectory = resolve(process.argv[2] ?? '');
const moduleFile = join(outputDirectory, 'hcr_ruckig_local.mjs');
const wasmFile = join(outputDirectory, 'hcr_ruckig_local.wasm');
await Promise.all([stat(moduleFile), stat(wasmFile)]);

const allowedRequests = new Set(['/', '/hcr_ruckig_local.mjs', '/hcr_ruckig_local.wasm']);
const requests = [];
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  requests.push(pathname);
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><link rel="icon" href="data:,"><title>HCR local Ruckig probe</title>');
    return;
  }
  if (pathname === '/hcr_ruckig_local.mjs' || pathname === '/hcr_ruckig_local.wasm') {
    const file = pathname.endsWith('.wasm') ? wasmFile : moduleFile;
    response.writeHead(200, { 'content-type': pathname.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    response.end(await readFile(file));
    return;
  }
  response.writeHead(404);
  response.end();
});

const closeServer = () => new Promise((resolveClose) => server.close(resolveClose));
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Could not bind the Ruckig audit server.');
const origin = `http://127.0.0.1:${address.port}`;

const edgeCandidates = [
  process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter((candidate) => candidate && existsSync(candidate));
const browsers = [
  { name: 'Chromium', options: {} },
  ...edgeCandidates.slice(0, 1).map((executablePath) => ({ name: 'Edge', options: { executablePath } })),
];

async function runWorkerProbe(browserName, options) {
  const browser = await chromium.launch({ headless: true, ...options });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/`);
    const result = await page.evaluate(async (base) => {
      const workerSource = `
        import createRuckig from '${base}/hcr_ruckig_local.mjs';
        const instance = await createRuckig({ locateFile: (file) => '${base}/' + file });
        const input = new Float64Array(46);
        const target = [10, -5, 3, 1, -2];
        for (let joint = 0; joint < 5; joint += 1) {
          input[15 + joint] = target[joint];
          input[30 + joint] = 20;
          input[35 + joint] = 50;
          input[40 + joint] = 200;
        }
        input[45] = 2;
        const sampleCount = 3;
        const inputPointer = instance._malloc(input.byteLength);
        const durationPointer = instance._malloc(Float64Array.BYTES_PER_ELEMENT);
        const outputPointer = instance._malloc(sampleCount * 20 * Float64Array.BYTES_PER_ELEMENT);
        try {
          instance.HEAPF64.set(input, inputPointer / Float64Array.BYTES_PER_ELEMENT);
          const status = instance._ruckig_sample_5d(inputPointer, sampleCount, durationPointer, outputPointer);
          const duration = instance.HEAPF64[durationPointer / Float64Array.BYTES_PER_ELEMENT];
          const output = Array.from(instance.HEAPF64.slice(
            outputPointer / Float64Array.BYTES_PER_ELEMENT,
            outputPointer / Float64Array.BYTES_PER_ELEMENT + sampleCount * 20,
          ));
          self.postMessage({
            status,
            duration,
            first: output.slice(0, 5),
            last: output.slice(40, 45),
            endVelocity: output.slice(45, 50),
            endAcceleration: output.slice(50, 55),
          });
        } finally {
          instance._free(outputPointer);
          instance._free(durationPointer);
          instance._free(inputPointer);
        }
      `;
      const worker = new Worker(
        URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })),
        { type: 'module' },
      );
      try {
        return await new Promise((resolveResult, rejectResult) => {
          worker.addEventListener('message', (event) => resolveResult(event.data), { once: true });
          worker.addEventListener('error', (event) => rejectResult(new Error(event.message)), { once: true });
        });
      } finally {
        worker.terminate();
      }
    }, origin);
    const expectedTarget = [10, -5, 3, 1, -2];
    const isNear = (actual, expected) => Math.abs(actual - expected) <= 1e-9;
    if (
      result.status < 0 ||
      !(result.duration >= 2) ||
      !result.first.every((value) => isNear(value, 0)) ||
      !result.last.every((value, index) => isNear(value, expectedTarget[index])) ||
      !result.endVelocity.every((value) => isNear(value, 0)) ||
      !result.endAcceleration.every((value) => isNear(value, 0))
    ) {
      throw new Error(`${browserName} local Ruckig result is invalid: ${JSON.stringify(result)}`);
    }
    return result;
  } finally {
    await browser.close();
  }
}

try {
  const results = [];
  for (const browser of browsers) results.push([browser.name, await runWorkerProbe(browser.name, browser.options)]);
  const unexpectedRequests = requests.filter((request) => !allowedRequests.has(request));
  if (unexpectedRequests.length > 0) throw new Error(`The Worker made unexpected requests: ${JSON.stringify(unexpectedRequests)}`);
  console.log(JSON.stringify({ browsers: results.map(([name]) => name), requests: [...new Set(requests)], durationSeconds: results[0][1].duration }));
} finally {
  await closeServer();
}
