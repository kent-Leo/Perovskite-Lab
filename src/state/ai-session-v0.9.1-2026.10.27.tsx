import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AI_PROVIDERS, type AiProvider } from '../../shared/ai-contract-v0.9.1-2026.10.27';
import type { AiCredentials } from '../services/ai-client-v0.9.1-2026.10.27';
import { redactChatSecrets } from '../../shared/ai-chat-v0.9.1-2026.10.27';
export const AI_STORAGE_KEY = 'perovskite-lab-ai-credentials-v1';
interface AiSettings {
  version: 1;
  provider: AiProvider;
  accounts: Record<AiProvider, { model: string; apiKey: string }>;
}
const providerIds = Object.keys(AI_PROVIDERS) as AiProvider[];
const defaults = (): AiSettings => ({ version: 1, provider: 'deepseek', accounts: {
  deepseek: { model: AI_PROVIDERS.deepseek.models[0], apiKey: '' },
  openai: { model: AI_PROVIDERS.openai.models[0], apiKey: '' },
} });
function decode(raw: string | null): AiSettings {
  const settings = defaults();
  if (raw === null) return settings;
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || value.version !== 1 || !value.accounts || typeof value.accounts !== 'object')
    throw new Error('Invalid saved AI settings');
  if (providerIds.includes(value.provider)) settings.provider = value.provider;
  for (const id of providerIds) {
    const entry = value.accounts[id];
    if (!entry || typeof entry !== 'object') continue;
    const models: readonly string[] = AI_PROVIDERS[id].models;
    if (models.includes(entry.model)) settings.accounts[id].model = entry.model;
    if (typeof entry.apiKey === 'string' && entry.apiKey.length <= 512)
      settings.accounts[id].apiKey = entry.apiKey;
  }
  return settings;
}
function load() {
  try { return { settings: decode(localStorage.getItem(AI_STORAGE_KEY)), error: '' }; }
  catch { return { settings: defaults(), error: '无法读取已保存的 AI 设置，请重新填写；浏览器可能限制了本地存储。' }; }
}
function withoutKeys(settings: AiSettings): AiSettings {
  return { ...settings, accounts: Object.fromEntries(providerIds.map((id) =>
    [id, { ...settings.accounts[id], apiKey: '' }])) as AiSettings['accounts'] };
}
const Context = createContext<{
  credentials: AiCredentials;
  setKey: (key: string) => void;
  setProvider: (provider: AiProvider) => void;
  setModel: (model: string) => void;
  clearKey: () => void;
  clearAllKeys: () => void;
  storageError: string;
  redactSecrets: (text: string) => string;
} | null>(null);
/** Dedicated local storage, separate from workspace/backup/export serialization. No server persistence. */
export function AiSessionProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(load);
  const [settings, set] = useState(initial.settings), current = useRef(initial.settings);
  const [storageError, setStorageError] = useState(initial.error);
  function commit(next: AiSettings, clearing = false) {
    current.current = next;
    set(next);
    try {
      localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(next));
      setStorageError('');
    } catch {
      if (clearing) {
        // Removing the dedicated record is a fallback if even a smaller replacement cannot be saved.
        try {
          localStorage.removeItem(AI_STORAGE_KEY);
          const cleared = withoutKeys(next);
          current.current = cleared; set(cleared);
          setStorageError('浏览器无法更新设置，已清除本机保存的全部密钥。');
          return;
        } catch { /* Report failure without exposing credential values. */ }
      }
      setStorageError(clearing
        ? '浏览器阻止了密钥删除；请通过浏览器清除此网站的数据，以免重新打开后恢复旧密钥。'
        : '密钥暂时仅在当前页面可用：浏览器无法保存设置，请检查网站存储权限或可用空间。');
    }
  }
  function setAccount(patch: Partial<AiSettings['accounts'][AiProvider]>, clearing = false) {
    const saved = current.current, id = saved.provider;
    commit({ ...saved, accounts: { ...saved.accounts, [id]: { ...saved.accounts[id], ...patch } } }, clearing);
  }
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== AI_STORAGE_KEY && event.key !== null)) return;
      try {
        const next = decode(event.key === null ? null : event.newValue);
        current.current = next; set(next); setStorageError('');
      } catch { setStorageError('另一页面的 AI 设置无法读取，请检查或重新填写。'); }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const credentials: AiCredentials = { provider: settings.provider, ...settings.accounts[settings.provider] };
  return <Context.Provider value={{ credentials, storageError,
    redactSecrets: (text) => redactChatSecrets(text, providerIds.map((id) => current.current.accounts[id].apiKey)),
    setKey: (apiKey) => setAccount({ apiKey }),
    // Each provider has its own key/model. Switching never borrows another provider's key.
    setProvider: (provider) => commit({ ...current.current, provider }),
    setModel: (model) => setAccount({ model }),
    clearKey: () => setAccount({ apiKey: '' }, true),
    clearAllKeys: () => commit(withoutKeys(current.current), true),
  }}>{children}</Context.Provider>;
}
export function useAiSession() {
  const value = useContext(Context);
  if (!value) throw new Error('AI 会话未初始化');
  return value;
}
