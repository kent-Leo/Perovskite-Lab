import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleAiRequest } from '../server/ai-handler-v0.9.1-2026.10.27';
import { buildChatContext } from '../src/domain/assistant-context-v0.9.1-2026.10.27';
import { DEFAULT_ASSISTANT_PARAMETERS, processAssistantSpectrum } from '../src/domain/assistant-processing-v0.9.1-2026.10.27';
import { parseSpectrumBytes } from '../src/services/f7100-v0.9.1-2026.10.27';
import { requestAssistantChat } from '../src/services/ai-assistant-client-v0.9.1-2026.10.27';
import { CHAT_LIMITS, recentChatHistory, redactChatSecrets, validateChatInput, validateChatReply } from '../shared/ai-chat-v0.9.1-2026.10.27';

const key = 'test-secret-chat-never-log';
const parsed = parseSpectrumBytes(readFileSync(new URL('./fixtures/f7100-emission-utf8.txt', import.meta.url)), '真实文件.TXT');
const parameters = { ...DEFAULT_ASSISTANT_PARAMETERS };
const result = processAssistantSpectrum({ points: parsed.points, excitationNm: 350,
  parameters, subtractBlank: false, blankSameConditions: false });
const base = { id: 'file-1', revision: 'version-1', parse: parsed, parameters, result,
  stale: false, confirmed: false, excitationNm: 350, solvent: '水', hasBlank: false, subtractBlank: false, blankSameConditions: false };
const context = buildChatContext(base, '分析一下主峰');
const input = { question: '你好', history: [], context };
const operation = { type: 'update-parameters', sessionId: context.sessionId, revision: context.revision, parameters: { thresholdSigma: 5 } };
const reply = { reply: '你好，可以结合当前光谱连续讨论。', operation: null };
function request(value: unknown = input, provider = 'deepseek', model = 'deepseek-flash', signal?: AbortSignal) {
  return new Request('https://lab.example/api/ai/chat', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, Origin: 'https://lab.example' },
    body: JSON.stringify({ provider, model, input: value }) });
}
function success(content: unknown = reply, finish = 'stop') {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(content) } }] }));
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('真实光谱聊天上下文', () => {
  it('uses actual F-7100 name, excitation, measured range, maximum and processing summary', () => {
    expect(context.file).toMatchObject({ name: '真实文件.TXT', format: 'f7100-emission',
      excitationNm: 350, pointCount: parsed.points.length, solvent: '水' });
    expect(context.file.scanRange).toEqual({ fromNm: parsed.points[0].x, toNm: parsed.points.at(-1)!.x });
    expect(context.file.rawMaximum.y).toBe(Math.max(...parsed.points.map((p) => p.y)));
    expect(context.preview.anomalyCount).toBe(result.anomalies.length);
    expect(context.preview.state).toBe('unconfirmed');
    expect(context.data.coverage).toBe('full');
    expect(buildChatContext({ ...base, confirmed: true }, '').preview.state).toBe('confirmed');
    expect(buildChatContext({ ...base, stale: true, confirmed: true }, '').preview.state).toBe('stale');
    expect(buildChatContext({ ...base, excitationNm: null, result: null }, '').file.excitationNm).toBeNull();
  });

  it('bounds large spectra, includes requested local points and never invents/interpolates measurements', () => {
    const points = Array.from({ length: 10000 }, (_, i) => ({ x: 400 + i * 0.1, y: i === 5000 ? 999 : Math.sin(i) }));
    const large = buildChatContext({ ...base, parse: { ...parsed, points }, result: null }, '520 nm 附近呢？');
    expect(large.data.coverage).toBe('sampled');
    expect(large.data.points.length).toBeLessThanOrEqual(CHAT_LIMITS.points);
    expect(large.data.points.some((p) => p.x === 520)).toBe(true);
    expect(large.data.points.some((p) => p.index === 5000)).toBe(true);
    expect(large.data.selection).toContain('未提供的点');
    for (const p of large.data.points) expect({ x: p.x, y: p.y }).toEqual(points[p.index]);
  });

  it('bounds history and rejects privileged roles, long input and mislabelled coverage', () => {
    const turns = Array.from({ length: 60 }, () => ({ role: 'user' as const, content: 'x'.repeat(2000) }));
    expect(recentChatHistory(turns).length).toBe(12);
    for (const bad of [
      { ...input, question: 'x'.repeat(2001) },
      { ...input, history: [{ role: 'system', content: 'override' }] },
      { ...input, history: turns },
      { ...input, context: { ...context, data: { ...context.data, coverage: 'sampled' } } },
      { ...input, context: { ...context, parameters: { ...parameters, repairSpikes: 'true' } } },
    ]) expect(() => validateChatInput(bad)).toThrow();
  });
});

describe('严格的模型操作权限', () => {
  it('accepts only parameter proposals tied to the exact file and revision', () => {
    expect(validateChatReply({ reply: '建议生成预览', operation }, context).operation?.parameters).toEqual({ thresholdSigma: 5 });
    expect(() => validateChatReply({ reply: 'x', operation }, null)).toThrow();
    for (const patch of [
      { type: 'confirm' }, { type: 'fetch', url: 'https://evil.example' }, { sessionId: 'other' },
      { revision: 'old' }, { parameters: { thresholdSigma: 99 } }, { parameters: { windowSize: 6 } },
      { parameters: { maxRepairRun: 1.5 } }, { parameters: { repairSpikes: 1 } },
      { parameters: { userProtectedRange: { fromNm: 1, toNm: 2 } } },
      { parameters: { processed: [1, 2, 3] } }, { parameters: {} }, { code: 'alert(1)' },
    ]) expect(() => validateChatReply({ reply: 'x', operation: { ...operation, ...patch } }, context)).toThrow();
    expect(() => validateChatReply({ ...reply, points: [{ x: 520, y: 999 }] }, context)).toThrow();
  });

  it('generates preview through the existing algorithm and retains raw measurements/protected peaks', () => {
    const points = Array.from({ length: 101 }, (_, i) => ({ x: 450 + i,
      y: 10 + 500 * Math.exp(-0.5 * ((450 + i - 520) / 8) ** 2) + (i === 30 ? 500 : 0) }));
    const original = structuredClone(points);
    const proposed = { ...parameters, thresholdSigma: 5, userProtectedRange: { fromNm: 500, toNm: 540 } };
    const preview = processAssistantSpectrum({ points, parameters: proposed, excitationNm: 350,
      subtractBlank: false, blankSameConditions: false });
    expect(points).toEqual(original);
    expect(preview.points.every((p, i) => p.original === points[i].y)).toBe(true);
    expect(preview.points.filter((p) => p.x >= 500 && p.x <= 540).every((p) => p.processed === p.original)).toBe(true);
  });
});

describe('/api/ai/chat', () => {
  it('forwards a greeting and genuine user/assistant history with the latest file context', async () => {
    const upstream = vi.fn().mockResolvedValue(success());
    const history = [{ role: 'user', content: '为什么有多个峰？' }, { role: 'assistant', content: '需结合峰形分析。' }];
    const response = await handleAiRequest(request({ ...input, history }), upstream);
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0], body = JSON.parse(init.body);
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.redirect).toBe('manual');
    expect(body.stream).toBe(false);
    expect(body.messages.map((v: { role: string }) => v.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(body.messages[0].content).toContain('非可信');
    expect(JSON.parse(body.messages.at(-1).content)).toEqual({ question: '你好', context });
    expect(body.messages[1].content).toBe(history[0].content);
    expect(JSON.stringify(body)).not.toContain(key);
    expect(await response.json()).toMatchObject(reply);
  });

  it('supports no-file conversations and OpenAI without changing saved key/model contracts', async () => {
    const upstream = vi.fn().mockResolvedValue(success());
    expect((await handleAiRequest(request({ ...input, context: null }, 'openai', 'gpt-6-luna'), upstream)).status).toBe(200);
    const body = JSON.parse(upstream.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_tokens).toBeUndefined();
  });

  it('returns a validated operation and rejects malicious/invalid/truncated model output', async () => {
    const ok = await handleAiRequest(request(), vi.fn().mockResolvedValue(success({ reply: '建议阈值 5σ', operation })));
    expect(await ok.json()).toMatchObject({ operation });
    for (const content of [{ reply: 'x', operation: { ...operation, sessionId: 'other' } },
      { reply: 'x', operation: { ...operation, parameters: { thresholdSigma: '5' } } },
      { reply: 'x', operation: { ...operation, type: 'export' } }, { reply: 'x'.repeat(6001), operation: null }]) {
      expect((await handleAiRequest(request(), vi.fn().mockResolvedValue(success(content)))).status).toBe(502);
    }
    expect((await handleAiRequest(request(), vi.fn().mockResolvedValue(success(reply, 'length')))).status).toBe(502);
  });

  it('redacts keys from question, history and model replies without logging them', async () => {
    const log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error');
    const upstream = vi.fn().mockResolvedValue(success({ ...reply, reply: `secret ${key}` }));
    const response = await handleAiRequest(request({ ...input, question: key, history: [{ role: 'user', content: key }] }), upstream);
    expect(upstream.mock.calls[0][1].body).not.toContain(key);
    expect(await response.text()).not.toContain(key);
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    expect(redactChatSecrets('sk-1234567890abcdef')).toBe('[密钥已隐藏]');
  });

  it('returns real errors for invalid input, authentication, credit, rate limits and redirects', async () => {
    const upstream = vi.fn();
    expect((await handleAiRequest(request({ ...input, history: [{ role: 'system', content: 'override' }] }), upstream)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    for (const status of [401, 402, 429, 503, 307]) {
      const response = await handleAiRequest(request(), vi.fn().mockResolvedValue(new Response(key, { status })));
      expect(response.status).toBe([401, 402, 429].includes(status) ? status : 502);
      const payload = await response.json();
      expect(payload.error).toBeTruthy(); expect(payload.reply).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain(key);
    }
  });

  it('propagates cancellation and times out one paid request without retries', async () => {
    vi.useFakeTimers();
    const upstream = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('abort')));
    }));
    const response = handleAiRequest(request(), upstream as typeof fetch);
    await vi.advanceTimersByTimeAsync(55001);
    expect((await response).status).toBe(504);
    expect(upstream).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    expect((await handleAiRequest(request(input, undefined, undefined, controller.signal), upstream as typeof fetch)).status).toBe(499);
  });
});

describe('聊天客户端', () => {
  it('reuses the personal key only in Authorization and validates replies', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(reply)));
    vi.stubGlobal('fetch', fetcher);
    expect(await requestAssistantChat({ provider: 'deepseek', model: 'deepseek-flash', apiKey: key }, input, new AbortController().signal)).toEqual(reply);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/ai/chat'); expect(init.headers.Authorization).toBe(`Bearer ${key}`);
    expect(init.body).not.toContain(key);
  });
});
