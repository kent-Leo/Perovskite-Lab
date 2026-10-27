import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAiRequest } from './ai-handler-v0.9.1-2026.10.27';
import { MAX_AI_BYTES } from '../shared/ai-contract-v0.9.1-2026.10.27';

/** Same relay in Vite dev/preview and production, no separate local credentials file. */
export function aiRelayPlugin(): Plugin {
  function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
    if (!req.url?.startsWith('/api/')) { next(); return; }
    void (async () => {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX_AI_BYTES) {
          res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: '请求过大，请减少光谱数量' }));
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const controller = new AbortController();
      const cancel = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', cancel);
      try {
        const request = new Request(new URL(req.url!, `http://${req.headers.host || 'localhost'}`), {
          method: req.method, headers, signal: controller.signal,
          ...(!['GET', 'HEAD'].includes(req.method ?? '') ? { body: Buffer.concat(chunks) } : {}),
        });
        const response = await handleAiRequest(request);
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(Buffer.from(await response.arrayBuffer()));
      } finally { res.off('close', cancel); }
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: '本地 AI 接口处理失败' }));
    });
  }
  return {
    name: 'lab-byok-ai',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
