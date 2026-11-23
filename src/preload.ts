import {contextBridge, ipcRenderer, webUtils} from 'electron';
import type {RemotionManagerApi, SetupDraft, StudioBounds, TaskEvent, TaskKind} from './shared/types';

const api: RemotionManagerApi = {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    pickAndImport: () => ipcRenderer.invoke('projects:pickAndImport'),
    importPath: (projectPath) => ipcRenderer.invoke('projects:importPath', projectPath),
    pickAndScan: () => ipcRenderer.invoke('projects:pickAndScan'),
    remove: (projectId) => ipcRenderer.invoke('projects:remove', projectId),
    refresh: (projectId) => ipcRenderer.invoke('projects:refresh', projectId),
    openFolder: (projectId) => ipcRenderer.invoke('projects:openFolder', projectId),
  },
  runtime: {
    get: () => ipcRenderer.invoke('runtime:get'),
    pickNodeDirectory: () => ipcRenderer.invoke('runtime:pickNodeDirectory'),
  },
  tasks: {
    run: (projectId, kind: TaskKind) => ipcRenderer.invoke('tasks:run', projectId, kind),
    stop: (projectId, kind: TaskKind) => ipcRenderer.invoke('tasks:stop', projectId, kind),
    states: () => ipcRenderer.invoke('tasks:states'),
    onEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, taskEvent: TaskEvent) => callback(taskEvent);
      ipcRenderer.on('tasks:event', listener);
      return () => ipcRenderer.removeListener('tasks:event', listener);
    },
  },
  settings: {
    load: (projectId) => ipcRenderer.invoke('settings:load', projectId),
    save: (projectId, value) => ipcRenderer.invoke('settings:save', projectId, value),
    exportJson: (projectId, value) => ipcRenderer.invoke('settings:export', projectId, value),
    importJson: (projectId) => ipcRenderer.invoke('settings:import', projectId),
    beginSetup: (projectId) => ipcRenderer.invoke('settings:beginSetup', projectId),
    completeSetup: (projectId, draft: SetupDraft) => ipcRenderer.invoke('settings:completeSetup', projectId, draft),
    verify: (projectId) => ipcRenderer.invoke('settings:verify', projectId),
  },
  studio: {
    show: (projectId, bounds: StudioBounds) => ipcRenderer.invoke('studio:show', projectId, bounds),
    hide: () => ipcRenderer.invoke('studio:hide'),
    setBounds: (bounds: StudioBounds) => ipcRenderer.invoke('studio:setBounds', bounds),
    openExternal: (projectId) => ipcRenderer.invoke('studio:openExternal', projectId),
  },
  files: {
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
};

contextBridge.exposeInMainWorld('remotionManager', api);
