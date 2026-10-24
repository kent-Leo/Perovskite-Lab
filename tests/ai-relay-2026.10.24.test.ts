import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAiRequest } from '../server/ai-handler-2026.10.24';
import worker from '../worker/ai-worker-2026.10.24';
const key = 'test-secret-not-a-real-key';
const input = { spectra: [{ id: 's1', name: '测试', points: [{ x: 400, y: 12 }, { x: 410, y: 15 }] }],
  excitationNm: 350, solvent: '水', protectedRange: null, blank: null };
const suggestion = { summary: '待人工确认', regions: [{ spectrumId: 's1', fromNm: 400, toNm: 400, reason: '疑似干扰' }] };
function request(body: unknown = { provider: 'deepseek', model: 'deepseek-flash', input }, path = 'analyze',
  headers: Record<string, string> = {}) {
  return new Request(`https://lab.example/api/ai/${path}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${key}`, Origin: 'https://lab.example', ...headers },
  body: JSON.stringify(body) });
}
function success(content: unknown = suggestion, finish = 'stop') {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finish,
    message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }));
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('BYOK relay', () => {
  it('forwards only the supplied key to an allowlisted provider; strips arbitrary URLs and headers', async () => {
    const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
    const upstream = vi.fn().mockResolvedValue(success());
    const response = await handleAiRequest(request({ provider: 'deepseek', model: 'deepseek-flash', input,
      endpoint: 'https://attacker.example', apiKey: 'body-key', messages: ['override'] }), upstream);
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.headers.Authorization).toBe(`Bearer ${key}`);
    expect(init.redirect).toBe('manual');
    expect(JSON.stringify(init.body)).not.toContain(key);
    expect(JSON.parse(JSON.parse(init.body).messages[1].content)).toEqual(input);
    expect(await response.text()).not.toContain(key);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it('supports OpenAI with separate completion-token / reasoning parameters', async () => {
    const upstream = vi.fn().mockResolvedValue(success());
    const response = await handleAiRequest(request({ provider: 'openai', model: 'gpt-6-luna', input }), upstream);
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0], body = JSON.parse(init.body);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(body.max_completion_tokens).toBe(8192);
    expect(body.store).toBe(false);
    expect(body.max_tokens).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });
  it('requires a personal key, valid provider/model and same-origin JSON requests', async () => {
    const upstream = vi.fn();
    for (const req of [request(undefined, 'test', { Authorization: '' }),
      request(undefined, 'test', { Origin: 'https://evil.example' }),
      request(undefined, 'test', { 'Content-Type': 'text/plain' }),
      request({ provider: 'https://evil.example', model: 'x' }, 'test'),
      request({ provider: '__proto__', model: 'x' }, 'test'),
      request({ provider: 'deepseek', model: 'unsupported' }, 'test'),
      request({ provider: 'deepseek', model: 'deepseek-flash', input: { ...input, excitationNm: 0 } }),
    ]) expect((await handleAiRequest(req, upstream)).ok).toBe(false);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('never exposes provider errors or falls back to another key; maps authentication, credit and rate errors', async () => {
    for (const [status, expected] of [[401, 401], [402, 402], [429, 429], [500, 502]]) {
      const upstream = vi.fn().mockResolvedValue(new Response(`secret: ${key}`, { status }));
      const response = await handleAiRequest(request(), upstream);
      expect(response.status).toBe(expected);
      expect(await response.text()).not.toContain(key);
      expect(upstream).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects empty, malformed, hallucinated and truncated model output', async () => {
    for (const [content, finish] of [['', 'stop'], ['bad json', 'stop'], [suggestion, 'length'],
      [{ summary: 'test', regions: [{ ...suggestion.regions[0], spectrumId: 'fake' }] }, 'stop']]) {
      const upstream = vi.fn().mockResolvedValue(success(content, String(finish)));
      expect((await handleAiRequest(request(), upstream)).status).toBe(502);
    }
  });
  it('bounds request and response bytes, including streams without Content-Length', async () => {
    const oversized = new Request('https://lab.example/api/ai/test', { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: 'x'.repeat(900001) });
    const upstream = vi.fn();
    expect((await handleAiRequest(oversized, upstream)).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
    const largeResponse = vi.fn().mockResolvedValue(new Response('x'.repeat(100001)));
    expect((await handleAiRequest(request(), largeResponse)).status).toBe(413);
  });
  it('times out without retrying a paid request', async () => {
    vi.useFakeTimers();
    const upstream = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('abort')));
    }));
    const result = handleAiRequest(request(), upstream as typeof fetch);
    await vi.advanceTimersByTimeAsync(55001);
    expect((await result).status).toBe(504);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('connection test sends no spectra and validates a complete response', async () => {
    const upstream = vi.fn().mockResolvedValue(success({ ok: true }));
    const response = await handleAiRequest(request({ provider: 'deepseek', model: 'deepseek-flash' }, 'test'), upstream);
    expect((await response.json()).ok).toBe(true);
    expect(upstream.mock.calls[0][1].body).not.toContain('s1');
  });
  it('uses redirect settings accepted by Workers for both test and analysis requests', async () => {
    for (const path of ['test', 'analyze']) {
      const upstream = vi.fn(async (_url, init) => {
        if (init.redirect === 'error') throw new TypeError('Invalid redirect value, must be follow or manual');
        expect(init.redirect).toBe('manual');
        return success(path === 'test' ? { ok: true } : suggestion);
      });
      const response = await handleAiRequest(request(undefined, path), upstream as typeof fetch);
      expect(response.status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects every redirect response without sending a second request or leaking Location', async () => {
    for (const status of [300, 301, 302, 303, 304, 307, 308, 399]) {
      const upstream = vi.fn().mockResolvedValue(new Response(null, {
        status, headers: { Location: `https://untrusted.example/?key=${key}` },
      }));
      const response = await handleAiRequest(request(), upstream);
      expect(response.status).toBe(502);
      const body = await response.text();
      expect(body).toContain('重定向');
      expect(body).not.toContain(key);
      expect(body).not.toContain('untrusted');
      expect(upstream).toHaveBeenCalledTimes(1);
    }
  });
  it('distinguishes upstream transport failures from non-JSON responses without exposing details', async () => {
    const failedFetch = vi.fn().mockRejectedValue(new Error(`private details ${key}`));
    const network = await handleAiRequest(request(), failedFetch);
    expect(await network.text()).toContain('后端服务器的出站网络');
    const notJson = vi.fn().mockResolvedValue(new Response(`<html>${key}</html>`));
    const malformed = await handleAiRequest(request(), notJson);
    const text = await malformed.text();
    expect(text).toContain('不是有效 JSON');
    expect(text).not.toContain(key);
  });
  it('routes API errors through the worker and leaves static assets with ASSETS', async () => {
    const assets = { fetch: vi.fn().mockResolvedValue(new Response('static')) };
    expect(await (await worker.fetch(new Request('https://lab.example/'), { ASSETS: assets })).text()).toBe('static');
    const api = await worker.fetch(new Request('https://lab.example/api/missing'), { ASSETS: assets });
    expect(api.status).toBe(404);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
  });
});
