import {access, readdir, readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import type {
  PackageManager,
  ProjectInfo,
  ProjectRegistryEntry,
  RemotionManagerManifest,
  RuntimeInfo,
  ScriptMap,
} from '../shared/types';
import {RegistryStore} from './registry';
import {readJson, resolveInside} from './utils';

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const entryCandidates = [
  'src/index.ts', 'src/index.tsx', 'src/index.js', 'src/index.jsx',
  'index.ts', 'index.tsx', 'index.js', 'index.jsx',
];

const detectPackageManager = async (projectPath: string, declared?: string): Promise<PackageManager> => {
  if (declared) {
    const name = declared.split('@')[0];
    if (name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun') return name;
  }
  if (await exists(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(projectPath, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(projectPath, 'bun.lock')) || await exists(path.join(projectPath, 'bun.lockb'))) return 'bun';
  if (await exists(path.join(projectPath, 'package-lock.json'))) return 'npm';
  return 'npm';
};

const findScript = (scripts: Record<string, string>, names: string[], pattern?: RegExp): string | undefined => {
  for (const name of names) {
    const value = scripts[name];
    if (value && (!pattern || pattern.test(value))) return name;
  }
  if (pattern) {
    return Object.entries(scripts).find(([, value]) => pattern.test(value))?.[0];
  }
  return undefined;
};

export class ProjectService {
  constructor(private readonly registry: RegistryStore) {}

  async list(): Promise<ProjectInfo[]> {
    const entries = this.registry.get().projects;
    const results = await Promise.all(entries.map(async (entry) => {
      try {
        return await this.inspect(entry);
      } catch (error) {
        return {
          id: entry.id,
          path: entry.path,
          displayName: path.basename(entry.path),
          packageName: '',
          packageManager: 'unknown' as const,
          supported: false,
          scripts: {},
          packageScripts: {},
          hasPackageLock: false,
          hasNodeModules: false,
          hasRemotionCli: false,
          hasManifest: false,
          warnings: [error instanceof Error ? error.message : String(error)],
        } satisfies ProjectInfo;
      }
    }));
    return results;
  }

  async importProject(projectPath: string): Promise<ProjectInfo> {
    const canonical = await realpath(projectPath);
    if (!(await exists(path.join(canonical, 'package.json')))) throw new Error('所选目录没有 package.json');
    const entry = await this.registry.add(canonical);
    return this.inspect(entry);
  }

  async refresh(projectId: string): Promise<ProjectInfo> {
    return this.inspect(this.registry.getProject(projectId));
  }

  async scan(rootPath: string, maxDepth = 6): Promise<ProjectInfo[]> {
    const found: ProjectInfo[] = [];
    const queue: Array<{folder: string; depth: number}> = [{folder: await realpath(rootPath), depth: 0}];
    const skipped = new Set(['node_modules', '.git', 'build', 'out', 'dist', 'backups', '.remotion-manager']);
    while (queue.length) {
      const current = queue.shift()!;
      if (await exists(path.join(current.folder, 'package.json'))) {
        try {
          const packageJson = JSON.parse(await readFile(path.join(current.folder, 'package.json'), 'utf8')) as {dependencies?: Record<string, string>; devDependencies?: Record<string, string>};
          if (packageJson.dependencies?.remotion || packageJson.devDependencies?.remotion || packageJson.dependencies?.['@remotion/cli']) {
            found.push(await this.importProject(current.folder));
            continue;
          }
        } catch {
          // Keep scanning child directories when a package file is malformed.
        }
      }
      if (current.depth >= maxDepth) continue;
      let children;
      try {
        children = await readdir(current.folder, {withFileTypes: true});
      } catch {
        continue;
      }
      for (const child of children) {
        if (child.isDirectory() && !skipped.has(child.name)) {
          queue.push({folder: path.join(current.folder, child.name), depth: current.depth + 1});
        }
      }
    }
    return found;
  }

  async runtimeInfo(): Promise<RuntimeInfo> {
    const nodeDirectory = this.registry.get().nodeDirectory;
    const nodePath = path.join(nodeDirectory, 'node.exe');
    const npmPath = path.join(nodeDirectory, 'npm.cmd');
    const ok = await exists(nodePath) && await exists(npmPath);
    return {
      nodeDirectory,
      nodePath: await exists(nodePath) ? nodePath : undefined,
      npmPath: await exists(npmPath) ? npmPath : undefined,
      ok,
      message: ok ? undefined : '未在所选目录找到 node.exe 和 npm.cmd',
    };
  }

  async setNodeDirectory(nodeDirectory: string): Promise<RuntimeInfo> {
    await this.registry.setNodeDirectory(nodeDirectory);
    return this.runtimeInfo();
  }

  private async inspect(entry: ProjectRegistryEntry): Promise<ProjectInfo> {
    const projectPath = entry.path;
    const folderStat = await stat(projectPath);
    if (!folderStat.isDirectory()) throw new Error(`工程目录不存在：${projectPath}`);
    const packagePath = path.join(projectPath, 'package.json');
    const packageJson = await readJson<{
      name?: string;
      packageManager?: string;
      scripts?: Record<string, string>;
    }>(packagePath);
    const packageScripts = packageJson.scripts ?? {};
    const packageManager = await detectPackageManager(projectPath, packageJson.packageManager);
    const warnings: string[] = [];
    if (packageManager !== 'npm') warnings.push(`检测到 ${packageManager} 工程；第一版只执行 npm 工程，不会混用锁文件。`);

    const manifestPath = path.join(projectPath, 'remotion-manager.json');
    let manifest: RemotionManagerManifest | undefined;
    if (await exists(manifestPath)) {
      try {
        manifest = await readJson<RemotionManagerManifest>(manifestPath);
        if (manifest.version !== 1) throw new Error('清单版本不是 1');
      } catch (error) {
        warnings.push(`remotion-manager.json 无法读取：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    let entryPoint = manifest?.entry;
    if (entryPoint) {
      try {
        if (!(await exists(resolveInside(projectPath, entryPoint)))) {
          warnings.push(`清单入口不存在：${entryPoint}`);
          entryPoint = undefined;
        }
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
        entryPoint = undefined;
      }
    }
    if (!entryPoint) {
      entryPoint = (await Promise.all(entryCandidates.map(async (candidate) => ({candidate, found: await exists(path.join(projectPath, candidate))}))))
        .find((item) => item.found)?.candidate;
    }
    if (!entryPoint) warnings.push('未找到常见 Remotion 入口 src/index.* 或 index.*。');

    const discovered: ScriptMap = {
      studio: findScript(packageScripts, ['studio', 'start', 'dev', 'remotion', 'remotion:studio'], /\bremotion(?:\.cmd)?\s+studio\b/i),
      render: findScript(packageScripts, ['render']),
      still: findScript(packageScripts, ['still']),
      check: findScript(packageScripts, ['check', 'typecheck']),
    };
    const mapped = {...discovered, ...entry.scriptOverrides, ...manifest?.scripts};
    const scripts = Object.fromEntries(Object.entries(mapped).filter(([, script]) => script && packageScripts[script])) as ScriptMap;
    if (!scripts.studio && !entryPoint) warnings.push('没有可用 Studio 脚本或入口。');

    const settings = manifest?.settings;
    if (settings) {
      for (const relativePath of [settings.file, settings.schema]) {
        try {
          if (!(await exists(resolveInside(projectPath, relativePath)))) warnings.push(`参数文件不存在：${relativePath}`);
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : String(error));
        }
      }
    }

    return {
      id: entry.id,
      path: projectPath,
      displayName: manifest?.displayName || packageJson.name || path.basename(projectPath),
      packageName: packageJson.name ?? '',
      packageManager,
      supported: packageManager === 'npm',
      entry: entryPoint,
      scripts,
      packageScripts,
      hasPackageLock: await exists(path.join(projectPath, 'package-lock.json')),
      hasNodeModules: await exists(path.join(projectPath, 'node_modules')),
      hasRemotionCli: await exists(path.join(projectPath, 'node_modules', '@remotion', 'cli', 'remotion-cli.js')),
      hasManifest: Boolean(manifest),
      settings,
      warnings,
    };
  }
}
