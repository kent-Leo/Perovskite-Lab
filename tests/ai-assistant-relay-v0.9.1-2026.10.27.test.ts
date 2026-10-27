import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAiRequest } from '../server/ai-handler-v0.9.1-2026.10.27';
import {
  validateAssistantAnalysis,
  validateAssistantSuggestion,
} from '../shared/ai-assistant-v0.9.1-2026.10.27';

const key = 'test-assistant-key-not-real';
const authHeader = ['Bea', 'rer ', key].join('');
const analysis = {
  fileName: '样品A(FDS).TXT',
  excitationNm: 360,
  solvent: '水',
  spectrum: {
    id: 's1',
    name: '样品A',
    points: Array.from({ length: 21 }, (_, index) => ({
      x: 400 + index * 10,
      y: 10 + (index === 8 ? 500 : 0),
    })),
  },
  blank: null,
  protectedRange: { fromNm: 500, toNm: 520 },
  anomalies: [
    {
      id: 'A1',
      kind: 'positive-spike',
      status: 'repaired',
      fromNm: 480,
      toNm: 480,
      wavelengths: [480],
      deviation: 12.3,
    },
  ],
  scattering: [
    {
      type: 'raman',
      label: '拉曼散射（估算）',
      fromNm: 410,
      toNm: 420,
      evidence: ['按水 3400 cm⁻¹ 估算'],
    },
  ],
  parameters: {
    thresholdSigma: 4,
    windowSize: 7,
    maxRepairRun: 3,
    repairSpikes: true,
    maskScattering: false,
  },
};
const suggestion = {
  summary: 'A1 是孤立异常点；目标峰保护区未被修改。',
  anomalyNotes: [
    { id: 'A1', classification: 'spike', confidence: 'high', note: '单点偏离明显。' },
  ],
  recommendations: ['确认 A1 的局部插值值后导出。'],
};
function request(body: unknown = { provider: 'deepseek', model: 'deepseek-flash', input: analysis },
  path = 'assistant', headers: Record<string, string> = {}) {
  return new Request(`https://lab.example/api/ai/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
      Origin: 'https://lab.example',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
function success(content: unknown = suggestion, finish = 'stop') {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finish,
    message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }));
}
afterEach(() => vi.restoreAllMocks());

describe('AI 异常分类转发接口', () => {
  it('forwards only canonical assistant input and returns a validated classification', async () => {
    const upstream = vi.fn().mockResolvedValue(success());
    const response = await handleAiRequest(request(), upstream);
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.headers.Authorization).toBe(authHeader);
    expect(init.redirect).toBe('manual');
    const body = JSON.parse(init.body);
    expect(body.messages[0].content).toContain('不修改任何强度数值');
    expect(JSON.parse(body.messages[1].content)).toEqual(validateAssistantAnalysis(analysis));
    const payload = await response.json();
    expect(payload).toMatchObject({ summary: suggestion.summary, provider: 'deepseek' });
    expect(JSON.stringify(payload)).not.toContain(key);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects hallucinated anomaly ids, duplicate notes and invalid classifications', async () => {
    for (const content of [
      { ...suggestion, anomalyNotes: [{ ...suggestion.anomalyNotes[0], id: 'A999' }] },
      { ...suggestion, anomalyNotes: [suggestion.anomalyNotes[0], suggestion.anomalyNotes[0]] },
      { ...suggestion, anomalyNotes: [{ ...suggestion.anomalyNotes[0], classification: 'delete-column' }] },
      { ...suggestion, anomalyNotes: [{ ...suggestion.anomalyNotes[0], confidence: 'certain' }] },
      { ...suggestion, anomalyNotes: [{ ...suggestion.anomalyNotes[0], note: '' }] },
      { ...suggestion, recommendations: Array.from({ length: 11 }, () => 'x') },
    ]) {
      const upstream = vi.fn().mockResolvedValue(success(content));
      const response = await handleAiRequest(request(), upstream);
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain(key);
    }
  });

  it('rejects truncated or empty output without applying anything', async () => {
    for (const [content, finish] of [['', 'stop'], [suggestion, 'length'], ['not json', 'stop']]) {
      const upstream = vi.fn().mockResolvedValue(success(content, String(finish)));
      expect((await handleAiRequest(request(), upstream)).status).toBe(502);
    }
  });

  it('validates assistant input before contacting the provider', async () => {
    const upstream = vi.fn();
    for (const input of [
      { ...analysis, excitationNm: 0 },
      { ...analysis, anomalies: [{ ...analysis.anomalies[0], id: 'A1', fromNm: 999, toNm: 900 }] },
      { ...analysis, anomalies: [{ ...analysis.anomalies[0], wavelengths: [9999] }] },
      { ...analysis, parameters: { ...analysis.parameters, thresholdSigma: 99 } },
      { ...analysis, spectrum: { ...analysis.spectrum, points: [{ x: 400, y: 1 }] } },
    ]) {
      const response = await handleAiRequest(
        request({ provider: 'deepseek', model: 'deepseek-flash', input }),
        upstream,
      );
      expect(response.status).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects cross-origin, non-JSON, unknown models and unknown paths', async () => {
    const upstream = vi.fn();
    expect((await handleAiRequest(request(undefined, 'assistant', { Origin: 'https://evil.example' }), upstream)).status).toBe(403);
    expect((await handleAiRequest(request(undefined, 'assistant', { 'Content-Type': 'text/plain' }), upstream)).status).toBe(415);
    expect((await handleAiRequest(request({ provider: 'deepseek', model: 'unknown', input: analysis }), upstream)).status).toBe(400);
    expect((await handleAiRequest(request(undefined, 'unknown'), upstream)).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('AI 分类输出校验', () => {
  it('accepts a subset of anomalies and no numeric changes', () => {
    const input = validateAssistantAnalysis(analysis);
    expect(validateAssistantSuggestion(suggestion, input)).toEqual(suggestion);
    expect(
      validateAssistantSuggestion({ summary: '不确定', anomalyNotes: [], recommendations: [] }, input),
    ).toEqual({ summary: '不确定', anomalyNotes: [], recommendations: [] });
    expect(validateAssistantSuggestion({ summary: '仅说明，无分类' }, input)).toEqual({
      summary: '仅说明，无分类',
      anomalyNotes: [],
      recommendations: [],
    });
  });
});
