import { handleAiRequest } from '../server/ai-handler-v0.9.1-2026.10.27';
interface Env { ASSETS: { fetch(request: Request): Promise<Response> } }
export default {
  fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleAiRequest(request);
    return env.ASSETS.fetch(request);
  },
};
