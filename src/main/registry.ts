import {app} from 'electron';
import {mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import type {AppRegistry, ProjectRegistryEntry} from '../shared/types';
import {projectIdForPath, writeJsonAtomic} from './utils';

const defaultRegistry = (): AppRegistry => ({
  version: 1,
  nodeDirectory: 'C:\\Meapp\\node',
  projects: [],
});

export class RegistryStore {
  private readonly filePath: string;
  private value: AppRegistry = defaultRegistry();

  constructor() {
    this.filePath = path.join(app.getPath('appData'), 'RemotionProjectManager', 'projects.json');
  }

  async load(): Promise<void> {
    try {
      this.value = JSON.parse(await readFile(this.filePath, 'utf8')) as AppRegistry;
      if (this.value.version !== 1 || !Array.isArray(this.value.projects)) throw new Error('Unsupported registry');
    } catch {
      this.value = defaultRegistry();
      await this.save();
    }
  }

  get(): AppRegistry {
    return structuredClone(this.value);
  }

  getProject(projectId: string): ProjectRegistryEntry {
    const project = this.value.projects.find((item) => item.id === projectId);
    if (!project) throw new Error('工程不存在或已从列表移除');
    return structuredClone(project);
  }

  async add(projectPath: string): Promise<ProjectRegistryEntry> {
    const now = new Date().toISOString();
    const id = projectIdForPath(projectPath);
    const existing = this.value.projects.find((item) => item.id === id);
    if (existing) {
      existing.path = projectPath;
      existing.lastOpenedAt = now;
      await this.save();
      return structuredClone(existing);
    }
    const entry: ProjectRegistryEntry = {id, path: projectPath, addedAt: now, lastOpenedAt: now};
    this.value.projects.push(entry);
    await this.save();
    return structuredClone(entry);
  }

  async remove(projectId: string): Promise<void> {
    this.value.projects = this.value.projects.filter((item) => item.id !== projectId);
    await this.save();
  }

  async setNodeDirectory(nodeDirectory: string): Promise<void> {
    this.value.nodeDirectory = nodeDirectory;
    await this.save();
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), {recursive: true});
    await writeJsonAtomic(this.filePath, this.value);
  }
}
