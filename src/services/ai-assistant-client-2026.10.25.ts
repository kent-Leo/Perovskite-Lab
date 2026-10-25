import {
  MAX_AI_BYTES,
} from '../../shared/ai-contract-2026.10.24';
import {
  validateAssistantAnalysis,
  validateAssistantSuggestion,
  type AssistantAnalysisInput,
  type AssistantSuggestion,
} from '../../shared/ai-assistant-2026.10.25';
import type { AiCredentials } from './ai-client-2026.10.24';

/** Sends only canonical, validated data to the same-origin Worker relay. */
export async function requestAssistantAi(
  credentials: AiCredentials,
  input: AssistantAnalysisInput,
  signal: AbortSignal,
): Promise<AssistantSuggestion> {
  if (!credentials.apiKey.trim()) throw new Error('请先填写自己的 API Key');
  const canonical = validateAssistantAnalysis(input);
  const body = JSON.stringify({
    provider: credentials.provider,
    model: credentials.model,
    input: canonical,
  });
  if (new TextEncoder().encode(body).length > MAX_AI_BYTES)
    throw new Error('数据量过大，无法发送给 AI；请缩小分析区间或减少异常记录');
  const response = await fetch('/api/ai/assistant', {
    method: 'POST',
    cache: 'no-store',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.apiKey}` },
    body,
  });
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error('AI 后端未就绪。请使用项目的 Vite 服务，或部署包含 Worker 的版本');
  }
  if (!response.ok)
    throw new Error(
      result && typeof result === 'object' && typeof (result as { error?: unknown }).error === 'string'
        ? (result as { error: string }).error
        : 'AI 请求失败',
    );
  return validateAssistantSuggestion(result, canonical);
}
