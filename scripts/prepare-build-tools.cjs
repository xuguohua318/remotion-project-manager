const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const toolsDir = path.join(root, '.build-tools');
const configPath = path.join(toolsDir, 'NuGet.Config');
const winstallPath = path.join(root, 'node_modules', 'electron-winstaller', 'lib', 'index.js');

fs.mkdirSync(toolsDir, {recursive: true});
fs.writeFileSync(
  configPath,
  '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources><clear /></packageSources>\n</configuration>\n',
  'utf8',
);

const marker = "path.resolve(process.cwd(), 'scripts', 'pack-nupkg.cjs')";
let source = fs.readFileSync(winstallPath, 'utf8');
if (!source.includes(marker)) {
  const commandStart = source.indexOf('                    cmd = ', source.indexOf('targetNuspecPath'));
  const argsEndMarker = '                    ];';
  const commandEnd = source.indexOf(argsEndMarker, commandStart);
  if (commandStart < 0 || commandEnd < 0) throw new Error('electron-winstaller 结构已变化，无法安全替换 NuGet pack');
  const replacement = [
    '                    cmd = process.execPath;',
    '                    args = [',
    "                        path.resolve(process.cwd(), 'scripts', 'pack-nupkg.cjs'),",
    '                        targetNuspecPath, appDirectory, nugetOutput',
    '                    ];',
  ].join('\n');
  source = source.slice(0, commandStart) + replacement + source.slice(commandEnd + argsEndMarker.length);
}
fs.writeFileSync(winstallPath, source, 'utf8');

console.log(`Build tools ready: ${configPath}`);
