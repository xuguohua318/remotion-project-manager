export interface ParameterKeyframe {
  frame: number;
  value: number;
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const smooth = (value: number): number => {
  const normalized = clamp(value);
  return normalized * normalized * (3 - 2 * normalized);
};

export const sampleParameterTrack = (
  points: ParameterKeyframe[],
  frame: number,
  easing: string,
  fallback: number,
): number => {
  const sorted = points
    .filter((point) => Number.isFinite(point.frame) && Number.isFinite(point.value))
    .map((point) => ({...point}))
    .sort((a, b) => a.frame - b.frame);
  if (sorted.length === 0) return fallback;
  if (frame <= sorted[0].frame) return sorted[0].value;
  if (frame >= sorted[sorted.length - 1].frame) return sorted[sorted.length - 1].value;
  for (let index = 1; index < sorted.length; index += 1) {
    const right = sorted[index];
    if (frame <= right.frame) {
      const left = sorted[index - 1];
      const progress = (frame - left.frame) / Math.max(1, right.frame - left.frame);
      const amount = easing === 'hold' ? 0 : easing === 'linear' ? progress : smooth(progress);
      return left.value + (right.value - left.value) * amount;
    }
  }
  return fallback;
};

export const upsertParameterKeyframe = (
  points: ParameterKeyframe[],
  frame: number,
  value: number,
): ParameterKeyframe[] => {
  const next = points.map((point) => ({...point}));
  const existing = next.find((point) => point.frame === frame);
  if (existing) existing.value = value;
  else next.push({frame, value});
  return next.sort((a, b) => a.frame - b.frame);
};
