import { handleAiRequest } from '../server/ai-handler-2026.10.24';
interface Env { ASSETS: { fetch(request: Request): Promise<Response> } }
export default {
  fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleAiRequest(request);
    return env.ASSETS.fetch(request);
  },
};
