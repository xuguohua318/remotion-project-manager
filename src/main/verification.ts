import {appendFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import type {VerificationResult} from '../shared/types';
import {ProjectService} from './projects';
import {SettingsService} from './settings';
import {TaskService} from './tasks';
import {countKeyframes, writeJsonAtomic} from './utils';

export class VerificationService {
  constructor(
    private readonly projects: ProjectService,
    private readonly settings: SettingsService,
    private readonly tasks: TaskService,
  ) {}

  async run(projectId: string): Promise<VerificationResult> {
    const checkedAt = new Date().toISOString();
    const errors: string[] = [];
    const project = await this.projects.refresh(projectId);
    let beforeHash: string | undefined;
    let afterHash: string | undefined;
    let tracks: number | undefined;
    let keyframes: number | undefined;
    let compositionsOutput = '';
    let studioUrl: string | undefined;

    try {
      if (project.settings) {
        const before = await this.settings.load(projectId);
        beforeHash = before.hash;
        const counts = countKeyframes(before.value, before.config.keyframes?.containerPath);
        tracks = counts.tracks;
        keyframes = counts.keyframes;
      }
      await this.tasks.stop(projectId, 'studio');
      compositionsOutput = await this.tasks.runCompositions(project);
      studioUrl = await this.tasks.startStudioAndWait(projectId);
      const response = await fetch(studioUrl, {signal: AbortSignal.timeout(10_000)});
      if (!response.ok) throw new Error(`Studio 返回 HTTP ${response.status}`);
      if (project.settings) {
        const after = await this.settings.load(projectId);
        afterHash = after.hash;
        const afterCounts = countKeyframes(after.value, after.config.keyframes?.containerPath);
        if (beforeHash !== afterHash) errors.push('重启前后参数文件哈希不一致');
        if (tracks !== afterCounts.tracks || keyframes !== afterCounts.keyframes) errors.push('重启前后关键帧数量不一致');
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    const verificationDir = path.join(project.path, '.remotion-manager', 'verification');
    await mkdir(verificationDir, {recursive: true});
    const result: VerificationResult = {
      ok: errors.length === 0,
      checkedAt,
      beforeHash,
      afterHash,
      keyframeTracks: tracks,
      keyframes,
      compositionsOutput,
      studioUrl,
      errors,
      reportPath: path.join(verificationDir, 'latest.json'),
    };
    await writeJsonAtomic(result.reportPath, result);
    const markdownPath = path.join(project.path, 'VERIFICATION.md');
    const summary = [
      `\n## ${checkedAt} · Remotion 工程管家`,
      '',
      `- 结果：${result.ok ? '通过' : '失败'}`,
      `- 参数哈希：${beforeHash ?? '无参数清单'} → ${afterHash ?? '无参数清单'}`,
      `- 参数轨道：${tracks ?? 0}`,
      `- 关键帧：${keyframes ?? 0}`,
      `- Studio：${studioUrl ?? '未启动'}`,
      `- 错误：${errors.length ? errors.join('；') : '无'}`,
      '',
    ].join('\n');
    await appendFile(markdownPath, summary, 'utf8');
    return result;
  }
}
