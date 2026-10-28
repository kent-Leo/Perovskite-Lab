import {
  MAX_AI_BYTES, validateAnalysis, validateSuggestion,
  type AiProvider, type AnalysisInput, type AiSuggestion,
} from '../../shared/ai-contract-2026.10.24';
export interface AiCredentials { provider: AiProvider; model: string; apiKey: string }
export async function requestAi(
  credentials: AiCredentials, input: AnalysisInput | null, signal: AbortSignal,
): Promise<AiSuggestion | null> {
  if (!credentials.apiKey.trim()) throw new Error('请先填写自己的 API Key');
  const canonical = input ? validateAnalysis(input) : null;
  const body = JSON.stringify({ provider: credentials.provider, model: credentials.model,
    ...(canonical ? { input: canonical } : {}) });
  if (new TextEncoder().encode(body).length > MAX_AI_BYTES) throw new Error('数据量过大，请减少选中的光谱');
  const response = await fetch(canonical ? '/api/ai/analyze' : '/api/ai/test', {
    method: 'POST', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.apiKey.trim()}` },
    body,
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('AI 后端未就绪。请使用项目的 Vite 服务，或部署包含 Worker 的版本'); }
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'AI 请求失败');
  if (!canonical) {
    if (result.ok !== true) throw new Error('连接测试返回无效');
    return null;
  }
  return validateSuggestion(result, canonical.spectra);
}
