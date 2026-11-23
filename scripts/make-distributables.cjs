const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const subst = path.join(systemRoot, 'System32', 'subst.exe');
const drive = ['R:', 'Q:', 'P:'].find((candidate) => !fs.existsSync(`${candidate}\\`));
if (!drive) throw new Error('没有可用于纯英文构建路径的临时盘符（R/Q/P）');
const mapping = spawnSync(subst, [drive, root], {stdio: 'inherit'});
if (mapping.status !== 0) throw new Error(`无法把工程临时映射到 ${drive}`);

const mappedRoot = `${drive}\\`;
const forgeCli = path.join(mappedRoot, 'node_modules', '@electron-forge', 'cli', 'dist', 'electron-forge.js');

try {
  const targetMake = path.join(root, 'out', 'make');
  fs.rmSync(targetMake, {recursive: true, force: true});
  const result = spawnSync(process.execPath, [forgeCli, 'make', '--skip-package'], {
    cwd: mappedRoot,
    env: {
      ...process.env,
      SQUIRREL_TEMP: path.join(mappedRoot, '.build-tools', 'SquirrelTemp'),
      ELECTRON_CACHE: path.join(mappedRoot, '.electron-cache'),
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
    },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  if (process.exitCode) return;
  console.log(`Distributables available at: ${targetMake}`);
} finally {
  spawnSync(subst, [drive, '/D'], {stdio: 'inherit'});
}
