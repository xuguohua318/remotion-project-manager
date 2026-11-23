import {dialog} from 'electron';
import Ajv2020 from 'ajv/dist/2020';
import {copyFile, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {
  JsonSchemaDocument,
  JsonSchemaProperty,
  ProjectInfo,
  RemotionManagerManifest,
  SettingsDocument,
  SetupDraft,
  SetupField,
} from '../shared/types';
import {ProjectService} from './projects';
import {getNested, hashText, readJson, resolveInside, setNested, writeJsonAtomic} from './utils';

const clone = <T>(value: T): T => structuredClone(value);

export class SettingsService {
  private readonly ajv = new Ajv2020({allErrors: true, strict: false, multipleOfPrecision: 8});

  constructor(private readonly projects: ProjectService) {}

  async load(projectId: string): Promise<SettingsDocument> {
    const project = await this.projects.refresh(projectId);
    if (!project.settings) throw new Error('该工程尚未接入参数编辑');
    const filePath = resolveInside(project.path, project.settings.file);
    const schemaPath = resolveInside(project.path, project.settings.schema);
    const text = await readFile(filePath, 'utf8');
    return {
      value: JSON.parse(text) as Record<string, unknown>,
      schema: await readJson<JsonSchemaDocument>(schemaPath),
      config: clone(project.settings),
      filePath,
      hash: hashText(text),
    };
  }

  async save(projectId: string, input: Record<string, unknown>): Promise<SettingsDocument> {
    const project = await this.projects.refresh(projectId);
    const current = await this.load(projectId);
    const value = clone(input);
    const validate = this.ajv.compile(current.schema as object);
    if (!validate(value)) {
      const message = validate.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('；');
      throw new Error(`参数校验失败：${message}`);
    }
    this.normalizeAndValidateKeyframes(value, current);
    await this.backup(project.path, current.filePath);
    await writeJsonAtomic(current.filePath, value);
    return this.load(projectId);
  }

  async exportJson(projectId: string, value: Record<string, unknown>): Promise<string | null> {
    const project = await this.projects.refresh(projectId);
    const result = await dialog.showSaveDialog({
      title: '导出参数 JSON',
      defaultPath: path.join(project.path, `${project.displayName}-settings.json`),
      filters: [{name: 'JSON', extensions: ['json']}],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return result.filePath;
  }

  async importJson(projectId: string): Promise<Record<string, unknown> | null> {
    const project = await this.projects.refresh(projectId);
    const result = await dialog.showOpenDialog({
      title: '导入参数 JSON',
      defaultPath: project.path,
      properties: ['openFile'],
      filters: [{name: 'JSON', extensions: ['json']}],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const value = JSON.parse(await readFile(result.filePaths[0], 'utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON 顶层必须是对象');
    return value as Record<string, unknown>;
  }

  async beginSetup(projectId: string): Promise<SetupDraft | null> {
    const project = await this.projects.refresh(projectId);
    const result = await dialog.showOpenDialog({
      title: '选择工程内的参数 JSON',
      defaultPath: project.path,
      properties: ['openFile'],
      filters: [{name: 'JSON', extensions: ['json']}],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const absolutePath = path.resolve(result.filePaths[0]);
    if (!absolutePath.startsWith(path.resolve(project.path) + path.sep)) throw new Error('参数 JSON 必须位于工程目录内');
    const value = JSON.parse(await readFile(absolutePath, 'utf8')) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON 顶层必须是对象');
    const keyframePath = value.cameraKeyframes && typeof value.cameraKeyframes === 'object' ? 'cameraKeyframes' : undefined;
    const keyframeKeys = keyframePath ? new Set(Object.keys(value.cameraKeyframes as Record<string, unknown>)) : new Set<string>();
    const fields = Object.entries(value)
      .filter(([key, field]) => key !== keyframePath && ['number', 'boolean', 'string'].includes(typeof field))
      .map(([key, field]) => this.inferField(key, field as string | number | boolean, keyframeKeys.has(key)));
    return {
      settingsRelativePath: path.relative(project.path, absolutePath).replaceAll('\\', '/'),
      compositionId: project.displayName,
      fps: 30,
      durationInFrames: 300,
      keyframeContainerPath: keyframePath,
      easingPath: typeof value.cameraEase === 'string' ? 'cameraEase' : undefined,
      fields,
    };
  }

  async completeSetup(projectId: string, draft: SetupDraft): Promise<ProjectInfo> {
    const project = await this.projects.refresh(projectId);
    resolveInside(project.path, draft.settingsRelativePath);
    if (!Number.isInteger(draft.fps) || draft.fps <= 0) throw new Error('fps 必须是正整数');
    if (!Number.isInteger(draft.durationInFrames) || draft.durationInFrames <= 0) throw new Error('总帧数必须是正整数');
    const schemaFile = 'remotion-manager.schema.json';
    const properties: Record<string, JsonSchemaProperty> = {};
    for (const field of draft.fields) {
      properties[field.key] = {
        type: field.type,
        title: field.title || field.key,
        ...(field.type === 'number' || field.type === 'integer' ? {
          minimum: field.minimum,
          maximum: field.maximum,
        } : {}),
        'x-remotion-ui': {
          control: field.type === 'boolean' ? 'checkbox' : field.type === 'string' ? 'text' : 'slider',
          group: field.group,
          unit: field.unit,
          step: field.step,
          keyframable: field.keyframable,
        },
      };
    }
    const schema: JsonSchemaDocument = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties,
      required: draft.fields.map((field) => field.key),
      additionalProperties: true,
    };
    const manifest: RemotionManagerManifest = {
      version: 1,
      displayName: project.displayName,
      entry: project.entry ?? 'src/index.ts',
      packageManager: 'npm',
      scripts: project.scripts,
      settings: {
        file: draft.settingsRelativePath,
        schema: schemaFile,
        compositionId: draft.compositionId,
        timeline: {fps: draft.fps, durationInFrames: draft.durationInFrames},
        ...(draft.keyframeContainerPath ? {
          keyframes: {containerPath: draft.keyframeContainerPath, easingPath: draft.easingPath},
        } : {}),
      },
    };
    await writeJsonAtomic(path.join(project.path, schemaFile), schema);
    await writeJsonAtomic(path.join(project.path, 'remotion-manager.json'), manifest);
    return this.projects.refresh(projectId);
  }

  private inferField(key: string, value: string | number | boolean, keyframable: boolean): SetupField {
    if (typeof value === 'number') {
      const magnitude = Math.max(Math.abs(value), 1);
      const decimal = !Number.isInteger(value);
      return {
        key,
        title: key,
        type: decimal ? 'number' : 'integer',
        value,
        minimum: value < 0 ? -magnitude * 2 : 0,
        maximum: magnitude * 2,
        step: decimal ? 0.01 : 1,
        group: '参数',
        keyframable,
      };
    }
    return {key, title: key, type: typeof value as 'boolean' | 'string', value, group: '参数', keyframable: false};
  }

  private normalizeAndValidateKeyframes(value: Record<string, unknown>, document: SettingsDocument): void {
    const config = document.config.keyframes;
    if (!config) return;
    const container = getNested(value, config.containerPath);
    if (!container || typeof container !== 'object' || Array.isArray(container)) throw new Error('关键帧容器必须是对象');
    const maximumFrame = document.config.timeline.durationInFrames - 1;
    const normalized: Record<string, unknown> = {};
    for (const [key, track] of Object.entries(container as Record<string, unknown>)) {
      if (!Array.isArray(track)) throw new Error(`${key} 的关键帧必须是数组`);
      const seen = new Set<number>();
      const points = track.map((point) => {
        if (!point || typeof point !== 'object') throw new Error(`${key} 包含无效关键帧`);
        const frame = Number((point as Record<string, unknown>).frame);
        const pointValue = Number((point as Record<string, unknown>).value);
        if (!Number.isInteger(frame) || frame < 0 || frame > maximumFrame) throw new Error(`${key} 的帧必须位于 0-${maximumFrame}`);
        if (!Number.isFinite(pointValue)) throw new Error(`${key} 包含无效数值`);
        if (seen.has(frame)) throw new Error(`${key} 在第 ${frame} 帧存在重复关键帧`);
        seen.add(frame);
        return {frame, value: pointValue};
      }).sort((a, b) => a.frame - b.frame);
      normalized[key] = points;
    }
    setNested(value, config.containerPath, normalized);
  }

  private async backup(projectPath: string, filePath: string): Promise<void> {
    const backupRoot = path.join(projectPath, '.remotion-manager', 'backups', path.basename(filePath, path.extname(filePath)));
    await mkdir(backupRoot, {recursive: true});
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    await copyFile(filePath, path.join(backupRoot, `${stamp}.json`));
    const files = (await readdir(backupRoot)).filter((name) => name.endsWith('.json')).sort().reverse();
    await Promise.all(files.slice(20).map((name) => rm(path.join(backupRoot, name), {force: true})));
  }
}
