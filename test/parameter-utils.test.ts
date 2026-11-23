import {describe, expect, it} from 'vitest';
import {sampleParameterTrack, upsertParameterKeyframe} from '../src/renderer/parameter-utils';

describe('parameter keyframes', () => {
  it('shows the effective value at the selected frame', () => {
    const points = [{frame: 0, value: 10}, {frame: 10, value: 20}];
    expect(sampleParameterTrack(points, 0, 'linear', 0)).toBe(10);
    expect(sampleParameterTrack(points, 5, 'linear', 0)).toBe(15);
    expect(sampleParameterTrack(points, 20, 'linear', 0)).toBe(20);
  });

  it('automatically adds or updates the selected-frame keyframe', () => {
    const points = [{frame: 0, value: 10}, {frame: 10, value: 20}];
    expect(upsertParameterKeyframe(points, 5, 16)).toEqual([
      {frame: 0, value: 10},
      {frame: 5, value: 16},
      {frame: 10, value: 20},
    ]);
    expect(upsertParameterKeyframe(points, 10, 22)).toEqual([
      {frame: 0, value: 10},
      {frame: 10, value: 22},
    ]);
  });
});
