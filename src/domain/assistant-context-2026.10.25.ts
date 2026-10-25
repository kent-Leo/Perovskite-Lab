import { CHAT_LIMITS, validateChatContext, type ChatContext } from '../../shared/ai-chat-2026.10.25';
import type { ParsedSpectrumFile } from '../services/f7100-2026.10.25';
import type { AssistantParameters, AssistantProcessingResult } from './assistant-processing-2026.10.25';

export function buildChatContext(input: {
  id: string; revision: string; parse: ParsedSpectrumFile; parameters: AssistantParameters;
  result: AssistantProcessingResult | null; stale: boolean; confirmed: boolean;
  excitationNm: number | null; solvent: string; hasBlank: boolean; subtractBlank: boolean; blankSameConditions: boolean;
}, question: string): ChatContext {
  const { parse, result } = input, points = parse.points;
  const bounds = { fromNm: points[0].x, toNm: points.at(-1)!.x };
  let maxIndex = 0;
  for (let i = 1; i < points.length; i++) if (points[i].y > points[maxIndex].y) maxIndex = i;
  // Wavelength retrieval only; language understanding and intent remain the model's responsibility.
  const localRanges = [...question.matchAll(/(\d+(?:\.\d+)?)\s*(?:[–—~至到-]\s*(\d+(?:\.\d+)?))?\s*(?:nm|纳米)/gi)]
    .slice(-4).map((match) => {
      const a = Number(match[1]), b = match[2] ? Number(match[2]) : a;
      return { fromNm: Math.max(bounds.fromNm, Math.min(a, b) - (a === b ? 5 : 0)),
        toNm: Math.min(bounds.toNm, Math.max(a, b) + (a === b ? 5 : 0)) };
    }).filter((r) => r.toNm >= r.fromNm);
  const indices = new Set<number>();
  const add = (i: number) => { if (i >= 0 && i < points.length && indices.size < CHAT_LIMITS.points) indices.add(i); };
  if (points.length <= CHAT_LIMITS.points) points.forEach((_, i) => add(i));
  else {
    // Always retain endpoints, actual maximum and peak/apparent anomaly neighbourhoods.
    add(0); add(points.length - 1); add(maxIndex);
    const near = (index: number) => { for (let offset = -3; offset <= 3; offset++) add(index + offset); };
    near(maxIndex);
    if (result?.mainPeak) near(points.findIndex((p) => p.x === result.mainPeak!.originalX));
    for (const anomaly of result?.anomalies.slice(0, 12) ?? []) { near(anomaly.fromIndex); near(anomaly.toIndex); }
    // Bound each local window; selected points are actual rows, never interpolation.
    for (const r of localRanges) {
      const local = points.flatMap((p, i) => p.x >= r.fromNm && p.x <= r.toNm ? [i] : []);
      if (local.length) add(local[Math.floor(local.length / 2)]);
      const n = Math.min(local.length, 40);
      for (let j = 0; j < n; j++) add(local[Math.round(j * (local.length - 1) / Math.max(1, n - 1))]);
    }
    const remaining = CHAT_LIMITS.points - indices.size;
    for (let j = 0; j < remaining; j++) add(Math.round(j * (points.length - 1) / Math.max(1, remaining - 1)));
  }
  const context: ChatContext = {
    sessionId: input.id, revision: input.revision,
    file: { name: parse.fileName, format: parse.format, pointCount: points.length,
      excitationNm: input.excitationNm, solvent: input.solvent, scanRange: bounds, rawMaximum: points[maxIndex] },
    parameters: input.parameters,
    preview: {
      state: !result ? 'missing' : input.stale ? 'stale' : input.confirmed ? 'confirmed' : 'unconfirmed',
      algorithm: result?.algorithmVersion ?? '', parameters: result?.parameters ?? input.parameters,
      mainPeak: result?.mainPeak ? { x: result.mainPeak.originalX, y: result.mainPeak.originalY } : null,
      protectedRanges: result?.protectedRanges ?? [], anomalyCount: result?.anomalies.length ?? 0,
      anomalies: (result?.anomalies ?? []).slice(0, 80).map(({ id, kind, status, fromNm, toNm }) => ({ id, kind, status, fromNm, toNm })),
      scattering: (result?.scattering ?? []).map(({ label, fromNm, toNm, overlapsProtected }) => ({ label, fromNm, toNm, overlapsProtected })),
      repaired: result?.stats.repaired ?? 0, masked: result?.stats.masked ?? 0, unresolved: result?.stats.unresolved ?? 0,
      blank: { selected: input.hasBlank, subtract: input.subtractBlank, sameConditions: input.blankSameConditions, applied: !!result?.blank?.used },
    },
    data: { coverage: indices.size === points.length ? 'full' : 'sampled',
      selection: '本地全谱计算指标；原始测量点按全谱均匀抽取，并优先包含最大值、主峰、前12个异常及提问波长附近。局部区间也可能抽样；未提供的点未供模型逐点检查。',
      localRanges, points: [...indices].sort((a, b) => a - b).map((index) => ({ index, ...points[index] })) },
  };
  return validateChatContext(context);
}
