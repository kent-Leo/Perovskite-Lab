import { useRef, useState } from 'react';
import { KeyRound, Sparkles, X } from 'lucide-react';
import { AI_PROVIDERS, type AiProvider } from '../../shared/ai-contract-v0.9.1-2026.10.27';
import { useAiSession } from '../state/ai-session-v0.9.1-2026.10.27';
import { requestAi } from '../services/ai-client-v0.9.1-2026.10.27';
import { ErrorNote, Field } from './ui';

/**
 * Provider/model/key settings shared by the assistant page. Keys remain in the
 * dedicated local AI session storage and are never written to spectra, Excel,
 * workspace backups or logs.
 */
export function AssistantAiSettings({
  consent,
  onConsentChange,
}: {
  consent: boolean;
  onConsentChange: (value: boolean) => void;
}) {
  const { credentials, setProvider, setModel, setKey, clearKey, clearAllKeys, storageError } =
    useAiSession();
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const provider = AI_PROVIDERS[credentials.provider];
  async function test() {
    setError('');
    setStatus('');
    const current = new AbortController();
    controller.current?.abort();
    controller.current = current;
    const timer = setTimeout(() => current.abort(), 60000);
    try {
      if (!consent) throw new Error('请先勾选数据发送与个人账户计费说明');
      setBusy(true);
      await requestAi(credentials, null, current.signal);
      setStatus('连接成功，可以使用当前密钥和模型进行多轮问答与异常分类');
    } catch (e) {
      setError(current.signal.aborted ? '请求超时或已取消，可按需重试' : (e as Error).message);
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }
  return (
    <details className="assistant-ai-settings">
      <summary>
        <KeyRound size={16} /> AI 服务商与连接
      </summary>
      <div className="assistant-form-grid assistant-ai-grid">
        <Field label="AI 服务商">
          <select
            value={credentials.provider}
            onChange={(e) => {
              setProvider(e.target.value as AiProvider);
              onConsentChange(false);
            }}
          >
            {Object.entries(AI_PROVIDERS).map(([id, item]) => (
              <option key={id} value={id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="AI 模型">
          <select value={credentials.model} onChange={(e) => setModel(e.target.value)}>
            {provider.models.map((model) => (
              <option key={model}>{model}</option>
            ))}
          </select>
        </Field>
        <Field
          label="个人 API Key"
          hint="仅保存在当前浏览器的专用 AI 设置中（本地明文），不会写入光谱、Excel、工作区备份或日志。"
        >
          <input
            type={showKey ? 'text' : 'password'}
            value={credentials.apiKey}
            autoComplete="off"
            spellCheck={false}
            maxLength={512}
            onChange={(e) => setKey(e.target.value)}
            placeholder="输入该服务商的 API Key"
          />
        </Field>
      </div>
      <div className="assistant-actions">
        <label className="check-line">
          <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} />
          显示密钥
        </label>
        <button className="small-button" onClick={() => { clearKey(); setShowKey(false); }}>
          清除密钥
        </button>
        <button className="small-button" onClick={() => { clearAllKeys(); setShowKey(false); }}>
          清除全部服务商密钥
        </button>
        <button
          className="small-button"
          disabled={busy || !credentials.apiKey || !consent}
          onClick={() => void test()}
        >
          <Sparkles size={14} /> 测试 AI 连接（可能计费）
        </button>
        {busy && (
          <button className="small-button" onClick={() => controller.current?.abort()}>
            <X size={14} /> 取消
          </button>
        )}
      </div>
      {storageError && <ErrorNote>{storageError}</ErrorNote>}
      {status && <p className="assistant-note" role="status">{status}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <label className="assistant-consent">
        <input type="checkbox" checked={consent} onChange={(e) => onConsentChange(e.target.checked)} />
        <span>
          我同意：发送消息或重新生成回复时，将问题、最近的有界对话历史、当前文件名称、光谱指标、处理参数和选取的原始测量点发送给{' '}
          {provider.name}；点击“AI 辅助分类”会发送当前光谱及异常摘要。密钥经本站后端临时转发，服务器不保存密钥。
          AI 仅返回文字与待确认参数建议；所有数值处理由本地算法执行，费用由我的 API 账户承担。
        </span>
      </label>
    </details>
  );
}
