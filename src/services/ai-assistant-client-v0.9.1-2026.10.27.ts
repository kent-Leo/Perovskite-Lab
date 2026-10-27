import {
  MAX_AI_BYTES,
} from '../../shared/ai-contract-v0.9.1-2026.10.27';
import {
  validateAssistantAnalysis,
  validateAssistantSuggestion,
  type AssistantAnalysisInput,
  type AssistantSuggestion,
} from '../../shared/ai-assistant-v0.9.1-2026.10.27';
import type { AiCredentials } from './ai-client-v0.9.1-2026.10.27';
import { redactChatSecrets, validateChatInput, validateChatReply, type ChatInput, type ChatReply } from '../../shared/ai-chat-v0.9.1-2026.10.27';

export async function requestAssistantChat(
  credentials: AiCredentials, input: ChatInput, signal: AbortSignal,
): Promise<ChatReply> {
  if (!credentials.apiKey.trim()) throw new Error('请先在 AI 设置中填写个人 API Key');
  // Redact pasted credentials before validation or network serialization.
  const canonical = validateChatInput(JSON.parse(redactChatSecrets(JSON.stringify(input), [credentials.apiKey])));
  const body = JSON.stringify({ provider: credentials.provider, model: credentials.model, input: canonical });
  if (new TextEncoder().encode(body).length > MAX_AI_BYTES) throw new Error('聊天上下文过大，请清除部分历史后重试');
  let response: Response;
  try {
    response = await fetch('/api/ai/chat', { method: 'POST', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.apiKey}` }, body });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('网络连接失败，请检查网络后重试');
  }
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new Error('聊天后端未就绪或返回了无效响应，请检查 Worker 部署'); }
  if (!response.ok) throw new Error(result && typeof result === 'object' && typeof (result as { error?: unknown }).error === 'string'
    ? redactChatSecrets((result as { error: string }).error, [credentials.apiKey]) : `AI 请求失败（HTTP ${response.status}）`);
  // Provider/model envelope is metadata, not an operation field.
  const envelope = result as Record<string, unknown>;
  return validateChatReply(JSON.parse(redactChatSecrets(JSON.stringify({ reply: envelope.reply, operation: envelope.operation }), [credentials.apiKey])), canonical.context);
}

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
