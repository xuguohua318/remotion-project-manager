import {app} from 'electron';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {execFile, spawn} from 'node:child_process';
import {mkdir, appendFile} from 'node:fs/promises';
import path from 'node:path';
import type {ProjectInfo, TaskEvent, TaskKind, TaskState} from '../shared/types';
import {ProjectService} from './projects';
import {isLoopbackUrl, resolveInside, stripAnsi} from './utils';

type EventSink = (event: TaskEvent) => void;

interface RunningTask {
  child: ChildProcessWithoutNullStreams;
  state: TaskState;
  logPath: string;
}

const taskKey = (projectId: string, kind: TaskKind): string => `${projectId}:${kind}`;
const validScriptName = /^[a-zA-Z0-9_.:-]+$/;

interface HttpReadyOptions {
  timeoutMs?: number;
  intervalMs?: number;
  requestTimeoutMs?: number;
  fetcher?: typeof fetch;
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const waitForLoopbackHttpReady = async (url: string, options: HttpReadyOptions = {}): Promise<void> => {
  if (!isLoopbackUrl(url)) throw new Error('拒绝探测非本机 Studio 地址');
  const timeoutMs = options.timeoutMs ?? 45_000;
  const intervalMs = options.intervalMs ?? 250;
  const requestTimeoutMs = options.requestTimeoutMs ?? 1_500;
  const fetcher = options.fetcher ?? fetch;
  const deadline = Date.now() + timeoutMs;
  let lastError = '连接尚未建立';

  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    try {
      const response = await fetcher(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.min(requestTimeoutMs, remaining)),
      });
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    const pause = Math.min(intervalMs, Math.max(0, deadline - Date.now()));
    if (pause > 0) await delay(pause);
  }

  throw new Error(`Studio 已输出地址，但服务在 ${Math.ceil(timeoutMs / 1000)} 秒内未就绪：${lastError}`);
};

export const npmInvocation = (npmPath: string, args: string[]): {file: string; args: string[]} => {
  const nodeDirectory = path.dirname(npmPath);
  return {
    file: path.join(nodeDirectory, 'node.exe'),
    args: [path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args],
  };
};

export const remotionPropsArgument = (projectPath: string, settingsFile?: string): string | undefined => {
  if (!settingsFile) return undefined;
  resolveInside(projectPath, settingsFile);
  return `--props=${settingsFile.replaceAll('\\', '/')}`;
};

export class TaskService {
  private readonly running = new Map<string, RunningTask>();
  private readonly states = new Map<string, TaskState>();

  constructor(
    private readonly projectService: ProjectService,
    private readonly emit: EventSink,
  ) {}

  getStates(): TaskState[] {
    return Array.from(this.states.values()).map((state) => ({...state}));
  }

  getStudioUrl(projectId: string): string | undefined {
    return this.states.get(taskKey(projectId, 'studio'))?.studioUrl;
  }

  async run(projectId: string, kind: TaskKind): Promise<TaskState> {
    if (kind === 'verify') throw new Error('持久化验证必须通过验证接口启动');
    const project = await this.projectService.refresh(projectId);
    if (!project.supported) throw new Error(`暂不执行 ${project.packageManager} 工程`);
    const key = taskKey(projectId, kind);
    if (this.running.has(key)) return {...this.running.get(key)!.state};

    this.setState({projectId, kind, status: 'starting', startedAt: new Date().toISOString()});
    if (kind === 'install') {
      await this.ensureDependencies(project);
      const completed: TaskState = {projectId, kind, status: 'success', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), exitCode: 0};
      this.setState(completed);
      return completed;
    }
    await this.ensureDependencies(project);
    const refreshed = await this.projectService.refresh(projectId);
    const command = await this.commandFor(refreshed, kind);
    return this.spawnTask(refreshed, kind, command.file, command.args);
  }

  async stop(projectId: string, kind: TaskKind): Promise<void> {
    const key = taskKey(projectId, kind);
    const task = this.running.get(key);
    if (!task) return;
    await this.killTree(task.child.pid);
    task.state = {
      ...task.state,
      status: 'stopped',
      endedAt: new Date().toISOString(),
      studioUrl: kind === 'studio' ? undefined : task.state.studioUrl,
    };
    this.running.delete(key);
    this.setState(task.state);
  }

  async stopAllForProject(projectId: string): Promise<void> {
    const kinds = Array.from(this.running.values())
      .filter((task) => task.state.projectId === projectId)
      .map((task) => task.state.kind);
    await Promise.all(kinds.map((kind) => this.stop(projectId, kind)));
  }

  async runCompositions(project: ProjectInfo): Promise<string> {
    await this.ensureDependencies(project);
    const refreshed = await this.projectService.refresh(project.id);
    if (!refreshed.entry) throw new Error('没有可用 Remotion 入口');
    const runtime = await this.projectService.runtimeInfo();
    if (!runtime.nodePath) throw new Error('找不到 Node.js');
    const cli = path.join(refreshed.path, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
    const propsArgument = remotionPropsArgument(refreshed.path, refreshed.settings?.file);
    return this.runOneShot(
      runtime.nodePath,
      [cli, 'compositions', refreshed.entry, ...(propsArgument ? [propsArgument] : [])],
      refreshed.path,
      refreshed.id,
      'verify',
    );
  }

  async startStudioAndWait(projectId: string, timeoutMs = 45_000): Promise<string> {
    const current = this.getStudioUrl(projectId);
    const key = taskKey(projectId, 'studio');
    const deadline = Date.now() + timeoutMs;
    if (current) {
      try {
        await waitForLoopbackHttpReady(current, {timeoutMs: Math.min(1_500, timeoutMs)});
        return current;
      } catch {
        if (!this.running.has(key)) {
          const stale = this.states.get(key);
          if (stale) this.setState({...stale, studioUrl: undefined});
        }
      }
    }
    if (!this.running.has(key)) await this.run(projectId, 'studio');

    let lastReadinessError: Error | undefined;
    while (Date.now() < deadline) {
      const state = this.states.get(key);
      if (state?.status === 'failed') throw new Error(state.message || 'Studio 启动失败');
      if (state?.studioUrl) {
        try {
          await waitForLoopbackHttpReady(state.studioUrl, {
            timeoutMs: Math.min(1_500, Math.max(1, deadline - Date.now())),
          });
          return state.studioUrl;
        } catch (error) {
          lastReadinessError = error instanceof Error ? error : new Error(String(error));
        }
      }
      await delay(Math.min(250, Math.max(0, deadline - Date.now())));
    }
    if (lastReadinessError) throw lastReadinessError;
    throw new Error('等待 Studio 输出本机地址超时');
  }

  private async ensureDependencies(project: ProjectInfo): Promise<void> {
    if (project.hasRemotionCli) return;
    const runtime = await this.projectService.runtimeInfo();
    if (!runtime.npmPath) throw new Error('找不到 npm.cmd，请先在设置中选择 Node 目录');
    const args = project.hasPackageLock && !project.hasNodeModules ? ['ci'] : ['install'];
    const command = npmInvocation(runtime.npmPath, args);
    const state: TaskState = {projectId: project.id, kind: 'install', status: 'starting', startedAt: new Date().toISOString()};
    this.setState(state);
    await this.runOneShot(command.file, command.args, project.path, project.id, 'install');
    this.setState({...state, status: 'success', endedAt: new Date().toISOString(), exitCode: 0});
  }

  private async commandFor(project: ProjectInfo, kind: Exclude<TaskKind, 'install' | 'verify'>): Promise<{file: string; args: string[]}> {
    const runtime = await this.projectService.runtimeInfo();
    if (!runtime.npmPath || !runtime.nodePath) throw new Error('Node/npm 环境不可用');
    const script = project.scripts[kind];
    if (script) {
      if (!validScriptName.test(script)) throw new Error(`拒绝不安全的 npm 脚本名：${script}`);
      const args = ['run', script];
      const scriptCommand = project.packageScripts[script] ?? '';
      const passThrough: string[] = [];
      if (kind === 'studio' && !scriptCommand.includes('--no-open')) passThrough.push('--no-open');
      if (['studio', 'render', 'still'].includes(kind) && !scriptCommand.includes('--props')) {
        const propsArgument = remotionPropsArgument(project.path, project.settings?.file);
        if (propsArgument) passThrough.push(propsArgument);
      }
      if (passThrough.length > 0) args.push('--', ...passThrough);
      return npmInvocation(runtime.npmPath, args);
    }
    if (kind === 'studio' && project.entry) {
      const cli = path.join(project.path, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
      const propsArgument = remotionPropsArgument(project.path, project.settings?.file);
      return {file: runtime.nodePath, args: [cli, 'studio', project.entry, '--no-open', ...(propsArgument ? [propsArgument] : [])]};
    }
    if (kind === 'check' && project.entry) {
      const cli = path.join(project.path, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
      return {file: runtime.nodePath, args: [cli, 'compositions', project.entry]};
    }
    throw new Error(`工程没有可用的 ${kind} 脚本`);
  }

  private spawnTask(project: ProjectInfo, kind: TaskKind, file: string, args: string[]): TaskState {
    const child = spawn(file, args, {
      cwd: project.path,
      windowsHide: true,
      env: {...process.env, FORCE_COLOR: '0'},
    });
    if (!child.stdout || !child.stderr) throw new Error('无法捕获任务输出');
    const state: TaskState = {
      projectId: project.id,
      kind,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    const logPath = this.logPath(project.id, kind);
    this.running.set(taskKey(project.id, kind), {child: child as ChildProcessWithoutNullStreams, state, logPath});
    this.setState(state);
    this.attachOutput(project.id, kind, child as ChildProcessWithoutNullStreams, logPath);
    child.on('error', (error) => {
      const failed = {...state, status: 'failed' as const, endedAt: new Date().toISOString(), message: error.message, studioUrl: undefined};
      this.running.delete(taskKey(project.id, kind));
      this.setState(failed);
    });
    child.on('exit', (code) => {
      const current = this.running.get(taskKey(project.id, kind))?.state ?? this.states.get(taskKey(project.id, kind)) ?? state;
      const next: TaskState = {
        ...current,
        status: code === 0 ? 'success' : 'failed',
        endedAt: new Date().toISOString(),
        exitCode: code,
        message: code === 0 ? undefined : `退出代码：${code ?? 'unknown'}`,
        studioUrl: kind === 'studio' && code !== 0 ? undefined : current.studioUrl,
      };
      this.running.delete(taskKey(project.id, kind));
      this.setState(next);
    });
    return {...state};
  }

  private attachOutput(projectId: string, kind: TaskKind, child: ChildProcessWithoutNullStreams, logPath: string): void {
    const consume = (type: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString('utf8'));
      void this.appendLog(logPath, text);
      this.emit({projectId, kind, type, text});
      if (kind === 'studio') {
        const url = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?[^\s]*/i)?.[0]?.replace(/[),.;]+$/, '');
        if (url) {
          const running = this.running.get(taskKey(projectId, kind));
          if (running && running.state.studioUrl !== url) {
            running.state = {...running.state, studioUrl: url};
            this.setState(running.state);
          }
        }
      }
    };
    child.stdout.on('data', consume('stdout'));
    child.stderr.on('data', consume('stderr'));
  }

  private async runOneShot(file: string, args: string[], cwd: string, projectId: string, kind: TaskKind): Promise<string> {
    const child = spawn(file, args, {cwd, windowsHide: true, env: {...process.env, FORCE_COLOR: '0'}});
    let output = '';
    let errorOutput = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString('utf8'));
      output += text;
      this.emit({projectId, kind, type: 'stdout', text});
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString('utf8'));
      errorOutput += text;
      this.emit({projectId, kind, type: 'stderr', text});
    });
    return new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve(output + errorOutput);
        else reject(new Error((errorOutput || output || `退出代码 ${code}`).trim()));
      });
    });
  }

  private setState(state: TaskState): void {
    this.states.set(taskKey(state.projectId, state.kind), {...state});
    this.emit({projectId: state.projectId, kind: state.kind, type: 'state', state: {...state}});
  }

  private logPath(projectId: string, kind: TaskKind): string {
    const localRoot = process.env.LOCALAPPDATA || app.getPath('userData');
    return path.join(localRoot, 'RemotionProjectManager', 'logs', projectId, `${kind}.log`);
  }

  private async appendLog(filePath: string, text: string): Promise<void> {
    await mkdir(path.dirname(filePath), {recursive: true});
    await appendFile(filePath, text, 'utf8');
  }

  private async killTree(pid?: number): Promise<void> {
    if (!pid) return;
    if (process.platform !== 'win32') return new Promise((resolve) => {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
      resolve();
    });
    await new Promise<void>((resolve) => {
      execFile('C:\\Windows\\System32\\taskkill.exe', ['/PID', String(pid), '/T', '/F'], {windowsHide: true}, () => resolve());
    });
  }
}
