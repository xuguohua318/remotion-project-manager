import {describe, expect, it} from 'vitest';
import {countKeyframes, getNested, isLoopbackUrl, isPathInside, resolveInside, setNested} from '../src/main/utils';

describe('project path safety', () => {
  it('accepts files inside a project and rejects traversal', () => {
    expect(isPathInside('C:\\projects\\demo', 'C:\\projects\\demo\\src\\index.ts')).toBe(true);
    expect(isPathInside('C:\\projects\\demo', 'C:\\projects\\other\\index.ts')).toBe(false);
    expect(() => resolveInside('C:\\projects\\demo', '..\\other\\settings.json')).toThrow(/超出工程目录/);
  });
});

describe('nested settings helpers', () => {
  it('reads and writes nested keyframe containers', () => {
    const value: Record<string, unknown> = {camera: {tracks: {zoom: [{frame: 0, value: 1}]}}};
    expect(getNested(value, 'camera.tracks')).toEqual({zoom: [{frame: 0, value: 1}]});
    setNested(value, 'camera.ease', 'smooth');
    expect(getNested(value, 'camera.ease')).toBe('smooth');
    expect(countKeyframes(value, 'camera.tracks')).toEqual({tracks: 1, keyframes: 1});
  });
});

describe('studio URL safety', () => {
  it('only accepts loopback HTTP(S) URLs', () => {
    expect(isLoopbackUrl('http://127.0.0.1:3000/Composition')).toBe(true);
    expect(isLoopbackUrl('http://localhost:3001')).toBe(true);
    expect(isLoopbackUrl('https://example.com')).toBe(false);
    expect(isLoopbackUrl('file:///C:/secret')).toBe(false);
  });
});
