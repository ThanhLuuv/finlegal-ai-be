const { buildSync } = require('esbuild');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.demo-test-output');
if (path.dirname(output) !== root || path.basename(output) !== '.demo-test-output') throw new Error('Unexpected test output path');
try {
  fs.mkdirSync(output, { recursive: true });
  buildSync({ entryPoints: [path.join(root, 'tests/demo-limits.test.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['miniflare'], outfile: path.join(output, 'test.cjs') });
  const result = spawnSync(process.execPath, ['--test', path.join(output, 'test.cjs')], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
