import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifact = path.join(root, 'artifacts/captchavatye-react-0.1.0.tgz');
assert.ok(existsSync(artifact), '먼저 npm run pack:sdk를 실행한다');
const manifest = JSON.parse(readFileSync(path.join(root, 'artifacts/package-manifest.json'), 'utf8'));
for (const { path: name } of manifest.files) {
  assert.ok(name === 'README.md' || name === 'package.json' || name.startsWith('dist/'), name);
  assert.ok(!/node_modules|\.env|\.(png|webp|map)$/.test(name), name);
}
const consumer = mkdtempSync(path.join(tmpdir(), 'captchavatye-consumer-'));
cpSync(path.join(root, 'examples/react-consumer'), consumer, {
  recursive: true,
  filter: source => !['node_modules', 'dist', 'package-lock.json'].includes(path.basename(source)),
});
const pkgFile = path.join(consumer, 'package.json');
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
pkg.dependencies['@captchavatye/react'] = 'file:' + artifact;
writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
const output = path.join(root, 'artifacts/sdk-install');
mkdirSync(output, { recursive: true });
const commands = [
  ['install', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...(process.argv.includes('--offline') ? ['--offline'] : [])]],
  ['build', ['run', 'build']],
  ['react-tree', ['ls', 'react', 'react-dom']],
];
const results = [];
for (const [name, args] of commands) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: consumer, encoding: 'utf8' });
  writeFileSync(path.join(output, name + '.log'), result.stdout + result.stderr);
  results.push({ name, exitCode: result.status, output: result.stdout + result.stderr });
  console.log(name + ': ' + result.status);
  if (result.error || result.status !== 0) {
    console.error(result.error || result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}
const installed = path.join(consumer, 'node_modules/@captchavatye/react');
assert.equal(lstatSync(installed).isSymbolicLink(), false, '소스 symlink가 아닌 tarball 설치여야 한다');
for (const name of ['index.js', 'index.d.ts', 'style.css']) {
  assert.deepEqual(readFileSync(path.join(installed, 'dist', name)), readFileSync(path.join(root, 'packages/react/dist', name)), name);
}
assert.equal(existsSync(path.join(installed, 'node_modules/react')), false);
assert.equal(existsSync(path.join(installed, 'node_modules/react-dom')), false);
const report = { recordedAt: new Date().toISOString(), consumer, artifact,
  sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'),
  installedAsSymlink: false, files: manifest.files, results };
writeFileSync(path.join(output, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
console.log('CONSUMER=' + consumer);
