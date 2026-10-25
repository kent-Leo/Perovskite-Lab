import type { WaveRange } from '../../shared/ai-contract-2026.10.24';
import type { Point } from './types';

export interface ScanRangeDraft { from: string; to: string }

/** A processing window within the measured range, inclusive of both endpoints. */
export function validateAssistantScanRange(points: Point[], range: WaveRange): WaveRange {
  const { fromNm, toNm } = range;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x <= 0 || (i > 0 && p.x <= points[i - 1].x))
      throw new Error('原始光谱必须包含有限数值及严格递增的正波长');
  }
  if (!Number.isFinite(fromNm) || !Number.isFinite(toNm) || fromNm >= toNm)
    throw new Error('扫描范围终点必须大于起点，且均为有效数字');
  if (!points.length || fromNm < points[0].x || toNm > points.at(-1)!.x)
    throw new Error('扫描范围不能超出文件的实际测量范围');
  if (points.filter(p => p.x >= fromNm && p.x <= toNm).length < 5)
    throw new Error('扫描范围内至少需要 5 个实际测量点');
  return { fromNm, toNm };
}

export function resolveAssistantScanRange(points: Point[], draft: ScanRangeDraft | null): WaveRange | null {
  if (!draft) return null;
  if (!draft.from.trim() || !draft.to.trim()) throw new Error('请填写扫描范围的起点和终点');
  return validateAssistantScanRange(points, { fromNm: Number(draft.from), toNm: Number(draft.to) });
}
