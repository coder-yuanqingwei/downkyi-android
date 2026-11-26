import type { QualityOption } from './types';

export function selectQuality(requested: number, qualities: QualityOption[]): QualityOption {
  if (!qualities.length) throw new Error('没有可用画质');
  const exact = qualities.find((quality) => quality.id === requested);
  if (exact) return exact;
  const sorted = [...qualities].sort((a, b) => b.id - a.id);
  return sorted.find((quality) => quality.id <= requested) ?? sorted[sorted.length - 1];
}

export function commonQualities(lists: QualityOption[][]): QualityOption[] {
  if (!lists.length) return [];
  return lists.reduce<QualityOption[]>(
    (common, list) => common.filter((option) => list.some((item) => item.id === option.id)),
    lists[0],
  );
}
