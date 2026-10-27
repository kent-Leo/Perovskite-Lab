import {
  validateSpectrum, waveRange, type WaveRange, type SuggestedRegion,
} from '../../shared/ai-contract-v0.9.1-2026.10.27';
import type { Point, Spectrum } from './types';

export interface ProcessingRegion extends SuggestedRegion {
  id: string;
  enabled: boolean;
  origin: 'manual' | 'ai';
}
export interface ProcessingPlan {
  regions: ProcessingRegion[];
  protectedRange: WaveRange | null;
  subtractBlank: boolean;
  blank: Spectrum | null;
  sameConditions: boolean;
}
export interface ProcessedPoint {
  x: number;
  original: number;
  blank: number | null;
  y: number | null;
  reason: string;
}
export interface ProcessedSpectrum {
  id: string;
  name: string;
  color: string;
  source: string;
  points: ProcessedPoint[];
}
export interface ProcessingResult {
  spectra: ProcessedSpectrum[];
  originals: Spectrum[];
  plan: ProcessingPlan;
}
export function overlaps(a: WaveRange, b: WaveRange) {
  return a.fromNm <= b.toNm && b.fromNm <= a.toNm;
}
function atWavelength(points: Point[], x: number) {
  if (x < points[0].x || x > points.at(-1)!.x) throw new Error('空白波长范围未覆盖样品，不能外推扣除');
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].x < x) lo = mid + 1;
    else hi = mid;
  }
  const right = points[lo];
  if (right.x === x) return right.y;
  const left = points[lo - 1];
  return left.y + (right.y - left.y) * (x - left.x) / (right.x - left.x);
}
/** Masks preserve rows and gaps. Blank correction never extrapolates or clips negatives. */
export function processSpectra(spectra: Spectrum[], plan: ProcessingPlan): ProcessingResult {
  if (!spectra.length) throw new Error('请选择待处理光谱');
  const originals = spectra.map((s) => ({ ...s, ...validateSpectrum(s) }));
  const protectedRange = plan.protectedRange ? waveRange(plan.protectedRange) : null;
  const regions = plan.regions.filter((r) => r.enabled);
  if (!regions.length && !plan.subtractBlank) throw new Error('请勾选排除区间，或启用空白扣除');
  if (plan.subtractBlank && (!plan.blank || !plan.sameConditions))
    throw new Error('空白扣除需要选择空白，并确认与样品的测量条件一致');
  const blank = plan.subtractBlank ? validateSpectrum(plan.blank) : null;
  if (blank && originals.some((s) => s.id === blank.id)) throw new Error('空白不能作为待处理样品');
  for (const region of regions) {
    const range = waveRange(region), spectrum = originals.find((s) => s.id === region.spectrumId);
    if (!spectrum) throw new Error('排除区间引用了未选中的光谱');
    if (protectedRange && overlaps(range, protectedRange)) throw new Error('排除区间与目标保护区重叠，请先调整区间');
    if (range.fromNm < spectrum.points[0].x || range.toNm > spectrum.points.at(-1)!.x)
      throw new Error('排除区间超出样品测量范围');
    if (!spectrum.points.some((p) => p.x >= range.fromNm && p.x <= range.toNm))
      throw new Error('排除区间内没有测量点');
  }
  const processed = originals.map((s) => {
    const ownRegions = regions.filter((r) => r.spectrumId === s.id);
    const points = s.points.map((p) => {
      const excluded = ownRegions.filter((r) => p.x >= r.fromNm && p.x <= r.toNm);
      const background = blank ? atWavelength(blank.points, p.x) : null;
      const corrected = p.y - (background ?? 0);
      if (!Number.isFinite(corrected)) throw new Error('扣除结果超出数值范围');
      return { x: p.x, original: p.y, blank: background,
        y: excluded.length ? null : corrected,
        reason: excluded.map((r) => r.reason).join('；') };
    });
    return { id: s.id, name: s.name, color: s.color, source: s.source, points };
  });
  return {
    originals, spectra: processed,
    plan: { ...plan, regions: plan.regions.map((r) => ({ ...r })), protectedRange,
      blank: plan.blank ? { ...plan.blank, points: plan.blank.points.map((p) => ({ ...p })) } : null },
  };
}
/** A new polyline per contiguous measured run prevents bridges across masked intervals. */
export function processedSegments(points: ProcessedPoint[]): Point[][] {
  const segments: Point[][] = [];
  let run: Point[] = [];
  for (const point of points) {
    if (point.y === null) {
      if (run.length) segments.push(run);
      run = [];
    } else run.push({ x: point.x, y: point.y });
  }
  if (run.length) segments.push(run);
  return segments;
}
