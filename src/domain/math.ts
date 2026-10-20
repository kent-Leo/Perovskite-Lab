import type { Point, ResponseMode } from './types';
export function numeric(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}
export function response(f: number, f0: number, mode: ResponseMode): number {
  if (!Number.isFinite(f)) throw new Error('荧光强度必须为有限数值');
  if (mode === 'F') return f;
  if (!Number.isFinite(f0) || f0 <= 0) throw new Error('请指定强度大于 0 的空白参考 F₀');
  if (mode === 'inverse') {
    if (f <= 0) throw new Error('F₀/F 要求所有强度大于 0');
    return f0 / f;
  }
  if (mode === 'ratio') return f / f0;
  return ((f0 - f) / f0) * (mode === 'percent' ? 100 : 1);
}
export function regress(points: Point[]) {
  if (points.length < 2) throw new Error('至少需要两个有效浓度点');
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error('拟合数据包含无效数值');
  const n = points.length,
    mx = points.reduce((s, p) => s + p.x, 0) / n,
    my = points.reduce((s, p) => s + p.y, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0),
    syy = points.reduce((s, p) => s + (p.y - my) ** 2, 0);
  if (sxx === 0) throw new Error('至少需要两个不同的浓度');
  const slope = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx,
    intercept = my - slope * mx;
  const residuals = points.map((p) => ({ x: p.x, y: p.y - (slope * p.x + intercept) }));
  const sse = residuals.reduce((s, p) => s + p.y ** 2, 0);
  return {
    slope,
    intercept,
    r2: syy === 0 ? null : 1 - sse / syy,
    n,
    residuals,
    min: Math.min(...points.map((p) => p.x)),
    max: Math.max(...points.map((p) => p.x)),
    residualSD: n > 2 ? Math.sqrt(sse / (n - 2)) : null,
  };
}
export function sampleSD(values: number[]): number {
  if (values.length < 2 || values.some((v) => !Number.isFinite(v)))
    throw new Error('标准差需要至少两次有效测量');
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}
export function detectionLimits(sigma: number, slope: number, factor: number) {
  if (!Number.isFinite(sigma) || sigma <= 0) throw new Error('σ 必须大于 0，零变异不能确认检出限');
  if (!Number.isFinite(slope) || slope === 0) throw new Error('斜率为 0，不能计算检出限');
  if (factor !== 3 && factor !== 3.3) throw new Error('LOD 系数应为 3 或 3.3');
  return { lod: (factor * sigma) / Math.abs(slope), loq: (10 * sigma) / Math.abs(slope) };
}
export function interpolate(points: Point[], x: number): number | null {
  if (!Number.isFinite(x) || !points.length || x < points[0].x || x > points.at(-1)!.x) return null;
  for (let i = 0; i < points.length; i++) {
    if (points[i].x === x) return points[i].y;
    if (points[i].x > x) {
      const a = points[i - 1],
        b = points[i];
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
  }
  return null;
}
export function spectrumStats(points: Point[]) {
  if (!points.length) return null;
  const peak = points.reduce((a, b) => (b.y > a.y ? b : a)),
    index = points.indexOf(peak),
    half = peak.y / 2;
  let left: number | null = null,
    right: number | null = null;
  if (peak.y > 0) {
    for (let i = index; i > 0; i--)
      if (points[i - 1].y <= half && points[i].y >= half) {
        left =
          points[i - 1].x +
          ((half - points[i - 1].y) * (points[i].x - points[i - 1].x)) /
            (points[i].y - points[i - 1].y);
        break;
      }
    for (let i = index; i < points.length - 1; i++)
      if (points[i + 1].y <= half && points[i].y >= half) {
        right =
          points[i].x +
          ((half - points[i].y) * (points[i + 1].x - points[i].x)) /
            (points[i + 1].y - points[i].y);
        break;
      }
  }
  const area = points
    .slice(1)
    .reduce((s, p, i) => s + ((p.x - points[i].x) * (p.y + points[i].y)) / 2, 0);
  return {
    peak: peak.x,
    max: peak.y,
    fwhm: left === null || right === null ? null : right - left,
    area,
  };
}
export const units = ['mol/L', 'mmol/L', 'µmol/L', 'nmol/L', 'mg/L', 'µg/L'];
const unitAliases: Record<string, string> = {
  M: 'mol/L', mM: 'mmol/L', μM: 'µmol/L', µM: 'µmol/L', uM: 'µmol/L',
  'μmol/L': 'µmol/L', 'umol/L': 'µmol/L', nM: 'nmol/L',
  'μg/L': 'µg/L', 'ug/L': 'µg/L',
};
export function normalizeConcentrationUnit(unit: string): string {
  return Object.hasOwn(unitAliases, unit) ? unitAliases[unit] : unit;
}
const unitFactors: Record<string, number> = {
  'mol/L': 1, 'mmol/L': 1e-3, 'µmol/L': 1e-6, 'nmol/L': 1e-9,
  'mg/L': 1, 'µg/L': 1e-3,
};
export function convertConcentration(value: number, from: string, to: string) {
  from = normalizeConcentrationUnit(from);
  to = normalizeConcentrationUnit(to);
  if (!Object.hasOwn(unitFactors, from) || !Object.hasOwn(unitFactors, to))
    throw new Error('不支持此浓度单位');
  if (from.includes('g/L') !== to.includes('g/L'))
    throw new Error('质量与摩尔浓度不能直接混用，请先换算');
  const converted = Number(((value * unitFactors[from]) / unitFactors[to]).toPrecision(15));
  if (!Number.isFinite(value) || !Number.isFinite(converted))
    throw new Error('浓度必须为有限数值');
  return converted;
}
// Preserve separators, blank worksheet rows and invalid drafts while converting valid cells.
export function convertConcentrationText(text: string, from: string, to: string) {
  convertConcentration(0, from, to);
  return text.replace(/[^\s,，;；]+/g, (token) => {
    const value = numeric(token);
    return value === null ? token : String(convertConcentration(value, from, to));
  });
}
export function concentrationGradient(
  stock: number, stockUnit: string, volume: number,
  targets: number[], targetUnit: string, fixedVolume = 0,
) {
  const convertedStock = convertConcentration(stock, stockUnit, targetUnit);
  return gradient(convertedStock, volume, targets, fixedVolume);
}
export function gradient(stock: number, volume: number, targets: number[], fixedVolume = 0) {
  if (
    !Number.isFinite(stock) ||
    !Number.isFinite(volume) ||
    !Number.isFinite(fixedVolume) ||
    stock <= 0 ||
    volume <= 0 ||
    fixedVolume < 0 ||
    fixedVolume > volume
  )
    throw new Error('母液浓度和最终体积必须大于 0，固定添加体积不能超过最终体积');
  if (!targets.length || targets.some((t) => !Number.isFinite(t) || t < 0 || t > stock))
    throw new Error('目标浓度应在 0 与母液浓度之间');
  return targets.map((c, i) => {
    const aliquot = (c * volume) / stock,
      solvent = volume - aliquot - fixedVolume;
    if (solvent < -1e-10)
      throw new Error('母液与固定添加体积超过最终体积，请降低目标浓度或添加体积');
    return {
      index: i + 1,
      concentration: c,
      stockUL: aliquot * 1000,
      fixedML: fixedVolume,
      solventML: Math.max(0, solvent),
      finalML: volume,
    };
  });
}
export function parseNumbers(text: string): number[] {
  const tokens = text
    .trim()
    .split(/[\s,，;；]+/)
    .filter(Boolean);
  const values = tokens.map(numeric);
  if (values.some((v) => v === null)) throw new Error('请输入以逗号、空格或换行分隔的数值');
  return values as number[];
}
export function fmt(v: number | null | undefined, digits = 4) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6)) return v.toExponential(3);
  return Number(v.toPrecision(digits)).toString();
}
