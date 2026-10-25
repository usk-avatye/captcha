import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'artifacts');
mkdirSync(output, { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npm, ['run', 'build:sdk'], { cwd: root, stdio: 'inherit' });
if (build.error || build.status !== 0) process.exit(build.status || 1);
// 방금 검증한 dist를 포장한다. 레지스트리 로그인이나 공개 발행은 하지 않는다.
const pack = spawnSync(npm, ['pack', '--workspace', '@captchavatye/react', '--ignore-scripts', '--json', '--pack-destination', output], { cwd: root, encoding: 'utf8' });
if (pack.error || pack.status !== 0) {
  console.error(pack.error || pack.stderr);
  process.exit(pack.status || 1);
}
const [manifest] = JSON.parse(pack.stdout);
writeFileSync(path.join(output, 'package-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(path.join(output, manifest.filename));
