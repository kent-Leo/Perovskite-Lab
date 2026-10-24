/** Public protocol only. Credentials must never be added to these objects. */
export const AI_PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
  },
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-6.1-sol', 'gpt-6-luna'],
  },
} as const;
export type AiProvider = keyof typeof AI_PROVIDERS;
export const MAX_AI_POINTS = 12000;
export const MAX_AI_SPECTRA = 8;
export const MAX_AI_BYTES = 900000;
export interface AiSpectrum {
  id: string;
  name: string;
  points: { x: number; y: number }[];
}
export interface WaveRange { fromNm: number; toNm: number }
export interface AnalysisInput {
  spectra: AiSpectrum[];
  excitationNm: number;
  solvent: string;
  protectedRange: WaveRange | null;
  blank: AiSpectrum | null;
}
export interface SuggestedRegion extends WaveRange {
  spectrumId: string;
  reason: string;
}
export interface AiSuggestion {
  summary: string;
  regions: SuggestedRegion[];
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('数据格式不正确');
  return value as Record<string, unknown>;
}
export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
export function textValue(value: unknown, max: number, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()))
    throw new Error(`${label}无效或过长`);
  return value;
}
export function waveRange(value: unknown): WaveRange {
  const range = object(value);
  if (!finite(range.fromNm) || !finite(range.toNm) || range.fromNm <= 0 || range.toNm < range.fromNm)
    throw new Error('波长区间必须为正数，且终点不能小于起点');
  return { fromNm: range.fromNm, toNm: range.toNm };
}
export function validateSpectrum(value: unknown): AiSpectrum {
  const row = object(value);
  const id = textValue(row.id, 120, '光谱标识'), name = textValue(row.name, 200, '光谱名称');
  if (!Array.isArray(row.points) || row.points.length < 2 || row.points.length > MAX_AI_POINTS)
    throw new Error(`每条光谱需要 2–${MAX_AI_POINTS} 个数据点`);
  let previous = -Infinity;
  const points = row.points.map((value) => {
    const point = object(value);
    if (!finite(point.x) || !finite(point.y) || point.x <= 0 || point.x <= previous)
      throw new Error('光谱波长必须为递增正数，强度必须为有限数值');
    previous = point.x;
    return { x: point.x, y: point.y };
  });
  return { id, name, points };
}
export function validateAnalysis(value: unknown): AnalysisInput {
  const input = object(value);
  if (!Array.isArray(input.spectra) || !input.spectra.length || input.spectra.length > MAX_AI_SPECTRA)
    throw new Error(`每次请选择 1–${MAX_AI_SPECTRA} 条样品光谱`);
  const spectra = input.spectra.map(validateSpectrum);
  if (new Set(spectra.map((s) => s.id)).size !== spectra.length) throw new Error('样品光谱标识重复');
  const blank = input.blank === null ? null : validateSpectrum(input.blank);
  if (blank && spectra.some((s) => s.id === blank.id)) throw new Error('空白不能同时作为待处理样品');
  if (spectra.reduce((sum, s) => sum + s.points.length, blank?.points.length ?? 0) > MAX_AI_POINTS)
    throw new Error(`一次分析最多 ${MAX_AI_POINTS} 个数据点（含空白），请减少样品数量；不会自动抽稀`);
  if (!finite(input.excitationNm) || input.excitationNm <= 0) throw new Error('请填写有效的激发波长');
  return {
    spectra, blank, excitationNm: input.excitationNm,
    solvent: textValue(input.solvent, 200, '溶剂或基质', true),
    protectedRange: input.protectedRange === null ? null : waveRange(input.protectedRange),
  };
}
export function validateSuggestion(value: unknown, spectra: AiSpectrum[]): AiSuggestion {
  const result = object(value);
  const summary = textValue(result.summary, 2000, '分析说明');
  if (!Array.isArray(result.regions) || result.regions.length > 32) throw new Error('干扰区域数量无效');
  const regions = result.regions.map((value) => {
    const row = object(value), range = waveRange(row);
    const spectrum = spectra.find((s) => s.id === row.spectrumId);
    if (!spectrum) throw new Error('AI 返回了不属于本次请求的光谱');
    if (range.fromNm < spectrum.points[0].x || range.toNm > spectrum.points.at(-1)!.x)
      throw new Error('AI 建议区间超出测量范围');
    if (!spectrum.points.some((p) => p.x >= range.fromNm && p.x <= range.toNm))
      throw new Error('AI 建议区间内没有测量点');
    return { ...range, spectrumId: spectrum.id, reason: textValue(row.reason, 500, '判断理由') };
  });
  return { summary, regions };
}
