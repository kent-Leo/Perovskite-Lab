import { finite, object, textValue, waveRange, type WaveRange } from './ai-contract-2026.10.24';
import type { AssistantParameters } from '../src/domain/assistant-processing-2026.10.25';

export const CHAT_LIMITS = { question: 2000, reply: 6000, history: 20, historyChars: 24000, points: 384 } as const;
export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export interface ChatContext {
  sessionId: string;
  revision: string;
  selectedFiles?: BatchFileContext[];
  file: {
    name: string; format: string; pointCount: number; excitationNm: number | null; solvent: string;
    scanRange: WaveRange; rawMaximum: { x: number; y: number };
  };
  parameters: AssistantParameters;
  preview: {
    state: 'missing' | 'stale' | 'unconfirmed' | 'confirmed';
    algorithm: string;
    parameters: AssistantParameters;
    mainPeak: { x: number; y: number } | null;
    protectedRanges: WaveRange[];
    anomalyCount: number;
    anomalies: { id: string; kind: string; status: string; fromNm: number; toNm: number }[];
    scattering: { label: string; fromNm: number; toNm: number; overlapsProtected: boolean }[];
    repaired: number; masked: number; unresolved: number;
    blank: { selected: boolean; subtract: boolean; sameConditions: boolean; applied: boolean };
  };
  data: {
    coverage: 'full' | 'sampled';
    selection: string;
    localRanges: WaveRange[];
    points: { index: number; x: number; y: number }[];
  };
}
export interface ChatInput { question: string; history: ChatTurn[]; context: ChatContext | null }
export interface ParameterOperation {
  type: 'update-parameters';
  sessionId: string;
  revision: string;
  parameters: Partial<AssistantParameters>;
}
export type BatchEdit =
  | { type: 'delete-range' | 'mask-range' | 'keep-range'; fromNm: number; toNm: number; reason: string }
  | { type: 'set-point'; wavelengthNm: number; value: number; reason: string }
  | { type: 'offset' | 'scale'; fromNm: number; toNm: number; value: number; reason: string }
  | { type: 'normalize'; fromNm: number; toNm: number; target: number; reason: string };
export interface BatchFileContext {
  id: string; name: string; version: string; scanRange: WaveRange; pointCount: number;
  state?: 'stale' | 'preview' | 'confirmed';
  summary: { remaining: number; masked: number; deleted: number; maximum: { x: number; y: number }; processedMaximum?: { x: number; y: number } | null };
}
export interface BatchEditOperation {
  type: 'batch-edit'; sessionId: string; revision: string;
  targets: { fileId: string; version: string }[];
  edits: BatchEdit[];
}
export type ChatOperation = ParameterOperation | BatchEditOperation;

/** Closed intervals in nm; exact measured wavelengths for set-point, never interpolation. */
export function validateBatchOperation(value: unknown): BatchEditOperation {
  const op = object(value);
  keys(op, ['type', 'sessionId', 'revision', 'targets', 'edits']);
  if (op.type !== 'batch-edit') throw new Error('批量操作类型无效');
  const targets = list(op.targets, 20, (v) => {
    const t = object(v); keys(t, ['fileId', 'version']);
    return { fileId: textValue(t.fileId, 120, '文件 ID'), version: textValue(t.version, 120, '文件版本') };
  });
  if (!targets.length || new Set(targets.map(t => t.fileId)).size !== targets.length) throw new Error('批量目标为空或重复');
  const edits = list(op.edits, 50, (v): BatchEdit => {
    const e = object(v);
    const type = choice(e.type, ['delete-range', 'mask-range', 'keep-range', 'set-point', 'offset', 'scale', 'normalize']);
    const fields = type === 'set-point' ? ['wavelengthNm', 'value']
      : ['fromNm', 'toNm', ...(type === 'normalize' ? ['target'] : ['offset', 'scale'].includes(type) ? ['value'] : [])];
    keys(e, ['type', 'reason', ...fields]);
    const reason = textValue(e.reason, 500, '编辑理由');
    if (type === 'set-point') return { type, reason, wavelengthNm: num(e.wavelengthNm, '波长 nm', 0, 1e6), value: num(e.value, '指定强度', -1e100, 1e100) };
    const fromNm = num(e.fromNm, '区间起点 nm', 0, 1e6), toNm = num(e.toNm, '区间终点 nm', fromNm, 1e6);
    if (type === 'offset' || type === 'scale') return { type, reason, fromNm, toNm, value: num(e.value, '编辑数值', -1e100, 1e100) };
    if (type === 'normalize') return { type, reason, fromNm, toNm, target: num(e.target, '归一化目标', 1e-100, 1e100) };
    return { type, reason, fromNm, toNm };
  });
  if (!edits.length) throw new Error('编辑计划为空');
  return { type: 'batch-edit', sessionId: textValue(op.sessionId, 120, '会话编号'),
    revision: textValue(op.revision, 120, '数据版本'), targets, edits };
}

function validateBatchFiles(value: unknown): BatchFileContext[] {
  const files = list(value, 20, v => {
    const f = object(v); keys(f, ['id', 'name', 'version', 'scanRange', 'pointCount', 'summary', 'state']);
    const bounds = waveRange(f.scanRange), count = num(f.pointCount, '点数', 2, 10000000, true);
    const s = object(f.summary); keys(s, ['remaining', 'masked', 'deleted', 'maximum', 'processedMaximum']);
    const m = object(s.maximum); keys(m, ['x', 'y']);
    const remaining = num(s.remaining, '剩余点数', 0, count, true), deleted = num(s.deleted, '删除点数', 0, count, true);
    if (remaining + deleted !== count) throw new Error('文件摘要点数不一致');
    let processedMaximum: { x: number; y: number } | null | undefined;
    if (s.processedMaximum === null) processedMaximum = null;
    else if (s.processedMaximum !== undefined) {
      const p = object(s.processedMaximum); keys(p, ['x', 'y']);
      processedMaximum = { x: num(p.x, '处理后最大值波长', bounds.fromNm, bounds.toNm), y: num(p.y, '处理后最大强度', -1e100, 1e100) };
    }
    return { ...(f.state === undefined ? {} : { state: choice(f.state, ['stale', 'preview', 'confirmed']) }),
      id: textValue(f.id, 120, '文件 ID'), name: textValue(f.name, 260, '文件名'),
      version: textValue(f.version, 120, '文件版本'), scanRange: bounds, pointCount: count,
      summary: { ...(processedMaximum === undefined ? {} : { processedMaximum }), remaining, deleted, masked: num(s.masked, '屏蔽点数', 0, remaining, true),
        maximum: { x: num(m.x, '最大值波长', bounds.fromNm, bounds.toNm), y: num(m.y, '最大强度', -1e100, 1e100) } } };
  });
  if (new Set(files.map(f => f.id)).size !== files.length) throw new Error('文件 ID 重复');
  return files;
}
export interface ChatReply { reply: string; operation: ChatOperation | null }

function keys(row: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(row).some((key) => !allowed.includes(key))) throw new Error('包含未授权字段');
}
function num(value: unknown, label: string, min: number, max: number, integer = false) {
  if (!finite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    throw new Error(`${label}超出范围或类型无效`);
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('开关参数必须为布尔值');
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error('枚举参数无效');
  return value as T;
}
function list<T>(value: unknown, max: number, validate: (v: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('列表长度无效');
  return value.map(validate);
}
function range(value: unknown, bounds: WaveRange) {
  const row = object(value);
  keys(row, ['fromNm', 'toNm']);
  const result = waveRange(row);
  if (result.fromNm < bounds.fromNm || result.toNm > bounds.toNm) throw new Error('区间超出测量范围');
  return result;
}
const parameterKeys = ['sensitivity', 'thresholdSigma', 'windowSize', 'maxRepairRun', 'repairSpikes',
  'protectMainPeak', 'protectExtraNm', 'userProtectedRange', 'analysisRange', 'maskScattering',
  'scatteringToleranceNm', 'maskUnrepairable'] as const;

/** Reject rather than clamp model parameters. The numerical engine remains unchanged. */
export function validateChatParameters(value: unknown, bounds: WaveRange, partial = false): Partial<AssistantParameters> {
  const row = object(value), result: Record<string, unknown> = {};
  keys(row, parameterKeys);
  if (!Object.keys(row).length) throw new Error('操作建议没有参数');
  for (const key of parameterKeys) {
    if (!(key in row)) {
      if (!partial) throw new Error('处理参数不完整');
      continue;
    }
    const v = row[key];
    switch (key) {
      case 'sensitivity': result[key] = choice(v, ['conservative', 'balanced', 'aggressive']); break;
      case 'thresholdSigma': result[key] = num(v, '阈值', 2.5, 10); break;
      case 'windowSize': {
        const n = num(v, '窗口', 5, 15, true);
        if (n % 2 !== 1) throw new Error('窗口必须为奇数');
        result[key] = n; break;
      }
      case 'maxRepairRun': result[key] = num(v, '修复跨度', 1, 10, true); break;
      case 'protectExtraNm': result[key] = num(v, '保护边界', 0, 50); break;
      case 'scatteringToleranceNm': result[key] = num(v, '散射半宽', 0.5, 20); break;
      case 'userProtectedRange': case 'analysisRange': result[key] = v === null ? null : range(v, bounds); break;
      default: result[key] = bool(v);
    }
  }
  return result;
}

export function validateChatContext(value: unknown): ChatContext {
  const c = object(value);
  keys(c, ['sessionId', 'revision', 'selectedFiles', 'file', 'parameters', 'preview', 'data']);
  const f = object(c.file), p = object(c.preview), d = object(c.data);
  keys(f, ['name', 'format', 'pointCount', 'excitationNm', 'solvent', 'scanRange', 'rawMaximum']);
  keys(p, ['state', 'algorithm', 'parameters', 'mainPeak', 'protectedRanges', 'anomalyCount', 'anomalies',
    'scattering', 'repaired', 'masked', 'unresolved', 'blank']);
  keys(d, ['coverage', 'selection', 'localRanges', 'points']);
  const bounds = waveRange(f.scanRange), count = num(f.pointCount, '点数', 2, 10000000, true);
  const point = (v: unknown) => {
    const row = object(v); keys(row, ['x', 'y']);
    return { x: num(row.x, '波长', bounds.fromNm, bounds.toNm), y: num(row.y, '强度', -1e100, 1e100) };
  };
  const points = list(d.points, CHAT_LIMITS.points, (v) => {
    const row = object(v); keys(row, ['index', 'x', 'y']);
    return { index: num(row.index, '点索引', 0, count - 1, true), ...point({ x: row.x, y: row.y }) };
  });
  if (points.length < 2 || points.some((v, i) => i > 0 &&
      (v.index <= points[i - 1].index || v.x <= points[i - 1].x))) throw new Error('上下文测量点顺序无效');
  const coverage = choice(d.coverage, ['full', 'sampled']);
  if ((coverage === 'full') !== (points.length === count)) throw new Error('数据覆盖范围标记与点数不符');
  const blank = object(p.blank); keys(blank, ['selected', 'subtract', 'sameConditions', 'applied']);
  const anomalyCount = num(p.anomalyCount, '异常数', 0, count, true);
  const anomalies = list(p.anomalies, 80, (v) => {
    const row = object(v); keys(row, ['id', 'kind', 'status', 'fromNm', 'toNm']);
    return { id: textValue(row.id, 24, '异常编号'),
      kind: choice(row.kind, ['positive-spike', 'negative-spike', 'scattering', 'unrepairable']),
      status: choice(row.status, ['repaired', 'masked', 'unresolved', 'suggested']),
      ...range({ fromNm: row.fromNm, toNm: row.toNm }, bounds) };
  });
  if (anomalies.length > anomalyCount) throw new Error('异常摘要数量不一致');
  return {
    ...(c.selectedFiles === undefined ? {} : { selectedFiles: validateBatchFiles(c.selectedFiles) }),
    sessionId: textValue(c.sessionId, 120, '会话编号'), revision: textValue(c.revision, 120, '数据版本'),
    file: { name: textValue(f.name, 260, '文件名'), format: textValue(f.format, 80, '格式'), pointCount: count,
      excitationNm: f.excitationNm === null ? null : num(f.excitationNm, '激发波长', 0.01, 1e6),
      solvent: textValue(f.solvent, 200, '溶剂', true),
      scanRange: bounds, rawMaximum: point(f.rawMaximum) },
    parameters: validateChatParameters(c.parameters, bounds) as AssistantParameters,
    preview: {
      state: choice(p.state, ['missing', 'stale', 'unconfirmed', 'confirmed']),
      algorithm: textValue(p.algorithm, 100, '算法', true),
      parameters: validateChatParameters(p.parameters, bounds) as AssistantParameters,
      mainPeak: p.mainPeak === null ? null : point(p.mainPeak),
      protectedRanges: list(p.protectedRanges, 80, (v) => range(v, bounds)),
      anomalyCount, anomalies,
      scattering: list(p.scattering, 12, (v) => {
        const row = object(v); keys(row, ['label', 'fromNm', 'toNm', 'overlapsProtected']);
        return { label: textValue(row.label, 120, '散射候选'),
          ...range({ fromNm: row.fromNm, toNm: row.toNm }, bounds), overlapsProtected: bool(row.overlapsProtected) };
      }),
      repaired: num(p.repaired, '修复数', 0, count, true), masked: num(p.masked, '屏蔽数', 0, count, true),
      unresolved: num(p.unresolved, '未决数', 0, count, true),
      blank: { selected: bool(blank.selected), subtract: bool(blank.subtract), sameConditions: bool(blank.sameConditions), applied: bool(blank.applied) },
    },
    data: { coverage, selection: textValue(d.selection, 500, '取点说明'),
      localRanges: list(d.localRanges, 4, (v) => range(v, bounds)), points },
  };
}

export function validateChatInput(value: unknown): ChatInput {
  const row = object(value); keys(row, ['question', 'history', 'context']);
  const history = list(row.history, CHAT_LIMITS.history, (v): ChatTurn => {
    const turn = object(v); keys(turn, ['role', 'content']);
    return { role: choice(turn.role, ['user', 'assistant']), content: textValue(turn.content, CHAT_LIMITS.reply, '历史消息') };
  });
  if (history.reduce((sum, v) => sum + v.content.length, 0) > CHAT_LIMITS.historyChars) throw new Error('对话历史过长');
  return { question: textValue(row.question, CHAT_LIMITS.question, '问题'), history,
    context: row.context === null ? null : validateChatContext(row.context) };
}

export function validateChatReply(value: unknown, context: ChatContext | null): ChatReply {
  const row = object(value); keys(row, ['reply', 'operation']);
  const reply = textValue(row.reply, CHAT_LIMITS.reply, '模型回复');
  if (row.operation === null) return { reply, operation: null };
  if (!context) throw new Error('未上传文件，不能操作数据');
  if (object(row.operation).type === 'batch-edit') {
    const operation = validateBatchOperation(row.operation), files = context.selectedFiles ?? [];
    if (operation.sessionId !== context.sessionId || operation.revision !== context.revision)
      throw new Error('操作会话或版本不匹配');
    if (operation.targets.length !== files.length || operation.targets.some(t => !files.some(f => f.id === t.fileId && f.version === t.version)))
      throw new Error('批量文件权限或版本不匹配');
    if (files.some(f => f.state === 'stale')) throw new Error('所选文件预览已过期，请先重新生成结果');
    for (const f of files) for (const e of operation.edits) {
      const from = e.type === 'set-point' ? e.wavelengthNm : e.fromNm;
      const to = e.type === 'set-point' ? e.wavelengthNm : e.toNm;
      if (from < f.scanRange.fromNm || to > f.scanRange.toNm) throw new Error(`${f.name}：区间超出测量范围`);
    }
    return { reply, operation };
  }
  const op = object(row.operation); keys(op, ['type', 'sessionId', 'revision', 'parameters']);
  if (op.type !== 'update-parameters' || op.sessionId !== context.sessionId || op.revision !== context.revision)
    throw new Error('操作类型、文件或版本不匹配');
  return { reply, operation: { type: 'update-parameters', sessionId: context.sessionId, revision: context.revision,
    parameters: validateChatParameters(op.parameters, context.file.scanRange, true) } };
}

/** Keep a bounded recent tail; history never contains credentials or system roles. */
export function recentChatHistory(turns: ChatTurn[]): ChatTurn[] {
  const selected: ChatTurn[] = [];
  let length = 0;
  for (const turn of turns.slice(-CHAT_LIMITS.history).reverse()) {
    if (length + turn.content.length > CHAT_LIMITS.historyChars) break;
    selected.unshift(turn); length += turn.content.length;
  }
  return selected;
}

export function redactChatSecrets(text: string, secrets: string[] = []): string {
  let result = text;
  for (const secret of secrets) if (secret.trim().length >= 8) result = result.split(secret).join('[密钥已隐藏]');
  return result.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[密钥已隐藏]')
    .replace(/Bearer\s+[\x21-\x7e]{8,512}/gi, '[密钥已隐藏]');
}
