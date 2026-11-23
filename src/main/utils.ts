import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';

export const readJson = async <T>(filePath: string): Promise<T> => {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
};

export const writeJsonAtomic = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), {recursive: true});
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
};

export const hashText = (text: string): string => {
  return createHash('sha256').update(text).digest('hex').toUpperCase();
};

export const hashFile = async (filePath: string): Promise<string> => {
  return hashText(await readFile(filePath, 'utf8'));
};

export const projectIdForPath = (projectPath: string): string => {
  return createHash('sha256').update(path.resolve(projectPath).toLowerCase()).digest('hex').slice(0, 16);
};

export const isPathInside = (parent: string, candidate: string): boolean => {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export const resolveInside = (projectPath: string, relativePath: string): string => {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`必须使用工程内相对路径：${relativePath}`);
  }
  const resolved = path.resolve(projectPath, relativePath);
  if (!isPathInside(projectPath, resolved)) {
    throw new Error(`路径超出工程目录：${relativePath}`);
  }
  return resolved;
};

export const stripAnsi = (value: string): string => {
  return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
};

export const getNested = (value: unknown, dotPath?: string): unknown => {
  if (!dotPath) return value;
  return dotPath.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
};

export const setNested = (value: Record<string, unknown>, dotPath: string, next: unknown): void => {
  const parts = dotPath.split('.');
  let current = value;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = next;
      return;
    }
    const child = current[part];
    if (!child || typeof child !== 'object' || Array.isArray(child)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  });
};

export const countKeyframes = (value: unknown, containerPath?: string): {tracks: number; keyframes: number} => {
  const container = getNested(value, containerPath);
  if (!container || typeof container !== 'object' || Array.isArray(container)) return {tracks: 0, keyframes: 0};
  const entries = Object.values(container as Record<string, unknown>);
  return {
    tracks: entries.length,
    keyframes: entries.reduce<number>((sum, points) => sum + (Array.isArray(points) ? points.length : 0), 0),
  };
};

export const isLoopbackUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1');
  } catch {
    return false;
  }
};
