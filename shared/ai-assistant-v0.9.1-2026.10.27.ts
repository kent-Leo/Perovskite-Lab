import {
  MAX_AI_POINTS,
  finite,
  object,
  textValue,
  validateSpectrum,
  waveRange,
  type AiSpectrum,
  type WaveRange,
} from './ai-contract-v0.9.1-2026.10.27';

/** Public AI classification protocol. It contains no credentials and returns no numbers. */

export const MAX_ASSISTANT_ANOMALIES = 80;
export const MAX_ASSISTANT_SCATTERING = 12;
export const ASSISTANT_ANOMALY_KINDS = [
  'positive-spike',
  'negative-spike',
  'scattering',
  'unrepairable',
] as const;
export const ASSISTANT_ANOMALY_STATUSES = ['repaired', 'masked', 'unresolved', 'suggested'] as const;
export const ASSISTANT_CLASSIFICATIONS = ['spike', 'scattering', 'real-peak', 'uncertain'] as const;
export const ASSISTANT_CONFIDENCE = ['low', 'medium', 'high'] as const;

export interface AssistantAnomalyInput {
  id: string;
  kind: (typeof ASSISTANT_ANOMALY_KINDS)[number];
  status: (typeof ASSISTANT_ANOMALY_STATUSES)[number];
  fromNm: number;
  toNm: number;
  wavelengths: number[];
  deviation: number;
}

export interface AssistantScatteringInput {
  type: 'rayleigh' | 'second-order' | 'raman';
  label: string;
  fromNm: number;
  toNm: number;
  evidence: string[];
}

export interface AssistantAnalysisInput {
  fileName: string;
  excitationNm: number;
  solvent: string;
  spectrum: AiSpectrum;
  blank: AiSpectrum | null;
  protectedRange: WaveRange | null;
  anomalies: AssistantAnomalyInput[];
  scattering: AssistantScatteringInput[];
  parameters: {
    thresholdSigma: number;
    windowSize: number;
    maxRepairRun: number;
    repairSpikes: boolean;
    maskScattering: boolean;
  };
}

export interface AssistantAnomalyNote {
  id: string;
  classification: (typeof ASSISTANT_CLASSIFICATIONS)[number];
  confidence: (typeof ASSISTANT_CONFIDENCE)[number];
  note: string;
}

export interface AssistantSuggestion {
  summary: string;
  anomalyNotes: AssistantAnomalyNote[];
  recommendations: string[];
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value))
    throw new Error(`${label}无效`);
  return value as T[number];
}

function boundedNumber(value: unknown, label: string, min: number, max: number) {
  if (!finite(value) || value < min || value > max) throw new Error(`${label}超出范围`);
  return value;
}

function stringList(value: unknown, maxItems: number, maxLength: number, label: string) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label}数量无效`);
  return value.map((entry) => textValue(entry, maxLength, label));
}

export function validateAssistantAnalysis(value: unknown): AssistantAnalysisInput {
  const input = object(value);
  const spectrum = validateSpectrum(input.spectrum);
  const blank = input.blank === null || input.blank === undefined ? null : validateSpectrum(input.blank);
  if (blank && blank.id === spectrum.id) throw new Error('空白不能同时作为样品光谱');
  if (spectrum.points.length + (blank?.points.length ?? 0) > MAX_AI_POINTS)
    throw new Error(`一次 AI 分析最多 ${MAX_AI_POINTS} 个数据点（含空白）`);
  if (!finite(input.excitationNm) || input.excitationNm <= 0) throw new Error('激发波长无效');
  if (!Array.isArray(input.anomalies) || input.anomalies.length > MAX_ASSISTANT_ANOMALIES)
    throw new Error('异常记录数量无效');
  const anomalyIds = new Set<string>();
  const anomalies = input.anomalies.map((raw): AssistantAnomalyInput => {
    const row = object(raw);
    const id = textValue(row.id, 24, '异常编号');
    if (anomalyIds.has(id)) throw new Error('异常编号重复');
    anomalyIds.add(id);
    if (!Array.isArray(row.wavelengths) || !row.wavelengths.length || row.wavelengths.length > 40)
      throw new Error('异常波长列表无效');
    const range = waveRange(row);
    return {
      id,
      kind: enumValue(row.kind, ASSISTANT_ANOMALY_KINDS, '异常类型'),
      status: enumValue(row.status, ASSISTANT_ANOMALY_STATUSES, '异常状态'),
      fromNm: range.fromNm,
      toNm: range.toNm,
      wavelengths: row.wavelengths.map((entry) =>
        boundedNumber(entry, '异常波长', spectrum.points[0].x, spectrum.points.at(-1)!.x),
      ),
      deviation: boundedNumber(row.deviation, '异常偏离', 0, 1e9),
    };
  });
  if (!Array.isArray(input.scattering) || input.scattering.length > MAX_ASSISTANT_SCATTERING)
    throw new Error('散射候选数量无效');
  const scattering = input.scattering.map((raw): AssistantScatteringInput => {
    const row = object(raw);
    const range = waveRange(row);
    if (range.fromNm < spectrum.points[0].x || range.toNm > spectrum.points.at(-1)!.x)
      throw new Error('散射候选超出测量范围');
    return {
      type: enumValue(row.type, ['rayleigh', 'second-order', 'raman'] as const, '散射类型'),
      label: textValue(row.label, 120, '散射标签'),
      fromNm: range.fromNm,
      toNm: range.toNm,
      evidence: stringList(row.evidence, 8, 300, '散射证据'),
    };
  });
  const parameters = object(input.parameters);
  return {
    fileName: textValue(input.fileName, 260, '文件名'),
    excitationNm: input.excitationNm,
    solvent: textValue(input.solvent, 200, '溶剂或基质', true),
    spectrum,
    blank,
    protectedRange:
      input.protectedRange === null || input.protectedRange === undefined
        ? null
        : waveRange(input.protectedRange),
    anomalies,
    scattering,
    parameters: {
      thresholdSigma: boundedNumber(parameters.thresholdSigma, '阈值', 2.5, 10),
      windowSize: boundedNumber(parameters.windowSize, '窗口', 5, 15),
      maxRepairRun: boundedNumber(parameters.maxRepairRun, '最大修复跨度', 1, 10),
      repairSpikes: parameters.repairSpikes === true,
      maskScattering: parameters.maskScattering === true,
    },
  };
}

export function validateAssistantSuggestion(
  value: unknown,
  input: AssistantAnalysisInput,
): AssistantSuggestion {
  const result = object(value);
  const known = new Set(input.anomalies.map((anomaly) => anomaly.id));
  const rawNotes = result.anomalyNotes ?? [];
  if (!Array.isArray(rawNotes) || rawNotes.length > MAX_ASSISTANT_ANOMALIES)
    throw new Error('AI 异常分类数量无效');
  const seen = new Set<string>();
  const anomalyNotes = rawNotes.map((raw): AssistantAnomalyNote => {
    const row = object(raw);
    const id = textValue(row.id, 24, '异常编号');
    if (!known.has(id)) throw new Error('AI 返回了本次不存在的异常编号');
    if (seen.has(id)) throw new Error('AI 重复返回异常编号');
    seen.add(id);
    return {
      id,
      classification: enumValue(row.classification, ASSISTANT_CLASSIFICATIONS, 'AI 异常分类'),
      confidence: enumValue(row.confidence, ASSISTANT_CONFIDENCE, 'AI 置信度'),
      note: textValue(row.note, 500, 'AI 分类说明'),
    };
  });
  return {
    summary: textValue(result.summary, 3000, 'AI 分析说明'),
    anomalyNotes,
    recommendations: stringList(result.recommendations ?? [], 10, 500, 'AI 建议'),
  };
}
