import {app, BrowserWindow, dialog, ipcMain, shell, WebContentsView} from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import path from 'node:path';
import type {IpcMainInvokeEvent} from 'electron';
import type {SetupDraft, StudioBounds, TaskEvent, TaskKind} from '../shared/types';
import {ProjectService} from './projects';
import {RegistryStore} from './registry';
import {SettingsService} from './settings';
import {TaskService} from './tasks';
import {isLoopbackUrl} from './utils';
import {VerificationService} from './verification';

let mainWindow: BrowserWindow | null = null;
let studioView: WebContentsView | null = null;
let studioProjectId: string | null = null;
let quitting = false;

const registry = new RegistryStore();
const projects = new ProjectService(registry);
const sendTaskEvent = (event: TaskEvent): void => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tasks:event', event);
};
const tasks = new TaskService(projects, sendTaskEvent);
const settings = new SettingsService(projects);
const verification = new VerificationService(projects, settings, tasks);

const trustedSender = (event: IpcMainInvokeEvent): boolean => {
  const url = event.senderFrame?.url;
  if (!url) return false;
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL && url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)) return true;
  return url.startsWith('file://');
};

const handle = <T extends unknown[], R>(channel: string, handler: (...args: T) => Promise<R> | R): void => {
  ipcMain.handle(channel, async (event, ...args: T) => {
    if (!trustedSender(event)) throw new Error('拒绝来自未授权页面的操作');
    return handler(...args);
  });
};

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#07111d',
    title: 'Remotion 工程管家',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return {action: 'deny'};
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = MAIN_WINDOW_VITE_DEV_SERVER_URL ? url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL) : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
    studioView = null;
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else void mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
};

const ensureStudioView = (): WebContentsView => {
  if (studioView) return studioView;
  studioView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  studioView.webContents.setWindowOpenHandler(({url}) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return {action: 'deny'};
  });
  studioView.webContents.on('will-navigate', (event, url) => {
    if (!isLoopbackUrl(url)) event.preventDefault();
  });
  return studioView;
};

const clampBounds = (bounds: StudioBounds): StudioBounds => ({
  x: Math.max(0, Math.round(bounds.x)),
  y: Math.max(0, Math.round(bounds.y)),
  width: Math.max(1, Math.round(bounds.width)),
  height: Math.max(1, Math.round(bounds.height)),
});

const registerIpc = (): void => {
  handle('projects:list', () => projects.list());
  handle('projects:pickAndImport', async () => {
    const result = await dialog.showOpenDialog({title: '选择 Remotion 工程', properties: ['openDirectory']});
    return result.canceled || !result.filePaths[0] ? null : projects.importProject(result.filePaths[0]);
  });
  handle('projects:importPath', (projectPath: string) => projects.importProject(projectPath));
  handle('projects:pickAndScan', async () => {
    const result = await dialog.showOpenDialog({title: '选择要扫描的目录', properties: ['openDirectory']});
    return result.canceled || !result.filePaths[0] ? [] : projects.scan(result.filePaths[0]);
  });
  handle('projects:remove', async (projectId: string) => {
    await tasks.stopAllForProject(projectId);
    await registry.remove(projectId);
  });
  handle('projects:refresh', (projectId: string) => projects.refresh(projectId));
  handle('projects:openFolder', async (projectId: string) => {
    const project = await projects.refresh(projectId);
    const error = await shell.openPath(project.path);
    if (error) throw new Error(error);
  });

  handle('runtime:get', () => projects.runtimeInfo());
  handle('runtime:pickNodeDirectory', async () => {
    const result = await dialog.showOpenDialog({title: '选择包含 node.exe 和 npm.cmd 的目录', properties: ['openDirectory']});
    return result.canceled || !result.filePaths[0] ? null : projects.setNodeDirectory(result.filePaths[0]);
  });

  handle('tasks:run', (projectId: string, kind: TaskKind) => tasks.run(projectId, kind));
  handle('tasks:stop', (projectId: string, kind: TaskKind) => tasks.stop(projectId, kind));
  handle('tasks:states', () => tasks.getStates());

  handle('settings:load', (projectId: string) => settings.load(projectId));
  handle('settings:save', (projectId: string, value: Record<string, unknown>) => settings.save(projectId, value));
  handle('settings:export', (projectId: string, value: Record<string, unknown>) => settings.exportJson(projectId, value));
  handle('settings:import', (projectId: string) => settings.importJson(projectId));
  handle('settings:beginSetup', (projectId: string) => settings.beginSetup(projectId));
  handle('settings:completeSetup', (projectId: string, draft: SetupDraft) => settings.completeSetup(projectId, draft));
  handle('settings:verify', (projectId: string) => verification.run(projectId));

  handle('studio:show', async (projectId: string, rawBounds: StudioBounds) => {
    if (!mainWindow) throw new Error('主窗口不可用');
    const url = await tasks.startStudioAndWait(projectId);
    if (!isLoopbackUrl(url)) throw new Error('拒绝加载非本机 Studio 地址');
    const view = ensureStudioView();
    if (studioProjectId !== projectId || view.webContents.getURL() !== url) {
      try {
        await view.webContents.loadURL(url);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/ERR_CONNECTION_(?:REFUSED|RESET)|ERR_FAILED/i.test(message)) throw error;
        const readyUrl = await tasks.startStudioAndWait(projectId, 15_000);
        await view.webContents.loadURL(readyUrl);
      }
    }
    studioProjectId = projectId;
    if (!mainWindow.contentView.children.includes(view)) mainWindow.contentView.addChildView(view);
    view.setBounds(clampBounds(rawBounds));
  });
  handle('studio:hide', () => {
    if (mainWindow && studioView && mainWindow.contentView.children.includes(studioView)) mainWindow.contentView.removeChildView(studioView);
  });
  handle('studio:setBounds', (bounds: StudioBounds) => {
    if (studioView && mainWindow?.contentView.children.includes(studioView)) studioView.setBounds(clampBounds(bounds));
  });
  handle('studio:openExternal', async (projectId: string) => {
    const url = await tasks.startStudioAndWait(projectId);
    if (!isLoopbackUrl(url)) throw new Error('拒绝打开非本机地址');
    await shell.openExternal(url);
  });
};

if (!squirrelStartup) {
  app.whenReady().then(async () => {
    await registry.load();
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    const projectIds = new Set(tasks.getStates().map((state) => state.projectId));
    void Promise.all(Array.from(projectIds).map((projectId) => tasks.stopAllForProject(projectId))).finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
