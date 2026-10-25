import type { WaveRange } from '../../shared/ai-contract-2026.10.24';
import type { Point } from './types';

/**
 * Deterministic numerical processing behind the AI assistant.
 *
 * Responsibilities are deliberately narrow:
 *  - Hampel/MAD detects isolated spikes.
 *  - Only short runs with two valid anchors are repaired by local linear interpolation.
 *  - Long runs and optional scattering windows are masked (null), never filled.
 *  - Auto-detected emission peaks and the user's protected range are excluded.
 * AI never writes intensity values; it only annotates this result.
 */

export const ASSISTANT_ALGORITHM_VERSION = 'assistant-numeric-2026.10.25.1';

export type AssistantSensitivity = 'conservative' | 'balanced' | 'aggressive';
export const SENSITIVITY_THRESHOLD: Record<AssistantSensitivity, number> = {
  conservative: 5,
  balanced: 4,
  aggressive: 3,
};

export interface AssistantParameters {
  sensitivity: AssistantSensitivity;
  /** Robust z-score cut-off. Lower values flag more points. */
  thresholdSigma: number;
  /** Centred Hampel window in points (forced odd, 5–15). */
  windowSize: number;
  /** Maximum consecutive flagged points that may be interpolated. */
  maxRepairRun: number;
  /** When false, anomalies are only recorded and original values are retained. */
  repairSpikes: boolean;
  protectMainPeak: boolean;
  /** Extra protection margin around auto-detected emission peaks, in nm. */
  protectExtraNm: number;
  userProtectedRange: WaveRange | null;
  /** Restrict new detections/repairs to this range; protection still applies. */
  analysisRange: WaveRange | null;
  maskScattering: boolean;
  /** Half-width around expected Rayleigh/Raman positions, in nm. */
  scatteringToleranceNm: number;
  /** Mask, rather than retain, runs that are too long to repair. */
  maskUnrepairable: boolean;
}

export interface AssistantBlankInput {
  name: string;
  points: Point[];
}

export interface AssistantProcessInput {
  points: Point[];
  /** Original source line numbers, aligned with points (for audit/export). */
  rowNumbers?: (number | null)[];
  excitationNm: number | null;
  solvent?: string;
  slitNm?: number | null;
  blank?: AssistantBlankInput | null;
  subtractBlank: boolean;
  blankSameConditions: boolean;
  parameters: AssistantParameters;
}

export type AssistantPointStatus = 'normal' | 'repaired' | 'masked' | 'unresolved';
export type AssistantAnomalyKind =
  | 'positive-spike'
  | 'negative-spike'
  | 'scattering'
  | 'unrepairable';
export type AssistantAnomalyStatus = 'repaired' | 'masked' | 'unresolved' | 'suggested';

export interface AssistantPoint {
  index: number;
  x: number;
  original: number;
  blank: number | null;
  corrected: number;
  processed: number | null;
  status: AssistantPointStatus;
  anomalyKind: AssistantAnomalyKind | null;
  anomalyId: string | null;
  method: string;
  reason: string;
  protected: boolean;
  rowNumber: number | null;
}

export interface AssistantAnomaly {
  id: string;
  kind: AssistantAnomalyKind;
  status: AssistantAnomalyStatus;
  fromIndex: number;
  toIndex: number;
  fromNm: number;
  toNm: number;
  wavelengths: number[];
  originalValues: number[];
  processedValues: (number | null)[];
  deviation: number;
  method: string;
  reason: string;
  /** Optional classification note returned by the AI relay. Never changes numbers. */
  aiNote?: string;
}

export type ScatteringType = 'rayleigh' | 'second-order' | 'raman';

export interface ScatteringCandidate {
  id: string;
  type: ScatteringType;
  label: string;
  fromNm: number;
  toNm: number;
  evidence: string[];
  overlapsProtected: boolean;
  blankSignal: number | null;
}

export interface AssistantCheck {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface AssistantMainPeak {
  originalX: number;
  originalY: number;
  correctedY: number;
  processedX: number | null;
  processedY: number | null;
  shiftNm: number | null;
  heightRatio: number | null;
}

export interface AssistantProcessingResult {
  algorithmVersion: string;
  parameters: AssistantParameters;
  points: AssistantPoint[];
  anomalies: AssistantAnomaly[];
  protectedRanges: WaveRange[];
  autoProtectedRange: WaveRange | null;
  mainPeak: AssistantMainPeak | null;
  scattering: ScatteringCandidate[];
  checks: AssistantCheck[];
  blank: { used: boolean; name: string; coverage: string } | null;
  stats: {
    points: number;
    protectedPoints: number;
    anomalies: number;
    repaired: number;
    masked: number;
    unresolved: number;
    scatteringCandidates: number;
  };
  warnings: string[];
}

export const DEFAULT_ASSISTANT_PARAMETERS: AssistantParameters = {
  sensitivity: 'balanced',
  thresholdSigma: SENSITIVITY_THRESHOLD.balanced,
  windowSize: 7,
  maxRepairRun: 3,
  repairSpikes: true,
  protectMainPeak: true,
  protectExtraNm: 2,
  userProtectedRange: null,
  analysisRange: null,
  maskScattering: false,
  scatteringToleranceNm: 3,
  maskUnrepairable: true,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function normalizeAssistantParameters(
  parameters: AssistantParameters,
): AssistantParameters {
  const finite = (value: number, fallback: number) =>
    Number.isFinite(value) ? value : fallback;
  const window = Math.round(finite(parameters.windowSize, 7));
  return {
    sensitivity: ['conservative', 'balanced', 'aggressive'].includes(parameters.sensitivity)
      ? parameters.sensitivity
      : 'balanced',
    thresholdSigma: clamp(finite(parameters.thresholdSigma, 4), 2.5, 10),
    windowSize: Math.round(clamp(window % 2 ? window : window + 1, 5, 15)),
    maxRepairRun: Math.round(clamp(finite(parameters.maxRepairRun, 3), 1, 10)),
    repairSpikes: parameters.repairSpikes !== false,
    protectMainPeak: parameters.protectMainPeak !== false,
    protectExtraNm: clamp(finite(parameters.protectExtraNm, 2), 0, 50),
    userProtectedRange: parameters.userProtectedRange
      ? {
          fromNm: Math.min(parameters.userProtectedRange.fromNm, parameters.userProtectedRange.toNm),
          toNm: Math.max(parameters.userProtectedRange.fromNm, parameters.userProtectedRange.toNm),
        }
      : null,
    analysisRange: parameters.analysisRange
      ? {
          fromNm: Math.min(parameters.analysisRange.fromNm, parameters.analysisRange.toNm),
          toNm: Math.max(parameters.analysisRange.fromNm, parameters.analysisRange.toNm),
        }
      : null,
    maskScattering: parameters.maskScattering === true,
    scatteringToleranceNm: clamp(finite(parameters.scatteringToleranceNm, 3), 0.5, 20),
    maskUnrepairable: parameters.maskUnrepairable !== false,
  };
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function mad(values: number[]): number {
  const centre = median(values);
  return median(values.map((value) => Math.abs(value - centre)));
}

const validRange = (range: WaveRange | null): WaveRange | null =>
  range &&
  Number.isFinite(range.fromNm) &&
  Number.isFinite(range.toNm) &&
  range.fromNm > 0 &&
  range.toNm >= range.fromNm
    ? range
    : null;

function overlaps(a: WaveRange, b: WaveRange) {
  return a.fromNm <= b.toNm && b.fromNm <= a.toNm;
}

function mergeRanges(ranges: WaveRange[]): WaveRange[] {
  const sorted = [...ranges].sort((a, b) => a.fromNm - b.fromNm || a.toNm - b.toNm);
  const merged: WaveRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.fromNm <= last.toNm) last.toNm = Math.max(last.toNm, range.toNm);
    else merged.push({ ...range });
  }
  return merged;
}

function interpolateBlank(points: Point[], x: number): number | null {
  if (x < points[0].x || x > points.at(-1)!.x) return null;
  let lo = 0,
    hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].x < x) lo = mid + 1;
    else hi = mid;
  }
  const right = points[lo];
  if (right.x === x) return right.y;
  const left = points[lo - 1];
  if (!left) return null;
  return left.y + ((right.y - left.y) * (x - left.x)) / (right.x - left.x);
}

function movingAverage(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, index) => {
    let sum = 0,
      count = 0;
    for (let j = Math.max(0, index - half); j <= Math.min(values.length - 1, index + half); j++) {
      sum += values[j];
      count++;
    }
    return sum / count;
  });
}

function stepSize(points: Point[]): number {
  const diffs = points.slice(1).map((point, index) => point.x - points[index].x);
  return diffs.length ? median(diffs) : 1;
}

function ramanWavelength(excitationNm: number, solvent: string): number | null {
  // A 3400 cm^-1 band is a useful water estimate; ethanol is about 2900 cm^-1.
  const shift = /ethanol|乙醇|alcohol|甲醇|methanol/i.test(solvent) ? 2900 : 3400;
  const denominator = 1e7 / excitationNm - shift;
  if (denominator <= 0) return null;
  return 1e7 / denominator;
}

function scatteringCandidates(
  input: AssistantProcessInput,
  points: Point[],
  corrected: number[],
  blank: Point[] | null,
  noise: number,
  step: number,
): ScatteringCandidate[] {
  const excitation = input.excitationNm;
  if (!excitation || !Number.isFinite(excitation) || excitation <= 0) return [];
  const tolerance = Math.max(
    input.parameters.scatteringToleranceNm,
    input.slitNm && Number.isFinite(input.slitNm) ? input.slitNm / 2 : 0,
    step * 1.25,
  );
  const candidates: ScatteringCandidate[] = [];
  const add = (type: ScatteringType, label: string, centre: number, evidence: string[]) => {
    if (!Number.isFinite(centre)) return;
    const fromNm = Math.max(points[0].x, centre - tolerance),
      toNm = Math.min(points.at(-1)!.x, centre + tolerance);
    if (toNm < points[0].x || fromNm > points.at(-1)!.x || toNm < fromNm) return;
    let blankSignal: number | null = null;
    if (blank) {
      const values = blank.filter((point) => point.x >= fromNm && point.x <= toNm).map((p) => p.y);
      if (values.length) blankSignal = Math.max(...values);
    }
    const near = points
      .map((point, index) => ({ point, corrected: corrected[index] }))
      .filter((entry) => entry.point.x >= fromNm && entry.point.x <= toNm);
    if (!near.length) return;
    const peak = Math.max(...near.map((entry) => entry.corrected));
    const base = median(near.map((entry) => entry.corrected));
    if (peak - base < Math.max(3 * noise, 1e-9)) return;
    candidates.push({
      id: `S${candidates.length + 1}`,
      type,
      label,
      fromNm,
      toNm,
      evidence: [
        ...evidence,
        `区间最大强度 ${peak.toPrecision(4)}，局部基线 ${base.toPrecision(4)}`,
        `半宽按 ${tolerance.toFixed(2)} nm 估算`,
        ...(blankSignal === null ? [] : [`同条件空白在该区间最大强度 ${blankSignal.toPrecision(4)}`]),
      ],
      overlapsProtected: false,
      blankSignal,
    });
  };
  add('rayleigh', '瑞利散射（λex）', excitation, [
    `激发波长 ${excitation} nm`,
    input.slitNm ? `发射狭缝 ${input.slitNm} nm` : '未记录发射狭缝',
  ]);
  if (excitation * 2 <= points.at(-1)!.x)
    add('second-order', '二级瑞利散射（2λex）', excitation * 2, [
      `2 × 激发波长 = ${excitation * 2} nm`,
    ]);
  const raman = ramanWavelength(excitation, input.solvent ?? '');
  if (raman !== null)
    add('raman', '拉曼散射（估算）', raman, [
      `激发波长 ${excitation} nm`,
      /ethanol|乙醇|alcohol|甲醇|methanol/i.test(input.solvent ?? '')
        ? '按乙醇/甲醇约 2900 cm⁻¹ 估算'
        : '按水约 3400 cm⁻¹ 估算',
    ]);
  return candidates;
}

interface PeakCandidate {
  index: number;
  x: number;
  smoothedY: number;
  baseline: number;
  noise: number;
  fromIndex: number;
  toIndex: number;
  fromNm: number;
  toNm: number;
  prominence: number;
  widthNm: number;
  halfWidthNm: number;
  excludedScattering: boolean;
}

function detectEmissionPeaks(
  points: Point[],
  corrected: number[],
  smoothed: number[],
  baseline: number,
  noise: number,
  step: number,
  scattering: ScatteringCandidate[],
): PeakCandidate[] {
  const max = Math.max(...smoothed),
    min = Math.min(...smoothed),
    span = Math.max(1e-9, max - min),
    minProminence = Math.max(6 * noise, span * 0.01);
  const peaks: PeakCandidate[] = [];
  for (let index = 1; index < smoothed.length - 1; index++) {
    if (smoothed[index] < baseline + minProminence) continue;
    if (!(smoothed[index] >= smoothed[index - 1] && smoothed[index] > smoothed[index + 1]))
      continue;
    const prominence = smoothed[index] - baseline;
    // A single cosmic spike becomes a rectangular bump after smoothing. Real
    // emission peaks still have elevated immediate neighbours at the apex.
    const edgeSupport =
      Math.min(corrected[index - 1], corrected[index + 1]) - baseline;
    if (edgeSupport < prominence * 0.25) continue;
    const level = Math.max(baseline + prominence * 0.15, baseline + 2 * noise, min);
    let left = index,
      right = index;
    while (left > 0 && smoothed[left - 1] >= level) left--;
    while (right < smoothed.length - 1 && smoothed[right + 1] >= level) right++;
    const widthNm = points[right].x - points[left].x;
    if (widthNm < Math.max(step * 2, 1e-9)) continue;
    const halfLevel = baseline + prominence * 0.5;
    let halfLeft = index,
      halfRight = index;
    while (halfLeft > 0 && smoothed[halfLeft - 1] >= halfLevel) halfLeft--;
    while (halfRight < smoothed.length - 1 && smoothed[halfRight + 1] >= halfLevel) halfRight++;
    const halfWidthNm = points[halfRight].x - points[halfLeft].x;
    // Isolated spikes survive smoothing as very narrow peaks. Requiring a real
    // half-width prevents them from being mistaken for protected emission peaks.
    if (halfWidthNm < Math.max(step * 2, 1.5)) continue;
    const x = points[index].x;
    peaks.push({
      index,
      x,
      smoothedY: smoothed[index],
      baseline,
      noise,
      fromIndex: left,
      toIndex: right,
      fromNm: points[left].x,
      toNm: points[right].x,
      prominence,
      widthNm,
      halfWidthNm,
      excludedScattering: scattering.some(
        (candidate) => x >= candidate.fromNm && x <= candidate.toNm,
      ),
    });
  }
  return peaks.sort((a, b) => b.prominence - a.prominence);
}

function buildProtectedRanges(
  parameters: AssistantParameters,
  points: Point[],
  peaks: PeakCandidate[],
  explicit: WaveRange | null,
  step: number,
): { ranges: WaveRange[]; auto: WaveRange | null } {
  if (!parameters.protectMainPeak) {
    const user = explicit ? [explicit] : [];
    return { ranges: mergeRanges(user), auto: null };
  }
  const realPeaks = peaks.filter((peak) => !peak.excludedScattering);
  if (!realPeaks.length) {
    const user = explicit ? [explicit] : [];
    return { ranges: mergeRanges(user), auto: null };
  }
  const main = realPeaks[0];
  const extra = Math.max(1, Math.round(parameters.protectExtraNm / Math.max(step, 1e-9)));
  const mainRange: WaveRange = {
    fromNm: points[Math.max(0, main.fromIndex - extra)].x,
    toNm: points[Math.min(points.length - 1, main.toIndex + extra)].x,
  };
  const ranges = [mainRange];
  const secondaryThreshold = Math.max(main.prominence * 0.1, main.noise * 8);
  for (const peak of realPeaks.slice(1)) {
    if (peak.prominence < secondaryThreshold) continue;
    ranges.push({
      fromNm: points[Math.max(0, peak.fromIndex - extra)].x,
      toNm: points[Math.min(points.length - 1, peak.toIndex + extra)].x,
    });
  }
  if (explicit) ranges.push(explicit);
  return { ranges: mergeRanges(ranges), auto: mainRange };
}

function rangeHasPoints(points: Point[], range: WaveRange) {
  return points.some((point) => point.x >= range.fromNm && point.x <= range.toNm);
}

function validateRange(range: WaveRange | null, points: Point[], label: string) {
  if (!range) return;
  if (!Number.isFinite(range.fromNm) || !Number.isFinite(range.toNm) || range.toNm <= range.fromNm)
    throw new Error(`${label}的终点必须大于起点`);
  if (range.fromNm < points[0].x || range.toNm > points.at(-1)!.x)
    throw new Error(`${label}超出测量范围 ${points[0].x}–${points.at(-1)!.x} nm`);
  if (!rangeHasPoints(points, range)) throw new Error(`${label}内没有测量点`);
}

/** Local linear interpolation between two measured anchors; never extrapolates. */
function localInterpolation(
  points: Point[],
  values: number[],
  fromIndex: number,
  toIndex: number,
): number[] | null {
  const left = fromIndex - 1,
    right = toIndex + 1;
  if (left < 0 || right >= points.length) return null;
  if (!Number.isFinite(values[left]) || !Number.isFinite(values[right])) return null;
  const x0 = points[left].x,
    x1 = points[right].x,
    y0 = values[left],
    y1 = values[right];
  if (!(x1 > x0)) return null;
  return Array.from({ length: toIndex - fromIndex + 1 }, (_, offset) => {
    const x = points[fromIndex + offset].x;
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  });
}

/**
 * Runs the complete numerical workflow. Throws actionable errors for invalid
 * input; never mutates the caller's points or parameters.
 */
export function processAssistantSpectrum(input: AssistantProcessInput): AssistantProcessingResult {
  const parameters = normalizeAssistantParameters(input.parameters);
  if (input.excitationNm !== null && (!Number.isFinite(input.excitationNm) || input.excitationNm <= 0))
    throw new Error('激发波长必须为正数；没有激发波长时请留空');
  const points = input.points.map((point) => ({ ...point }));
  if (points.length < 5) throw new Error('有效数据点少于 5 个，无法进行稳健异常检测');
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('光谱包含非有限数值');
    if (point.x <= 0) throw new Error('波长必须为正数');
    if (index && point.x <= points[index - 1].x) throw new Error('波长必须严格递增');
  }
  const userRange = validRange(parameters.userProtectedRange);
  const analysisRange = validRange(parameters.analysisRange);
  validateRange(userRange, points, '目标保护区');
  validateRange(analysisRange, points, '重分析区间');
  if (userRange && analysisRange && overlaps(userRange, analysisRange) && userRange.fromNm === analysisRange.fromNm && userRange.toNm === analysisRange.toNm)
    throw new Error('重分析区间与保护区完全重叠，请调整保护区');

  let blankPoints: Point[] | null = null;
  if (input.subtractBlank) {
    if (!input.blank || input.blank.points.length < 2) throw new Error('启用空白扣除前请先选择空白光谱');
    if (!input.blankSameConditions) throw new Error('启用空白扣除前请确认空白与样品测量条件一致');
    blankPoints = [...input.blank.points]
      .map((point) => ({ ...point }))
      .sort((a, b) => a.x - b.x);
    for (let index = 1; index < blankPoints.length; index++)
      if (blankPoints[index].x <= blankPoints[index - 1].x)
        throw new Error('空白光谱波长必须严格递增');
    if (points[0].x < blankPoints[0].x || points.at(-1)!.x > blankPoints.at(-1)!.x)
      throw new Error(
        `空白范围 ${blankPoints[0].x}–${blankPoints.at(-1)!.x} nm 未覆盖样品范围 ${points[0].x}–${points.at(-1)!.x} nm，不能外推扣除`,
      );
  }
  const blankValues = points.map((point) =>
    blankPoints ? interpolateBlank(blankPoints, point.x) : null,
  );
  if (blankPoints && blankValues.some((value) => value === null))
    throw new Error('空白光谱未能覆盖全部样品波长，不能外推扣除');
  const corrected = points.map((point, index) => point.y - (blankValues[index] ?? 0));
  if (corrected.some((value) => !Number.isFinite(value))) throw new Error('扣除结果超出数值范围');

  const differences = corrected.slice(1).map((value, index) => value - corrected[index]);
  const differenceCentre = median(differences);
  const noise = Math.max(
    1e-12,
    (1.4826 * median(differences.map((value) => Math.abs(value - differenceCentre)))) / Math.SQRT2,
  );
  const smoothed = movingAverage(corrected, Math.min(parameters.windowSize, 7));
  const baseline = median(corrected);
  const step = stepSize(points);
  const scattering = scatteringCandidates(
    input,
    points,
    corrected,
    blankPoints,
    noise,
    step,
  );
  const peaks = detectEmissionPeaks(points, corrected, smoothed, baseline, noise, step, scattering);
  const protection = buildProtectedRanges(parameters, points, peaks, userRange, step);
  const protectedRanges = protection.ranges;
  for (const candidate of scattering) {
    candidate.overlapsProtected = protectedRanges.some((range) =>
      overlaps(range, { fromNm: candidate.fromNm, toNm: candidate.toNm }),
    );
  }

  const state: AssistantPoint[] = points.map((point, index) => ({
    index,
    x: point.x,
    original: point.y,
    blank: blankValues[index] ?? null,
    corrected: corrected[index],
    processed: corrected[index],
    status: 'normal',
    anomalyKind: null,
    anomalyId: null,
    method: blankPoints ? '1:1 空白扣除' : '',
    reason: blankPoints
      ? `原始强度减去同条件空白在 ${point.x} nm 的线性内插值 ${blankValues[index]!.toPrecision(5)}`
      : '',
    protected: protectedRanges.some(
      (range) => point.x >= range.fromNm && point.x <= range.toNm,
    ),
    rowNumber: input.rowNumbers?.[index] ?? null,
  }));

  const anomalies: AssistantAnomaly[] = [];
  const warnings: string[] = [];
  let anomalyCounter = 0;
  const maskScatteringRanges = parameters.maskScattering
    ? scattering
        .filter((candidate) => !candidate.overlapsProtected)
        .map((candidate) => ({ fromNm: candidate.fromNm, toNm: candidate.toNm }))
    : [];
  if (parameters.maskScattering) {
    for (const candidate of scattering.filter((entry) => entry.overlapsProtected))
      warnings.push(`${candidate.label} 与目标峰保护区重叠，未自动屏蔽。`);
  }
  const inMask = (x: number) =>
    maskScatteringRanges.some((range) => x >= range.fromNm && x <= range.toNm);
  const inScattering = (x: number) =>
    scattering.some((candidate) => x >= candidate.fromNm && x <= candidate.toNm);
  const inAnalysis = (x: number) =>
    !analysisRange || (x >= analysisRange.fromNm && x <= analysisRange.toNm);

  // Scattering masks are recorded first so they cannot be overwritten by a repair.
  if (parameters.maskScattering) {
    for (const candidate of scattering) {
      if (candidate.overlapsProtected) continue;
      const indices = points
        .map((point, index) => (point.x >= candidate.fromNm && point.x <= candidate.toNm && inAnalysis(point.x) ? index : -1))
        .filter((index) => index >= 0);
      if (!indices.length) continue;
      const id = `A${++anomalyCounter}`;
      for (const index of indices) {
        state[index].processed = null;
        state[index].status = 'masked';
        state[index].anomalyKind = 'scattering';
        state[index].anomalyId = id;
        state[index].method = '散射区间屏蔽（不插值）';
        state[index].reason = `${candidate.label}：${candidate.evidence.join('；')}。屏蔽区间保留原始强度，处理强度留空。`;
      }
      anomalies.push({
        id,
        kind: 'scattering',
        status: 'masked',
        fromIndex: indices[0],
        toIndex: indices.at(-1)!,
        fromNm: points[indices[0]].x,
        toNm: points[indices.at(-1)!].x,
        wavelengths: indices.map((index) => points[index].x),
        originalValues: indices.map((index) => points[index].y),
        processedValues: indices.map(() => null),
        deviation: 0,
        method: '散射区间屏蔽（不插值）',
        reason: `${candidate.label} 区间 ${candidate.fromNm.toFixed(2)}–${candidate.toNm.toFixed(2)} nm。${candidate.evidence.join('；')}。`,
      });
    }
  }

  // Candidate scattering windows are always recorded. Without an explicit mask
  // they stay unchanged and are never "repaired" as if they were cosmic spikes.
  for (const candidate of scattering) {
    if (parameters.maskScattering && !candidate.overlapsProtected) continue;
    const indices = points
      .map((point, index) =>
        point.x >= candidate.fromNm && point.x <= candidate.toNm && inAnalysis(point.x) ? index : -1,
      )
      .filter((index) => index >= 0);
    if (!indices.length) continue;
    const id = `A${++anomalyCounter}`;
    const protectedOverlap = candidate.overlapsProtected;
    anomalies.push({
      id,
      kind: 'scattering',
      status: 'suggested',
      fromIndex: indices[0],
      toIndex: indices.at(-1)!,
      fromNm: points[indices[0]].x,
      toNm: points[indices.at(-1)!].x,
      wavelengths: indices.map((index) => points[index].x),
      originalValues: indices.map((index) => points[index].y),
      processedValues: indices.map((index) => corrected[index]),
      deviation: 0,
      method: '疑似散射（仅标记，未修改）',
      reason: `${candidate.label} 区间 ${candidate.fromNm.toFixed(2)}–${candidate.toNm.toFixed(2)} nm。${candidate.evidence.join('；')}。${protectedOverlap ? '该区间与目标峰保护区重叠，禁止自动屏蔽。' : '需人工确认后才可屏蔽；当前保留测量值。'}`,
    });
  }

  // Hampel filter using neighbours only; protected, masked and out-of-analysis points are skipped.
  const half = Math.floor(parameters.windowSize / 2);
  const outerDistance = parameters.maxRepairRun + 1;
  const scores = corrected.map(() => 0);
  const flagged = corrected.map(() => false);
  const classify = (index: number, neighbours: number[], scoreOut: (score: number) => void) => {
    if (neighbours.length < 2) return false;
    const centre = median(neighbours);
    const localSigma = 1.4826 * mad(neighbours);
    const sigma = Math.max(localSigma, noise * 0.75, 1e-12);
    const deviation = Math.abs(corrected[index] - centre);
    const score = deviation / sigma;
    scoreOut(score);
    // A real cosmic spike is a large relative jump. Small noisy bumps inside a
    // broad band are not "unreasonable" enough to justify fabricating a value.
    const localLevel = Math.max(Math.abs(centre), Math.abs(corrected[index]), noise);
    return (
      score >= parameters.thresholdSigma &&
      deviation >= Math.max(noise * 1.25, localLevel * 0.2, 1e-9)
    );
  };
  for (let index = 0; index < points.length; index++) {
    const point = state[index];
    if (point.protected || inMask(point.x) || inScattering(point.x) || !inAnalysis(point.x)) continue;
    const neighbours: number[] = [];
    for (let j = Math.max(0, index - half); j <= Math.min(points.length - 1, index + half); j++) {
      if (j !== index) neighbours.push(corrected[j]);
    }
    let maxScore = 0;
    const centralFlag = classify(index, neighbours, (score) => {
      maxScore = Math.max(maxScore, score);
    });
    // A short run (for example 4 consecutive points) can fill enough of a 7-point
    // window that its own members become the local median. Compare against
    // anchors outside the maximum repair span as a second, independent check.
    const outer: number[] = [];
    for (const distance of [outerDistance, outerDistance + 1]) {
      for (const direction of [-1, 1]) {
        const j = index + direction * distance;
        if (j >= 0 && j < points.length) outer.push(corrected[j]);
      }
    }
    const outerFlag = classify(index, outer, (score) => {
      maxScore = Math.max(maxScore, score);
    });
    scores[index] = maxScore;
    if (centralFlag || outerFlag) flagged[index] = true;
  }

  // Consecutive flagged points form one run. Short runs with anchors are repaired.
  let index = 0;
  while (index < points.length) {
    if (!flagged[index]) {
      index++;
      continue;
    }
    let end = index;
    while (end + 1 < points.length && flagged[end + 1]) end++;
    const runLength = end - index + 1;
    const kind: AssistantAnomalyKind =
      state.slice(index, end + 1).reduce((sum, point) => sum + (corrected[point.index] - median(corrected)), 0) < 0
        ? 'negative-spike'
        : 'positive-spike';
    const maxScore = Math.max(...scores.slice(index, end + 1));
    const id = `A${++anomalyCounter}`;
    const wavelengths = points.slice(index, end + 1).map((point) => point.x);
    const originalValues = points.slice(index, end + 1).map((point) => point.y);
    if (runLength > parameters.maxRepairRun) {
      const status: AssistantAnomalyStatus = parameters.maskUnrepairable ? 'masked' : 'unresolved';
      for (let j = index; j <= end; j++) {
        state[j].processed = parameters.maskUnrepairable ? null : corrected[j];
        state[j].status = parameters.maskUnrepairable ? 'masked' : 'unresolved';
        state[j].anomalyKind = 'unrepairable';
        state[j].anomalyId = id;
        state[j].method = parameters.maskUnrepairable
          ? '异常区间屏蔽（超过可修复跨度，不插值）'
          : '保留原值（超过可修复跨度）';
        state[j].reason = `连续 ${runLength} 点偏离超过阈值 ${parameters.thresholdSigma}σ，超过最大修复跨度 ${parameters.maxRepairRun} 点；未凭空生成强度。`;
      }
      anomalies.push({
        id,
        kind: 'unrepairable',
        status,
        fromIndex: index,
        toIndex: end,
        fromNm: points[index].x,
        toNm: points[end].x,
        wavelengths,
        originalValues,
        processedValues: state.slice(index, end + 1).map((point) => point.processed),
        deviation: maxScore,
        method: parameters.maskUnrepairable
          ? '异常区间屏蔽（不插值）'
          : '保留原值',
        reason: `连续 ${runLength} 个点被 Hampel 检测标记，超过可修复跨度 ${parameters.maxRepairRun}。${parameters.maskUnrepairable ? '处理结果留空以避免伪造强度。' : '保留原始测量值。'}`,
      });
      index = end + 1;
      continue;
    }
    if (!parameters.repairSpikes) {
      for (let j = index; j <= end; j++) {
        state[j].processed = corrected[j];
        state[j].status = 'unresolved';
        state[j].anomalyKind = kind;
        state[j].anomalyId = id;
        state[j].method = '仅标记（局部修复已关闭）';
        state[j].reason = `Hampel 最大偏离 ${scores[j].toFixed(2)}σ；按当前设置不修改测量值。`;
      }
      anomalies.push({
        id,
        kind,
        status: 'unresolved',
        fromIndex: index,
        toIndex: end,
        fromNm: points[index].x,
        toNm: points[end].x,
        wavelengths,
        originalValues,
        processedValues: corrected.slice(index, end + 1),
        deviation: maxScore,
        method: '仅标记（局部修复已关闭）',
        reason: `检测到 ${runLength} 个连续异常点（最大偏离 ${maxScore.toFixed(2)}σ），但当前设置为仅标记，未修改原始测量值。`,
      });
      index = end + 1;
      continue;
    }
    const repaired = localInterpolation(points, corrected, index, end);
    if (!repaired) {
      const status: AssistantAnomalyStatus = parameters.maskUnrepairable ? 'masked' : 'unresolved';
      for (let j = index; j <= end; j++) {
        state[j].processed = parameters.maskUnrepairable ? null : corrected[j];
        state[j].status = parameters.maskUnrepairable ? 'masked' : 'unresolved';
        state[j].anomalyKind = 'unrepairable';
        state[j].anomalyId = id;
        state[j].method = parameters.maskUnrepairable ? '边缘异常屏蔽（无双侧锚点）' : '保留原值（无双侧锚点）';
        state[j].reason = '异常点位于数据边缘，缺少左右两侧可信锚点，不能局部插值。';
      }
      anomalies.push({
        id,
        kind: 'unrepairable',
        status,
        fromIndex: index,
        toIndex: end,
        fromNm: points[index].x,
        toNm: points[end].x,
        wavelengths,
        originalValues,
        processedValues: state.slice(index, end + 1).map((point) => point.processed),
        deviation: maxScore,
        method: parameters.maskUnrepairable ? '边缘异常屏蔽' : '保留原值',
        reason: '缺少左右两侧可信锚点，未插值。',
      });
      index = end + 1;
      continue;
    }
    const left = points[index - 1],
      right = points[end + 1];
    for (let j = index; j <= end; j++) {
      state[j].processed = repaired[j - index];
      state[j].status = 'repaired';
      state[j].anomalyKind = kind;
      state[j].anomalyId = id;
      state[j].method = blankPoints ? '1:1 空白扣除 + 局部线性插值' : '局部线性插值';
      state[j].reason = `Hampel 稳健检测偏离 ${scores[j].toFixed(2)}σ（阈值 ${parameters.thresholdSigma}σ，窗口 ${parameters.windowSize} 点）；以 ${left.x} nm 与 ${right.x} nm 的测量值局部线性插值。`;
    }
    anomalies.push({
      id,
      kind,
      status: 'repaired',
      fromIndex: index,
      toIndex: end,
      fromNm: points[index].x,
      toNm: points[end].x,
      wavelengths,
      originalValues,
      processedValues: repaired,
      deviation: maxScore,
      method: blankPoints ? '1:1 空白扣除 + 局部线性插值' : '局部线性插值',
      reason: `Hampel 局部中位数/MAD 检测：最大偏离 ${maxScore.toFixed(2)}σ（阈值 ${parameters.thresholdSigma}σ，窗口 ${parameters.windowSize} 点）。仅对 ${runLength} 个连续点使用 ${left.x}–${right.x} nm 的测量值做局部线性插值；保护区未修改。`,
    });
    index = end + 1;
  }

  const repairedCount = state.filter((point) => point.status === 'repaired').length;
  const maskedCount = state.filter((point) => point.status === 'masked').length;
  const unresolvedCount = state.filter((point) => point.status === 'unresolved').length;
  const protectedPoints = state.filter((point) => point.protected).length;
  if (!repairedCount && !maskedCount && !unresolvedCount)
    warnings.push('未检测到需要修复的孤立异常点；处理结果与空白扣除后的数据一致。');
  if (corrected.some((value) => value < 0))
    warnings.push(
      `处理后包含 ${corrected.filter((value) => value < 0).length} 个负值（空白扣除后可能为负），未做截断。`,
    );
  if (!peaks.filter((peak) => !peak.excludedScattering).length)
    warnings.push('未识别到明确的发射峰，目标峰保护可能不完整，请人工核对保护区。');
  if (userRange && protection.auto && overlaps(userRange, protection.auto))
    warnings.push('手动保护区与自动主峰保护区重叠，已合并。');

  const mainPeakCandidate = peaks.find((peak) => !peak.excludedScattering) ?? null;
  const mainPeak: AssistantMainPeak | null = mainPeakCandidate
    ? (() => {
        const at = mainPeakCandidate.index,
          processedValue = state[at].processed;
        return {
          originalX: points[at].x,
          originalY: points[at].y,
          correctedY: corrected[at],
          processedX: processedValue === null ? null : points[at].x,
          processedY: processedValue,
          shiftNm:
            processedValue === null
              ? null
              : points[at].x - mainPeakCandidate.x,
          heightRatio:
            processedValue === null || Math.abs(corrected[at]) < 1e-12
              ? null
              : processedValue / corrected[at],
        };
      })()
    : null;

  const checks: AssistantCheck[] = [
    {
      key: 'rows',
      label: '行数与波长完整',
      status: state.length === points.length ? 'pass' : 'fail',
      detail: `输入 ${points.length} 点，输出 ${state.length} 点；波长列逐点保留。`,
    },
    {
      key: 'original',
      label: '原始强度未被覆盖',
      status: state.every((point, i) => point.original === points[i].y) ? 'pass' : 'fail',
      detail: '所有原始强度单独保存在 original 字段，处理值写入 processed。',
    },
    {
      key: 'peak',
      label: '主发射峰保留',
      status:
        !mainPeak || mainPeak.processedY === null
          ? 'fail'
          : (mainPeak.heightRatio ?? 0) >= 0.95 && (mainPeak.heightRatio ?? 0) <= 1.05
            ? 'pass'
            : 'warn',
      detail: mainPeak
        ? `主峰 ${mainPeak.originalX} nm；处理后强度比 ${mainPeak.heightRatio?.toFixed(3) ?? '空缺'}；保护点 ${protectedPoints} 个。`
        : '未识别主峰，无法验证峰保留。',
    },
    {
      key: 'mask',
      label: '屏蔽区间未伪造',
      status: maskedCount ? 'warn' : 'pass',
      detail: maskedCount
        ? `${maskedCount} 个点被屏蔽，处理后强度留空；原始值保留。`
        : '没有屏蔽点。',
    },
    {
      key: 'repair',
      label: '异常修复可追溯',
      status: unresolvedCount ? 'warn' : 'pass',
      detail: `${repairedCount} 点局部插值，${maskedCount} 点屏蔽，${unresolvedCount} 点保留待人工判断。`,
    },
    {
      key: 'blank',
      label: '空白扣除范围',
      status: blankPoints ? 'pass' : 'warn',
      detail: blankPoints
        ? `使用空白 ${input.blank!.name}；全部 ${points.length} 点在空白测量范围内线性内插，未外推。`
        : '未启用空白扣除。',
    },
    {
      key: 'scattering',
      label: '散射候选与保护',
      status: scattering.some((candidate) => candidate.overlapsProtected) ? 'warn' : 'pass',
      detail: scattering.length
        ? `${scattering.length} 个候选；${scattering.filter((c) => c.overlapsProtected).length} 个与保护区重叠且未屏蔽。`
        : '未发现基于激发波长的散射候选。',
    },
  ];
  return {
    algorithmVersion: ASSISTANT_ALGORITHM_VERSION,
    parameters,
    points: state,
    anomalies,
    protectedRanges,
    autoProtectedRange: protection.auto,
    mainPeak,
    scattering,
    checks,
    blank: blankPoints
      ? {
          used: true,
          name: input.blank!.name,
          coverage: `${blankPoints[0].x}–${blankPoints.at(-1)!.x} nm（样品 ${points[0].x}–${points.at(-1)!.x} nm）`,
        }
      : null,
    stats: {
      points: state.length,
      protectedPoints,
      anomalies: anomalies.length,
      repaired: repairedCount,
      masked: maskedCount,
      unresolved: unresolvedCount,
      scatteringCandidates: scattering.length,
    },
    warnings,
  };
}

/** Chart polylines break at masked points; original rows never get bridged. */
export function processedSegments(points: AssistantPoint[]): Point[][] {
  const segments: Point[][] = [];
  let run: Point[] = [];
  for (const point of points) {
    if (point.processed === null) {
      if (run.length) segments.push(run);
      run = [];
    } else run.push({ x: point.x, y: point.processed });
  }
  if (run.length) segments.push(run);
  return segments;
}

function hashString(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Stable key: any data, blank or parameter change invalidates a prior confirmation. */
export function assistantProcessingKey(
  input: AssistantProcessInput,
  rowNumbers: (number | null)[] = [],
) {
  return hashString(
    JSON.stringify({
      points: input.points,
      rowNumbers,
      excitationNm: input.excitationNm,
      solvent: input.solvent ?? '',
      slitNm: input.slitNm ?? null,
      blank: input.blank?.points ?? null,
      blankName: input.blank?.name ?? '',
      subtractBlank: input.subtractBlank,
      blankSameConditions: input.blankSameConditions,
      parameters: normalizeAssistantParameters(input.parameters),
    }),
  );
}

const anomalyKindLabel: Record<AssistantAnomalyKind, string> = {
  'positive-spike': '孤立正异常尖峰',
  'negative-spike': '孤立负异常尖峰',
  scattering: '疑似散射',
  unrepairable: '连续异常区间',
};
const anomalyStatusLabel: Record<AssistantAnomalyStatus, string> = {
  repaired: '已局部修复',
  masked: '已屏蔽',
  unresolved: '仅标记',
  suggested: '仅标记',
};

export function describeAssistantResult(result: AssistantProcessingResult) {
  const { stats, mainPeak } = result;
  const details = result.anomalies
    .slice(0, 4)
    .map((anomaly) => {
      const range =
        anomaly.fromNm === anomaly.toNm
          ? `${anomaly.fromNm} nm`
          : `${anomaly.fromNm}–${anomaly.toNm} nm`;
      return `${anomaly.id} ${anomalyKindLabel[anomaly.kind]} ${range}（${anomalyStatusLabel[anomaly.status]}）`;
    })
    .join('；');
  const parts = [
    `共 ${stats.points} 个测量点，识别 ${stats.anomalies} 个异常记录：局部修复 ${stats.repaired} 点，屏蔽 ${stats.masked} 点，保留待判断 ${stats.unresolved} 点。`,
    details ? `检测到：${details}${result.anomalies.length > 4 ? ' 等' : ''}。` : '',
    mainPeak
      ? `主发射峰位于 ${mainPeak.originalX} nm，${stats.protectedPoints} 个点位于保护区内，保护区内未做修复或屏蔽。`
      : '未自动识别主发射峰，请人工检查保护区。',
    result.scattering.length
      ? `发现 ${result.scattering.length} 个散射候选（${result.scattering.map((candidate) => candidate.label).join('、')}）；${result.parameters.maskScattering ? '已按当前设置屏蔽未与保护区重叠的候选。' : '当前仅标记，未屏蔽。'}`
      : '未发现基于激发波长的散射候选。',
  ];
  if (result.blank) parts.push(`空白扣除：${result.blank.name}，未外推。`);
  if (result.warnings.length) parts.push(result.warnings[0]);
  return parts.filter(Boolean).join(' ');
}
