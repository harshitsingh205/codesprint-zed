// Portable test runner: lists compiled test files explicitly so it works on every OS and Node version.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'out', 'test');
if (!fs.existsSync(dir)) {
  console.error('No compiled tests found. Run "npm run compile" first.');
  process.exit(1);
}
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => path.join(dir, f));
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
