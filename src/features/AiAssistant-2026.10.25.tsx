import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Download,
  FileText,
  Layers3,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useWorkspace } from '../state/workspace';
import { useAiSession } from '../state/ai-session-2026.10.24';
import { AssistantAiSettings } from '../components/AssistantAiSettings-2026.10.25';
import {
  AssistantSpectrumChart,
  type AssistantChartView,
} from '../components/AssistantSpectrumChart-2026.10.25';
import { AssistantRecords } from '../components/AssistantRecords-2026.10.25';
import { ErrorNote, Field, Metric } from '../components/ui';
import { fmt, numeric } from '../domain/math';
import {
  DEFAULT_ASSISTANT_PARAMETERS,
  SENSITIVITY_THRESHOLD,
  assistantProcessingKey,
  describeAssistantResult,
  processAssistantSpectrum,
  type AssistantParameters,
  type AssistantProcessInput,
  type AssistantProcessingResult,
  type AssistantSensitivity,
} from '../domain/assistant-processing-2026.10.25';
import { resolveAssistantScanRange, type ScanRangeDraft } from '../domain/assistant-scan-range-2026.10.26';
import { interpretAssistantCommand } from '../domain/assistant-command-2026.10.25';
import {
  delimiterLabel,
  parseSpectrumBytes,
  type ParsedSpectrumFile,
  type SpectrumDelimiter,
  type SpectrumEncoding,
  type SpectrumParseOptions,
} from '../services/f7100-2026.10.25';
import { requestAssistantAi, requestAssistantChat } from '../services/ai-assistant-client-2026.10.25';
import { previewBatchEdit, commitBatchEdit, undoBatchEdit, replayBatchEdits, type BatchDocument, type BatchPreview } from '../domain/assistant-batch-edit';
import { buildChatContext } from '../domain/assistant-context-2026.10.25';
import { CHAT_LIMITS, recentChatHistory, validateChatReply, type ChatOperation } from '../../shared/ai-chat-2026.10.25';
import {
  exportAssistantWorkbook,
  exportAssistantBatchWorkbook,
  type AssistantAudit,
} from '../services/assistant-export-2026.10.25';
import {
  baseAiSheetName,
  syncAssistantResult,
} from '../services/assistant-sheet-2026.10.25';
import type { AssistantAnalysisInput } from '../../shared/ai-assistant-2026.10.25';
import type { AiProvider } from '../../shared/ai-contract-2026.10.24';
import { dateStamp } from '../services/download';
import './AiAssistant-2026.10.25.css';

interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  at: string;
  source: 'local' | 'model';
  operation?: ChatOperation | null;
  applied?: boolean;
  model?: string;
}
interface ParseOptionsState {
  encoding: SpectrumEncoding;
  delimiter: SpectrumDelimiter;
  dataStartLine: string;
  wavelengthColumn: string;
  intensityColumn: string;
}
interface ConfirmedSnapshot {
  key: string;
  result: AssistantProcessingResult;
  at: string;
}
interface SyncRecord {
  shared?: boolean;
  key: string;
  sheetId: string;
  sheetName: string;
  version: number;
  at: string;
}
interface AiState {
  provider: AiProvider;
  model: string;
  summary: string;
  notes: { id: string; classification: string; confidence: string; note: string }[];
  recommendations: string[];
}
interface AssistantEntry {
  scanRangeDraft: ScanRangeDraft | null;
  epoch: number;
  manualRevision: { base: string; version: string } | null;
  id: string;
  file: File;
  bytes: Uint8Array;
  parse: ParsedSpectrumFile | null;
  parseError: string;
  parseOptions: ParseOptionsState;
  parameters: AssistantParameters;
  excitation: string;
  solvent: string;
  blankId: string;
  subtractBlank: boolean;
  blankSameConditions: boolean;
  result: AssistantProcessingResult | null;
  resultKey: string;
  processError: string;
  confirmed: ConfirmedSnapshot | null;
  messages: ChatMessage[];
  view: AssistantChartView;
  ai: AiState | null;
  aiError: string;
  aiBusy: boolean;
  exporting: boolean;
  syncing: boolean;
  sync: SyncRecord | null;
  actionError: string;
}

const defaultParseOptions = (): ParseOptionsState => ({
  encoding: 'auto',
  delimiter: 'auto',
  dataStartLine: '',
  wavelengthColumn: '',
  intensityColumn: '',
});
const timestamp = () =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
const chatMessage = (role: ChatMessage['role'], text: string, source: ChatMessage['source'] = 'local'): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  text,
  at: timestamp(),
  source,
});
const formatLabel = (parsed: ParsedSpectrumFile) =>
  parsed.format === 'f7100-emission' ? 'F-7100 单次发射光谱' : '通用文本光谱表';
const encodingLabel = (encoding: SpectrumEncoding) =>
  ({
    auto: '自动识别',
    'utf-8': 'UTF-8',
    gb18030: 'GB18030 / GBK',
    shift_jis: 'Shift-JIS',
    'utf-16le': 'UTF-16 LE',
    'utf-16be': 'UTF-16 BE',
    'windows-1252': 'Windows-1252',
  } satisfies Record<SpectrumEncoding, string>)[encoding];

function parseOptions(entry: AssistantEntry): SpectrumParseOptions {
  const options: SpectrumParseOptions = {
    encoding: entry.parseOptions.encoding,
    delimiter: entry.parseOptions.delimiter,
  };
  const number = (text: string) => (text.trim() ? Number(text) : undefined);
  const dataStartLine = number(entry.parseOptions.dataStartLine);
  const wavelengthColumn = number(entry.parseOptions.wavelengthColumn);
  const intensityColumn = number(entry.parseOptions.intensityColumn);
  if (dataStartLine !== undefined) options.dataStartLine = dataStartLine;
  if (wavelengthColumn !== undefined) options.wavelengthColumn = wavelengthColumn;
  if (intensityColumn !== undefined) options.intensityColumn = intensityColumn;
  return options;
}

function selectedBlank(entry: AssistantEntry, entries: AssistantEntry[]) {
  if (!entry.blankId || entry.blankId === entry.id) return null;
  return entries.find((candidate) => candidate.id === entry.blankId && candidate.parse) ?? null;
}

function buildInput(entry: AssistantEntry, entries: AssistantEntry[]): AssistantProcessInput | null {
  if (!entry.parse) return null;
  const custom = entry.excitation.trim();
  const excitation = custom ? numeric(entry.excitation) : entry.parse.metadata.excitationNm;
  if (custom && (excitation === null || excitation <= 0))
    throw new Error('激发波长必须为大于 0 的有效数字，留空则使用文件元数据');
  const blank = selectedBlank(entry, entries);
  return {
    points: entry.parse.points,
    scanRange: resolveAssistantScanRange(entry.parse.points, entry.scanRangeDraft),
    rowNumbers: entry.parse.rowNumbers,
    excitationNm: excitation,
    solvent: entry.solvent,
    slitNm: entry.parse.metadata.emSlitNm,
    blank: blank?.parse
      ? { name: blank.parse.metadata.sample || blank.file.name, points: blank.parse.points }
      : null,
    subtractBlank: entry.subtractBlank,
    blankSameConditions: entry.blankSameConditions,
    parameters: entry.parameters,
  };
}

function baseEntryKey(entry: AssistantEntry, entries: AssistantEntry[]) {
  const input = buildInput(entry, entries);
  return input ? `${assistantProcessingKey(input, entry.parse?.rowNumbers ?? [])}-${entry.epoch}` : '';
}
function entryKey(entry: AssistantEntry, entries: AssistantEntry[]) {
  const base = baseEntryKey(entry, entries);
  return entry.manualRevision ? entry.manualRevision.base === base ? entry.manualRevision.version
    : `${base}-${entry.manualRevision.version}` : base;
}
function batchDocument(entry: AssistantEntry, entries: AssistantEntry[]): BatchDocument {
  if (!entry.parse || !entry.result || entryKey(entry, entries) !== entry.resultKey)
    throw new Error(`${entry.file.name}：请先重新生成有效预览`);
  return { id: entry.id, name: entry.file.name, version: entry.resultKey, result: entry.result };
}

function computeEntry(entry: AssistantEntry, entries: AssistantEntry[]) {
  try {
    const input = buildInput(entry, entries);
    if (!input) return { result: null, resultKey: '', processError: '', manualRevision: null };
    const result = processAssistantSpectrum(input);
    if (entry.result?.editPlans?.length) {
      const base = baseEntryKey(entry, entries);
      const replayed = replayBatchEdits({ id: entry.id, name: entry.file.name, version: base, result }, entry.result);
      return { result: replayed.result, resultKey: replayed.version, processError: '', manualRevision: { base, version: replayed.version } };
    }
    return {
      result,
      resultKey: baseEntryKey(entry, entries),
      manualRevision: null,
      processError: '',
    };
  } catch (e) {
    // Preserve the last full snapshot and its audit when a new baseline/replay fails.
    return { result: entry.result, resultKey: entry.resultKey, processError: (e as Error).message, manualRevision: entry.manualRevision };
  }
}

function initialMessage(entry: AssistantEntry) {
  if (!entry.parse)
    return `无法解析 ${entry.file.name}。${entry.parseError} 可以在“检查/修正识别结果”中选择编码、分隔符、首个数据行和列后重试。`;
  const metadata = entry.parse.metadata;
  const intro = `已识别 ${formatLabel(entry.parse)}：${entry.parse.fileName}。激发波长 ${metadata.excitationNm ?? '未识别'} nm，扫描范围 ${entry.parse.points[0].x}–${entry.parse.points.at(-1)!.x} nm，共 ${entry.parse.points.length} 个数据点。`;
  if (entry.processError) return `${intro}\n自动处理未生成：${entry.processError}`;
  const resultText = entry.result ? describeAssistantResult(entry.result) : '';
  const warning = entry.parse.warnings.length ? `\n解析提醒：${entry.parse.warnings.join('；')}` : '';
  return `${intro}\n${resultText}${warning}`;
}

async function createEntry(file: File): Promise<AssistantEntry> {
  if (file.size > 20 * 1024 * 1024)
    throw new Error(`${file.name} 超过 20 MB，请拆分后处理`);
  if (!/\.(txt|csv|tsv)$/i.test(file.name))
    throw new Error(`${file.name}：请上传 F-7100 TXT、CSV 或 TSV 文本光谱`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base: AssistantEntry = {
    id: crypto.randomUUID(),
    epoch: 0, manualRevision: null, scanRangeDraft: null,
    file,
    bytes,
    parse: null,
    parseError: '',
    parseOptions: defaultParseOptions(),
    parameters: { ...DEFAULT_ASSISTANT_PARAMETERS },
    excitation: '',
    solvent: '',
    blankId: '',
    subtractBlank: false,
    blankSameConditions: false,
    result: null,
    resultKey: '',
    processError: '',
    confirmed: null,
    messages: [],
    view: 'compare',
    ai: null,
    aiError: '',
    aiBusy: false,
    exporting: false,
    syncing: false,
    sync: null,
    actionError: '',
  };
  try {
    const parsed = parseSpectrumBytes(bytes, file.name, {});
    const withParse: AssistantEntry = {
      ...base,
      parse: parsed,
      excitation: parsed.metadata.excitationNm?.toString() ?? '',
    };
    const computed = computeEntry(withParse, [withParse]);
    const entry = { ...withParse, ...computed };
    return { ...entry, messages: [chatMessage('assistant', initialMessage(entry))] };
  } catch (e) {
    const entry = { ...base, parseError: (e as Error).message };
    return { ...entry, messages: [chatMessage('assistant', initialMessage(entry))] };
  }
}

function describeBatchEdit(edit: import('../../shared/ai-chat-2026.10.25').BatchEdit) {
  const labels = { 'delete-range': '删除数据行', 'mask-range': '屏蔽强度', 'keep-range': '仅保留区间',
    'set-point': '指定处理后强度', offset: '强度偏移', scale: '强度缩放', normalize: '最大绝对值归一化' };
  const range = edit.type === 'set-point' ? `${edit.wavelengthNm} nm` : `${edit.fromNm}–${edit.toNm} nm（闭区间）`;
  const value = 'value' in edit ? `，数值 ${edit.value}` : 'target' in edit ? `，目标 ${edit.target}` : '';
  return `${labels[edit.type]}：${range}${value}。理由：${edit.reason}`;
}

function classificationLabel(value: string) {
  return (
    {
      spike: '孤立尖峰',
      scattering: '散射干扰',
      'real-peak': '真实荧光峰',
      uncertain: '不确定',
    } as Record<string, string>
  )[value] ?? value;
}
function confidenceLabel(value: string) {
  return ({ low: '低', medium: '中', high: '高' } as Record<string, string>)[value] ?? value;
}
function annotateResult(result: AssistantProcessingResult, ai: AiState): AssistantProcessingResult {
  if (!ai.notes.length) return result;
  const noteMap = new Map(ai.notes.map((note) => [note.id, note]));
  return {
    ...result,
    anomalies: result.anomalies.map((anomaly) => {
      const note = noteMap.get(anomaly.id);
      return note
        ? {
            ...anomaly,
            aiNote: `${classificationLabel(note.classification)} · 置信度 ${confidenceLabel(note.confidence)}：${note.note}`,
          }
        : anomaly;
    }),
  };
}

export function AiAssistant({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const { w, update, notify } = useWorkspace();
  const { credentials, redactSecrets } = useAiSession();
  const [entries, setEntries] = useState<AssistantEntry[]>([]);
  const [activeId, setActiveId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchPreview, setBatchPreview] = useState<BatchPreview | null>(null);
  const [batchTransaction, setBatchTransaction] = useState<BatchPreview | null>(null);
  const [redoPlan, setRedoPlan] = useState<BatchPreview['plan'] | null>(null);
  const [batchError, setBatchError] = useState('');
  const [batchConfirmed, setBatchConfirmed] = useState(false);
  const [allowProtected, setAllowProtected] = useState(false);
  const [batchExporting, setBatchExporting] = useState(false);

  const [consent, setConsent] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [sheetImportMode, setSheetImportMode] = useState<'separate' | 'combined'>('separate');
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [generalMessages, setGeneralMessages] = useState<ChatMessage[]>([]);
  const [chatStatus, setChatStatus] = useState<Record<string, { busy: boolean; error: string }>>({});
  const latestEntries = useRef(entries); latestEntries.current = entries;
  const latestSelection = useRef(selectedIds); latestSelection.current = selectedIds;
  const chatRequests = useRef(new Map<string, AbortController>());
  const chatLog = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const aiController = useRef<AbortController | null>(null);
  const syncLocks = useRef(new Set<string>());
  const active = entries.find((entry) => entry.id === activeId) ?? entries[0] ?? null;
  const chatId = active?.id ?? 'general';
  const chatDraft = chatDrafts[chatId] ?? '';
  const setChatDraft = (text: string) => setChatDrafts((previous) => ({ ...previous, [chatId]: text }));
  const messages = active?.messages ?? generalMessages;
  const chatBusy = chatStatus[chatId]?.busy ?? false;
  const chatError = chatStatus[chatId]?.error ?? '';
  const blankEntry = active ? selectedBlank(active, entries) : null;
  const draftKey = useMemo(() => {
    if (!active?.parse) return '';
    try {
      return entryKey(active, entries);
    } catch {
      return '';
    }
  }, [active, entries]);
  let scanRangeError = '';
  let scanRangeCount = active?.parse?.points.length ?? 0;
  if (active?.parse) {
    try {
      const range = resolveAssistantScanRange(active.parse.points, active.scanRangeDraft);
      if (range) scanRangeCount = active.parse.points.filter(p => p.x >= range.fromNm && p.x <= range.toNm).length;
    } catch (e) { scanRangeError = (e as Error).message; }
  }
  const stale = !!active?.result && active.resultKey !== draftKey;
  const confirmed =
    active?.confirmed &&
    active.confirmed.key === active.resultKey &&
    active.confirmed.key === draftKey
      ? active.confirmed
      : null;
  const canConfirm =
    !!active?.result && !stale && !active.result.checks.some((check) => check.status === 'fail');
  const syncedCurrent = !!active?.sync && !!confirmed && active.sync.key === confirmed.key;

  useEffect(() => {
    if (!active?.confirmed) return;
    if (active.confirmed.key !== draftKey)
      setEntries((previous) =>
        previous.map((entry) =>
          entry.id === active.id ? { ...entry, confirmed: null } : entry,
        ),
      );
  }, [draftKey, active?.id, active?.confirmed?.key]);

  useEffect(
    () => () => {
      aiController.current?.abort();
      for (const controller of chatRequests.current.values()) controller.abort();
      chatRequests.current.clear();
    },
    [],
  );

  useEffect(() => {
    chatLog.current?.scrollTo({ top: chatLog.current.scrollHeight, behavior: 'smooth' });
  }, [chatId, messages.length, chatBusy]);

  const patchEntry = (
    id: string,
    patch: Partial<AssistantEntry> | ((entry: AssistantEntry) => Partial<AssistantEntry>),
  ) => {
    setEntries((previous) =>
      previous.map((entry) =>
        entry.id === id
          ? (() => {
              const change = typeof patch === 'function' ? patch(entry) : patch;
              const dirty = ['parameters', 'excitation', 'solvent', 'blankId', 'subtractBlank', 'blankSameConditions', 'scanRangeDraft'].some(k => k in change);
              return { ...entry, ...change, ...(dirty && !('resultKey' in change) ? { epoch: entry.epoch + 1, confirmed: null } : {}) };
            })()
          : entry,
      ),
    );
  };
  const patchParameters = (patch: Partial<AssistantParameters>) => {
    if (!active) return;
    patchEntry(active.id, (entry) => ({
      parameters: { ...entry.parameters, ...patch },
      confirmed: null,
      actionError: '',
    }));
  };
  const recompute = (id: string, overrides: Partial<AssistantEntry> = {}) => {
    setEntries((previous) =>
      previous.map((entry) => {
        if (entry.id !== id) return entry;
        const updated = { ...entry, ...overrides, epoch: entry.epoch + 1 };
        const computed = computeEntry(
          updated,
          previous.map((candidate) => (candidate.id === id ? updated : candidate)),
        );
        const sameResult = computed.resultKey === entry.resultKey;
        const result =
          computed.result && sameResult && entry.ai
            ? annotateResult(computed.result, entry.ai)
            : computed.result;
        const keepConfirmed =
          updated.confirmed && computed.resultKey === updated.confirmed.key
            ? updated.confirmed
            : null;
        return {
          ...updated,
          ...computed,
          result,
          ai: sameResult ? entry.ai : null,
          confirmed: keepConfirmed,
          actionError: '',
        };
      }),
    );
  };

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setUploadError('');
    const room = Math.max(0, 20 - entries.length);
    if (!room) {
      setUploadError('同时最多保留 20 个已上传文件，请先移除不需要的光谱。');
      return;
    }
    const selected = files.slice(0, room);
    if (selected.length < files.length)
      setUploadError(`最多同时处理 20 个文件，已忽略后 ${files.length - selected.length} 个。`);
    setUploading(true);
    try {
      const created: AssistantEntry[] = [];
      for (const file of selected) {
        try {
          created.push(await createEntry(file));
        } catch (e) {
          setUploadError(`${file.name}：${(e as Error).message}`);
        }
      }
      setEntries((previous) => [...previous, ...created]);
      setSelectedIds(previous => [...previous, ...created.map(e => e.id)]);
      if (created[0]) setActiveId(created[0].id);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function reparse(id: string) {
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) return;
    try {
      const parsed = parseSpectrumBytes(entry.bytes, entry.file.name, parseOptions(entry));
      const updated: AssistantEntry = {
        ...entry,
        epoch: entry.epoch + 1,
        parse: parsed,
        parseError: '',
        excitation: entry.excitation.trim() || parsed.metadata.excitationNm?.toString() || '',
        confirmed: null,
        actionError: '',
      };
      const computed = computeEntry(
        updated,
        entries.map((candidate) => (candidate.id === id ? updated : candidate)),
      );
      const sameResult = computed.resultKey === entry.resultKey;
      const result =
        computed.result && sameResult && entry.ai
          ? annotateResult(computed.result, entry.ai)
          : computed.result;
      const next = {
        ...updated,
        ...computed,
        result,
        ai: sameResult ? entry.ai : null,
        sync: sameResult ? entry.sync : null,
      };
      setEntries((previous) =>
        previous.map((candidate) =>
          candidate.id === id
            ? {
                ...next,
                messages: [
                  ...candidate.messages,
                  chatMessage(
                    'assistant',
                    `已按手动设置重新解析：${parsed.points.length} 个点，数据起始行 ${parsed.dataStartLine}。${next.result ? describeAssistantResult(next.result) : next.processError}`,
                  ),
                ],
              }
            : candidate,
        ),
      );
    } catch (e) {
      setEntries((previous) =>
        previous.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                parseError: (e as Error).message,
                messages: [
                  ...candidate.messages,
                  chatMessage(
                    'assistant',
                    `重新解析失败：${(e as Error).message}${candidate.parse ? ' 已保留上一次成功解析的数据。' : ''}`,
                  ),
                ],
              }
            : candidate,
        ),
      );
    }
  }

  function removeEntry(id: string) {
    setSelectedIds(previous => previous.filter(v => v !== id));
    chatRequests.current.get(id)?.abort();
    chatRequests.current.delete(id);
    setChatDrafts((previous) => { const next = { ...previous }; delete next[id]; return next; });
    setChatStatus((previous) => { const next = { ...previous }; delete next[id]; return next; });
    const remaining = entries
      .filter((entry) => entry.id !== id)
      .map((entry) =>
        entry.blankId === id
          ? { ...entry, blankId: '', subtractBlank: false, blankSameConditions: false }
          : entry,
      );
    setEntries(remaining);
    if (activeId === id) setActiveId(remaining[0]?.id ?? '');
  }

  function addMessage(entryId: string, role: ChatMessage['role'], text: string) {
    setEntries((previous) =>
      previous.map((entry) =>
        entry.id === entryId
          ? { ...entry, messages: [...entry.messages, chatMessage(role, text)] }
          : entry,
      ),
    );
  }

  function buildAudit(entry: AssistantEntry, result: AssistantProcessingResult): AssistantAudit {
    return {
      fileName: entry.parse?.fileName ?? entry.file.name,
      sheetName: entry.sync?.sheetName ?? baseAiSheetName(entry.file.name),
      excitationNm:
        (entry.excitation.trim() ? numeric(entry.excitation) : entry.parse?.metadata.excitationNm) ??
        null,
      solvent: entry.solvent,
      ai: entry.ai
        ? {
            provider: entry.ai.provider,
            model: entry.ai.model,
            summary: entry.ai.summary,
            notes: entry.ai.notes.map(
              (note) =>
                `${note.id}｜${classificationLabel(note.classification)}｜置信度 ${confidenceLabel(note.confidence)}｜${note.note}`,
            ),
          }
        : null,
      userInstructions: entry.messages
        .filter((message) => message.role === 'user')
        .map((message) => redactSecrets(message.text))
        .slice(-50),
      exportedOn: dateStamp(),
    };
  }

  async function syncSnapshot(
    entry: AssistantEntry,
    snapshot: ConfirmedSnapshot,
    mode: 'auto' | 'update' | 'new-version',
  ) {
    if (!entry.parse || syncLocks.current.has(entry.id)) return false;
    syncLocks.current.add(entry.id);
    patchEntry(entry.id, { syncing: true, actionError: '' });
    try {
      const sameResult = entry.sync?.key === snapshot.key;
      const effectiveMode: 'create' | 'update' =
        mode === 'update' || (mode === 'auto' && sameResult) ? 'update' : 'create';
      if (effectiveMode === 'update' && !entry.sync) throw new Error('没有可更新的 AI Sheet，请先创建');
      const version =
        effectiveMode === 'create'
          ? (entry.sync?.version ?? 0) + 1
          : (entry.sync?.version ?? 1);
      const sheetName =
        effectiveMode === 'create'
          ? baseAiSheetName(entry.file.name, version)
          : entry.sync!.sheetName;
      const outcome = syncAssistantResult(
        w,
        {
          sourceId: entry.id,
          parsed: entry.parse,
          result: snapshot.result,
          audit: buildAudit(entry, snapshot.result),
          unit: w.calUnit,
          fallbackExcitation: w.excitation ?? '',
        },
        {
          mode: effectiveMode,
          targetSheetId: entry.sync?.sheetId,
          preserveOtherSeries: entry.sync?.shared,
          sheetName,
        },
      );
      update(outcome.patch);
      patchEntry(entry.id, {
        sync: {
          shared: effectiveMode === 'update' && entry.sync?.shared,
          key: snapshot.key,
          sheetId: outcome.sheetId,
          sheetName: outcome.sheetName,
          version,
          at: timestamp(),
        },
        actionError: '',
      });
      addMessage(
        entry.id,
        'assistant',
        `${outcome.created ? '已创建' : '已更新'} Sheet「${outcome.sheetName}」，仅写入处理后数据，按文件名标识光谱曲线。`,
      );
      notify(`已同步到 Sheet「${outcome.sheetName}」`);
      return true;
    } catch (e) {
      patchEntry(entry.id, { actionError: `同步失败：${(e as Error).message}` });
      return false;
    } finally {
      syncLocks.current.delete(entry.id);
      patchEntry(entry.id, { syncing: false });
    }
  }

  function confirmActive() {
    if (!active || !active.result || active.resultKey !== draftKey) return false;
    if (active.result.checks.some((check) => check.status === 'fail')) return false;
    const snapshot: ConfirmedSnapshot = {
      key: active.resultKey,
      result: active.result,
      at: dateStamp(),
    };
    patchEntry(active.id, { confirmed: snapshot, actionError: '' });
    if (autoSync) void syncSnapshot(active, snapshot, 'auto');
    return true;
  }

  async function exportActive() {
    if (
      !active?.confirmed ||
      active.confirmed.key !== active.resultKey ||
      active.confirmed.key !== draftKey ||
      !active.parse
    )
      return false;
    patchEntry(active.id, { exporting: true, actionError: '' });
    try {
      await exportAssistantWorkbook({
        parsed: active.parse,
        result: active.confirmed.result,
        audit: buildAudit(active, active.confirmed.result),
      });
      notify('已导出四表 Excel；原始数据与处理后数据均可追溯');
      return true;
    } catch (e) {
      patchEntry(active.id, { actionError: `导出失败：${(e as Error).message}` });
      return false;
    } finally {
      patchEntry(active.id, { exporting: false });
    }
  }

  function syncActive(mode: 'auto' | 'update' | 'new-version' = 'auto') {
    if (
      !active?.confirmed ||
      active.confirmed.key !== active.resultKey ||
      active.confirmed.key !== draftKey
    )
      return;
    void syncSnapshot(active, active.confirmed, mode);
  }

  function buildAiInput(entry: AssistantEntry): AssistantAnalysisInput {
    if (!entry.parse || !entry.result) throw new Error('请先生成处理结果');
    const excitation =
      (entry.excitation.trim() ? numeric(entry.excitation) : entry.parse.metadata.excitationNm) ?? null;
    if (excitation === null || excitation <= 0)
      throw new Error('AI 分析需要有效的激发波长，请先在文件摘要中填写');
    if (entry.parse.points.length > 12000)
      throw new Error('当前光谱超过 12000 点，AI 接口不会自动抽稀；请缩小分析范围或使用数值算法');
    if (entry.result.anomalies.length > 80)
      throw new Error('异常记录超过 80 条，AI 分析无法一次完成；请先缩小分析范围');
    const blank = selectedBlank(entry, entries);
    return {
      fileName: entry.parse.fileName,
      excitationNm: excitation,
      solvent: entry.solvent,
      spectrum: {
        id: 'assistant-sample',
        name: entry.parse.metadata.sample || entry.file.name,
        points: entry.parse.points,
      },
      blank: blank?.parse
        ? {
            id: 'assistant-blank',
            name: blank.parse.metadata.sample || blank.file.name,
            points: blank.parse.points,
          }
        : null,
      protectedRange:
        entry.parameters.userProtectedRange ?? entry.result.autoProtectedRange ?? null,
      anomalies: entry.result.anomalies.map((anomaly) => ({
        id: anomaly.id,
        kind: anomaly.kind,
        status: anomaly.status,
        fromNm: anomaly.fromNm,
        toNm: anomaly.toNm,
        wavelengths: anomaly.wavelengths.slice(0, 40),
        deviation: anomaly.deviation,
      })),
      scattering: entry.result.scattering.map((candidate) => ({
        type: candidate.type,
        label: candidate.label,
        fromNm: candidate.fromNm,
        toNm: candidate.toNm,
        evidence: candidate.evidence,
      })),
      parameters: {
        thresholdSigma: entry.parameters.thresholdSigma,
        windowSize: entry.parameters.windowSize,
        maxRepairRun: entry.parameters.maxRepairRun,
        repairSpikes: entry.parameters.repairSpikes,
        maskScattering: entry.parameters.maskScattering,
      },
    };
  }

  async function analyzeWithAi() {
    if (!active?.parse || !active.result) return;
    if (!consent) {
      patchEntry(active.id, { aiError: '请先在 AI 设置中勾选数据发送与计费说明' });
      return;
    }
    if (!credentials.apiKey.trim()) {
      patchEntry(active.id, { aiError: '请先填写自己的 API Key' });
      return;
    }
    let input: AssistantAnalysisInput;
    try {
      input = buildAiInput(active);
    } catch (e) {
      patchEntry(active.id, { aiError: (e as Error).message });
      return;
    }
    const controller = new AbortController();
    aiController.current?.abort();
    aiController.current = controller;
    const timer = setTimeout(() => controller.abort(), 60000);
    const startedKey = active.resultKey;
    patchEntry(active.id, { aiBusy: true, aiError: '' });
    try {
      const response = await requestAssistantAi(credentials, input, controller.signal);
      const ai: AiState = {
        provider: credentials.provider,
        model: credentials.model,
        summary: response.summary,
        notes: response.anomalyNotes,
        recommendations: response.recommendations,
      };
      const message = [
        `AI 辅助分类（${credentials.model}）：${response.summary}`,
        response.anomalyNotes.length
          ? `\n分类：${response.anomalyNotes.map((note) => `${note.id} ${classificationLabel(note.classification)}（${confidenceLabel(note.confidence)}）`).join('；')}`
          : '',
        response.recommendations.length
          ? `\n建议：${response.recommendations.join('；')}`
          : '',
        '\nAI 仅提供解释与分类，没有修改任何强度值。AI 说明已写入 Excel 报告；请重新确认后再导出或同步。',
      ].join('');
      setEntries((previous) =>
        previous.map((entry) => {
          if (entry.id !== active.id) return entry;
          if (entry.resultKey !== startedKey || !entry.result)
            return {
              ...entry,
              aiBusy: false,
              aiError: 'AI 返回前处理结果已变化，本次分类说明未应用；请基于新结果重新分析。',
            };
          const noteMap = new Map(response.anomalyNotes.map((note) => [note.id, note]));
          const annotated: AssistantProcessingResult = {
            ...entry.result,
            anomalies: entry.result.anomalies.map((anomaly) => {
              const note = noteMap.get(anomaly.id);
              return note
                ? {
                    ...anomaly,
                    aiNote: `${classificationLabel(note.classification)} · 置信度 ${confidenceLabel(note.confidence)}：${note.note}`,
                  }
                : anomaly;
            }),
          };
          return {
            ...entry,
            ai,
            result: annotated,
            confirmed: null,
            aiBusy: false,
            messages: [...entry.messages, chatMessage('assistant', message)],
          };
        }),
      );
    } catch (e) {
      patchEntry(active.id, {
        aiBusy: false,
        aiError: controller.signal.aborted ? 'AI 请求超时或已取消，可按需重试' : (e as Error).message,
      });
    } finally {
      clearTimeout(timer);
      patchEntry(active.id, { aiBusy: false });
    }
  }

  function updateChatMessages(id: string, change: (messages: ChatMessage[]) => ChatMessage[]) {
    const bounded = (messages: ChatMessage[]) => change(messages).slice(-100);
    if (id === 'general') setGeneralMessages(bounded);
    else patchEntry(id, (entry) => ({ messages: bounded(entry.messages) }));
  }

  function currentChatContext(entry: AssistantEntry | null, question: string) {
    if (!entry?.parse) return null;
    const input = buildInput(entry, entries);
    if (!input) return null;
    const revision = entryKey(entry, entries);
    const context = buildChatContext({ id: entry.id, revision, parse: entry.parse, parameters: entry.parameters,
      result: entry.result, stale: entry.resultKey !== revision,
      confirmed: entry.confirmed?.key === revision && entry.resultKey === revision,
      excitationNm: input.excitationNm, solvent: entry.solvent, hasBlank: !!input.blank, subtractBlank: entry.subtractBlank,
      blankSameConditions: entry.blankSameConditions }, question);
    context.selectedFiles = entries.filter(e => selectedIds.includes(e.id)).map(e => {
      if (!e.parse || !e.result) throw new Error(`${e.file.name}：没有有效测量数据`);
      const doc = { result: e.result, version: entryKey(e, entries) }, points = e.parse.points;
      const maximum = points.reduce((a, b) => a.y > b.y ? a : b);
      const live = doc.result.points.filter(p => !p.deleted && p.processed !== null);
      const peak = live.reduce<(typeof live)[number] | null>((a, b) => !a || b.processed! > a.processed! ? b : a, null);
      return { id: e.id, name: e.file.name, version: doc.version, processingRange: doc.result.scanRange ?? null,
        state: e.resultKey !== doc.version ? 'stale' as const : e.confirmed?.key === doc.version ? 'confirmed' as const : 'preview' as const,
        scanRange: { fromNm: points[0].x, toNm: points.at(-1)!.x }, pointCount: points.length,
        summary: { remaining: doc.result.points.filter(p => !p.deleted).length,
          deleted: doc.result.points.filter(p => p.deleted).length,
          masked: doc.result.points.filter(p => !p.deleted && p.processed === null).length, maximum, processedMaximum: peak ? { x: peak.x, y: peak.processed! } : null } };
    });
    return context;
  }

  function cancelChat(id = chatId) {
    chatRequests.current.get(id)?.abort();
    chatRequests.current.delete(id);
    setChatStatus((previous) => ({ ...previous, [id]: { busy: false, error: '请求已取消，可重新生成回复。' } }));
  }

  function clearChat() {
    chatRequests.current.get(chatId)?.abort();
    chatRequests.current.delete(chatId);
    updateChatMessages(chatId, () => []);
    setChatDraft('');
    setChatStatus((previous) => ({ ...previous, [chatId]: { busy: false, error: '' } }));
  }

  async function sendChat(regenerate = false) {
    const id = chatId;
    if (chatRequests.current.has(id)) return;
    const error = (text: string) => setChatStatus((previous) => ({ ...previous, [id]: { busy: false, error: text } }));
    if (!credentials.apiKey.trim()) { error('请先在 AI 设置中填写个人 API Key'); return; }
    if (!consent) { error('请先在 AI 设置中同意数据发送与计费说明'); return; }
    const lastUser = messages.map((m) => m.role === 'user' && m.source === 'model').lastIndexOf(true);
    const text = redactSecrets((regenerate ? messages[lastUser]?.text ?? '' : chatDraft).trim());
    if (!text) return;
    if (text.length > CHAT_LIMITS.question) { error(`问题最多 ${CHAT_LIMITS.question} 字符`); return; }
    const previous = regenerate ? messages.slice(0, lastUser) : messages;
    const history = recentChatHistory(previous.filter((m) => m.source === 'model')
      .map((m) => ({ role: m.role, content: redactSecrets(m.text) })));
    let context;
    try {
      context = currentChatContext(active, [...history.filter((m) => m.role === 'user').slice(-3).map((m) => m.content), text].join('\n'));
    } catch (e) { error(`光谱上下文无效：${(e as Error).message}`); return; }
    const controller = new AbortController();
    chatRequests.current.set(id, controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 60000);
    const user = regenerate ? messages[lastUser] : chatMessage('user', text, 'model');
    updateChatMessages(id, (current) => regenerate ? [...previous, user] : [...current, user]);
    if (!regenerate) setChatDraft('');
    setChatStatus((previous) => ({ ...previous, [id]: { busy: true, error: '' } }));
    try {
      const response = await requestAssistantChat(credentials, { question: text, history, context }, controller.signal);
      // Deleted/cleared/cancelled conversations cannot be revived by late responses.
      if (chatRequests.current.get(id) !== controller || controller.signal.aborted) return;
      if (context) {
        const latest = latestEntries.current.find(e => e.id === context.sessionId);
        const files = context.selectedFiles ?? [];
        const invalid = !latest || entryKey(latest, latestEntries.current) !== context.revision ||
          files.length !== latestSelection.current.length || files.some(f => {
            const current = latestEntries.current.find(e => e.id === f.id);
            return !current || !latestSelection.current.includes(f.id) || entryKey(current, latestEntries.current) !== f.version;
          });
        if (invalid) { error('模型返回前文件选择或版本已变化，本次回复已失效，请重新提问。'); return; }
      }
      const reply: ChatMessage = { ...chatMessage('assistant', redactSecrets(response.reply), 'model'),
        operation: response.operation, model: credentials.model };
      updateChatMessages(id, (current) => [...current, reply]);
    } catch (e) {
      if (chatRequests.current.get(id) === controller)
        error(controller.signal.aborted ? timedOut ? 'AI 请求超时，请重新生成回复。' : '请求已取消，可重新生成回复。'
          : redactSecrets((e as Error).message));
    } finally {
      clearTimeout(timer);
      if (chatRequests.current.get(id) === controller) {
        chatRequests.current.delete(id);
        setChatStatus((previous) => ({ ...previous, [id]: { busy: false, error: previous[id]?.error ?? '' } }));
      }
    }
  }

  function applyChatOperation(message: ChatMessage) {
    if (!active?.parse || !message.operation || message.applied) return;
    if (message.operation.type === 'batch-edit') { setBatchPreview(null); setBatchConfirmed(false); setAllowProtected(false); }
    try {
      const context = currentChatContext(active, '');
      const operation = validateChatReply({ reply: message.text, operation: message.operation }, context).operation!;
      if (operation.type === 'batch-edit') {
        const docs = entries.filter(e => selectedIds.includes(e.id)).map(e => batchDocument(e, entries));
        setBatchPreview(previewBatchEdit(docs, operation));
        setBatchConfirmed(false); setAllowProtected(false); setBatchError('');
        return;
      }
      const parameters = { ...active.parameters, ...operation.parameters };
      const updated = { ...active, parameters, confirmed: null, epoch: active.epoch + 1 };
      const computed = computeEntry(updated, entries.map((e) => e.id === active.id ? updated : e));
      if (!computed.result || computed.processError) throw new Error(computed.processError || '未生成有效预览');
      patchEntry(active.id, (entry) => ({ parameters, epoch: updated.epoch, ...computed, ai: null, confirmed: null, actionError: '',
        messages: [...entry.messages.map((m) => m.id === message.id ? { ...m, applied: true } : m),
          chatMessage('assistant', `已由本地算法生成新预览：${describeAssistantResult(computed.result!)} 请核对图表和处理记录，再点击“确认处理结果”。`)].slice(-100) }));
    } catch (e) {
      setChatStatus((previous) => ({ ...previous, [chatId]: { busy: false,
        error: `建议未应用：${(e as Error).message}。文件或参数变化后请重新提问。` } }));
    }
  }

  function selectedDocuments() {
    return entries.filter(e => selectedIds.includes(e.id)).map(e => batchDocument(e, entries));
  }
  function previewIsCurrent() {
    if (!batchPreview) return false;
    try {
      const docs = selectedDocuments();
      return docs.length === batchPreview.before.length && batchPreview.before.every(b => docs.some(d => d.id === b.id && d.version === b.version));
    } catch { return false; }
  }
  // Stage all writes before committing so a failed batch leaves the workbook intact.
  function syncEntriesToSheets(targets: AssistantEntry[], createOnly: boolean) {
    let workspace = w;
    const synced = new Map<string, SyncRecord>();
    const groups = sheetImportMode === 'combined' && targets.length ? [targets] : targets.map(entry => [entry]);
    for (const group of groups) {
      const shared = group.length > 1;
      const first = group[0];
      const existingId = first.sync?.sheetId;
      const canUpdate = !createOnly && existingId && (sheetImportMode === 'combined' || !first.sync?.shared)
        && group.every(entry => entry.sync?.sheetId === existingId);
      const outcome = syncAssistantResult(workspace, group.map(entry => ({
        sourceId: entry.id, parsed: entry.parse!, result: entry.confirmed!.result,
        audit: buildAudit(entry, entry.confirmed!.result), unit: w.calUnit, fallbackExcitation: w.excitation,
      })), {
        mode: canUpdate ? 'update' : 'create', targetSheetId: existingId,
        preserveOtherSeries: !!canUpdate && group.some(entry => entry.sync?.shared),
        sheetName: shared ? 'AI处理_合并光谱' : baseAiSheetName(first.file.name, (first.sync?.version ?? 0) + 1),
      });
      workspace = { ...workspace, ...outcome.patch };
      for (const entry of group) synced.set(entry.id, {
        shared: shared || (!!canUpdate && !!entry.sync?.shared),
        key: entry.confirmed!.key, sheetId: outcome.sheetId, sheetName: outcome.sheetName,
        version: (entry.sync?.version ?? 0) + 1, at: timestamp(),
      });
    }
    return { workspace, synced };
  }
  function installBatch(docs: BatchDocument[]) {
    const installed = docs.map(doc => {
      const entry = entries.find(e => e.id === doc.id)!;
      return { ...entry, result: doc.result, resultKey: doc.version,
        manualRevision: { base: baseEntryKey(entry, entries), version: doc.version },
        confirmed: { key: doc.version, result: doc.result, at: dateStamp() }, ai: null };
    });
    const targets = installed.filter(entry => autoSync || entry.sync);
    const { workspace, synced } = syncEntriesToSheets(targets, false);
    if (workspace !== w) update(workspace);
    setEntries(previous => previous.map(entry => {
      const next = installed.find(candidate => candidate.id === entry.id);
      return next ? { ...next, sync: synced.get(entry.id) ?? next.sync } : entry;
    }));
  }
  function confirmBatch() {
    if (!batchPreview || !batchConfirmed) return;
    try {
      if (!previewIsCurrent()) throw new Error('文件选择或版本已变化，请重新生成批量预览');
      const after = commitBatchEdit(selectedDocuments(), batchPreview, allowProtected);
      installBatch(after);
      setBatchTransaction({ ...batchPreview, after }); setRedoPlan(null); setBatchPreview(null); setBatchError('');
      notify('已确认整批编辑，原始测量数据完整保留');
    } catch (e) { setBatchError((e as Error).message); }
  }
  function undoBatch() {
    if (!batchTransaction) return;
    try {
      const docs = batchTransaction.after.map(d => {
        const entry = entries.find(e => e.id === d.id);
        if (!entry) throw new Error('文件已移除，无法撤销');
        return batchDocument(entry, entries);
      });
      installBatch(undoBatchEdit(docs, batchTransaction));
      setRedoPlan(batchTransaction.plan); setBatchTransaction(null); setBatchPreview(null); setBatchError('');
      notify('已撤销整批编辑，审计记录已保留');
    } catch (e) { setBatchError((e as Error).message); }
  }
  function previewRedo() {
    if (!redoPlan || !active) return;
    try {
      const docs = selectedDocuments();
      if (docs.length !== redoPlan.targets.length || redoPlan.targets.some(t => !docs.some(d => d.id === t.fileId)))
        throw new Error('请选择原批次的全部文件后重新应用');
      const plan = { ...redoPlan, sessionId: active.id, revision: entryKey(active, entries),
        targets: docs.map(d => ({ fileId: d.id, version: d.version })) };
      setBatchPreview(previewBatchEdit(docs, plan)); setBatchConfirmed(false); setAllowProtected(false); setBatchError('');
    } catch (e) { setBatchError((e as Error).message); }
  }
  const selectedEntries = entries.filter(e => selectedIds.includes(e.id));
  const canBatchExport = selectedEntries.length > 0 && selectedEntries.every(e => {
    try { return e.confirmed?.key === entryKey(e, entries) && e.confirmed?.key === e.resultKey; } catch { return false; }
  });
  function importSelectedSheets() {
    if (!canBatchExport) return;
    try {
      const { workspace, synced } = syncEntriesToSheets(selectedEntries, true);
      update(workspace);
      setEntries(previous => previous.map(entry => synced.has(entry.id) ? { ...entry, sync: synced.get(entry.id)! } : entry));
      setBatchError('');
      notify(`已将 ${selectedEntries.length} 个文件的处理后数据导入${sheetImportMode === 'combined' ? '同一 Sheet' : '各自的 Sheet'}`);
    } catch (e) { setBatchError((e as Error).message); }
  }
  async function exportBatch() {
    if (!canBatchExport || batchExporting) return;
    setBatchExporting(true); setBatchError('');
    try {
      await exportAssistantBatchWorkbook(selectedEntries.map(e => ({ id: e.id, version: e.confirmed!.key,
        parsed: e.parse!, result: e.confirmed!.result, audit: buildAudit(e, e.confirmed!.result) })));
      notify('全部所选光谱及审计记录已合并导出');
    } catch (e) { setBatchError((e as Error).message); }
    finally { setBatchExporting(false); }
  }

  function runLocalCommand(text: string) {
    if (!text || !active?.parse) return;
    const command = interpretAssistantCommand(text, {
      parameters: active.parameters,
      result: active.result,
      hasBlank: !!blankEntry,
      confirmed: !!confirmed,
    });
    const userMessage = chatMessage('user', text);
    let assistantText = command.reply;
    let nextEntry: AssistantEntry = active;
    let runAfter: (() => void) | null = null;
    if (command.action === 'recompute' || command.action === 'reset') {
      const parameters = command.parameters;
      const subtractBlank = command.process.subtractBlank ?? active.subtractBlank;
      const updated: AssistantEntry = { ...active, parameters, subtractBlank, epoch: active.epoch + 1 };
      const computed = computeEntry(
        updated,
        entries.map((entry) => (entry.id === active.id ? updated : entry)),
      );
      const sameResult = computed.resultKey === active.resultKey;
      const computedResult =
        computed.result && sameResult && active.ai
          ? annotateResult(computed.result, active.ai)
          : computed.result;
      nextEntry = {
        ...updated,
        ...computed,
        result: computedResult,
        ai: sameResult ? active.ai : null,
        confirmed: null,
        actionError: '',
      };
      assistantText = computed.processError
        ? `${command.reply}\n处理未生成：${computed.processError}`
        : `${command.reply}\n${computed.result ? describeAssistantResult(computed.result) : ''}`;
    } else if (command.action === 'show-compare' || command.action === 'show-original') {
      nextEntry = {
        ...active,
        view: command.action === 'show-compare' ? 'compare' : 'original',
      };
    } else if (command.action === 'confirm') {
      if (canConfirm) {
        const snapshot: ConfirmedSnapshot = {
          key: active.resultKey,
          result: active.result!,
          at: dateStamp(),
        };
        nextEntry = { ...active, confirmed: snapshot, actionError: '' };
        assistantText = autoSync
          ? '已确认当前处理结果，正在自动同步到新 Sheet。Excel 与 Sheet 使用同一份处理结果。'
          : '已确认当前处理结果。现在可以导出 Excel 或同步到 Sheet。';
        runAfter = () => void syncSnapshot(active, snapshot, 'auto');
      } else {
        assistantText = stale
          ? '参数已变化，旧结果尚未重新生成，不能确认。请点击“重新生成结果”。'
          : '当前结果存在失败的质量检查，不能确认；请调整参数或查看处理记录。';
      }
    } else if (command.action === 'export') {
      if (active.confirmed?.key === active.resultKey) {
        assistantText = '正在导出当前已确认结果。';
        runAfter = () => void exportActive();
      } else assistantText = '当前结果尚未确认，不能导出。请先确认处理结果。';
    } else if (command.action === 'sync') {
      if (active.confirmed?.key === active.resultKey) {
        assistantText = '正在把已确认结果同步到 Sheet。';
        runAfter = () => syncActive('auto');
      } else assistantText = '当前结果尚未确认，不能同步。请先确认处理结果。';
    }
    setEntries((previous) =>
      previous.map((entry) =>
        entry.id === active.id
          ? {
              ...nextEntry,
              messages: [
                ...entry.messages,
                userMessage,
                chatMessage('assistant', assistantText),
              ],
            }
          : entry,
      ),
    );
    if (runAfter) queueMicrotask(runAfter);
  }

  const result = active?.result ?? null;
  const previewRows = active?.parse
    ? active.parse.points.length <= 60
      ? active.parse.points.map((point, index) => ({ point, index }))
      : [
          ...active.parse.points.slice(0, 40).map((point, index) => ({ point, index })),
          ...active.parse.points
            .slice(-10)
            .map((point, index) => ({ point, index: active.parse!.points.length - 10 + index })),
        ]
    : [];
  const syncLabel = syncedCurrent
    ? '更新已同步 Sheet'
    : active?.sync
      ? '同步到新 Sheet（新版本）'
      : '同步到 Sheet';

  const chatPanel = (
    <section className="assistant-card assistant-chat-card" aria-label="AI 分析对话">
      <div className="assistant-section-head">
        <div>
          <h3><Bot size={17} /> AI 分析对话</h3>
          <p>{active ? `关联文件：${active.file.name}` : '通用问答 · 上传文件后可结合真实光谱连续分析'}</p>
        </div>
        <button className="small-button" onClick={clearChat} disabled={!messages.length && !chatBusy}>清除当前对话</button>
      </div>
      <div ref={chatLog} className="assistant-messages" role="log" aria-live="polite" aria-busy={chatBusy}>
        {!messages.length && <p className="assistant-note">输入问题开始多轮对话。历史仅随当前页面会话保留，最多显示最近 100 条；每次发送最近 20 条以内的有界上下文。</p>}
        {messages.slice(-100).map((message) => (
          <article key={message.id} className={`assistant-message ${message.role}`}>
            <div className="assistant-message-head">
              <strong>{message.role === 'user' ? '你' : message.source === 'model' ? `AI · ${message.model}` : '本地处理记录'}</strong>
              <small>{message.at}</small>
            </div>
            <p>{message.text}</p>
            {message.operation && <div className="assistant-operation">
              <strong>{message.operation.type === 'batch-edit' ? '待确认批量编辑计划' : '待应用参数建议'}</strong>
              {message.operation.type === 'batch-edit' ? message.operation.edits.map((edit, i) => <p key={i}>{describeBatchEdit(edit)}</p>) : <pre>{JSON.stringify(message.operation.parameters, null, 2)}</pre>}
              <p>应用后仅生成处理预览，请检查图表并确认结果后再导出或同步。</p>
              <button className="small-button" disabled={message.applied || message.operation.revision !== draftKey}
                onClick={() => applyChatOperation(message)}>
                {message.applied ? '已生成预览' : message.operation.revision !== draftKey ? '参数已变化，请重新提问' : '应用建议并生成预览'}
              </button>
            </div>}
          </article>
        ))}
        {chatBusy && <p className="assistant-chat-loading" role="status"><Loader2 className="spin" size={16} /> 模型正在回答…</p>}
      </div>
      {active?.parse && <div className="assistant-quick-commands" aria-label="本地快捷操作">
        <span className="assistant-note">本地快捷操作：</span>
        {['处理异常尖峰', '只标记不修改', '不要修改主峰附近', '重新分析 450–550 nm', '屏蔽散射', '显示处理前后的光谱'].map((command) => (
          <button key={command} type="button" className="assistant-chip" onClick={() => runLocalCommand(command)}>{command}</button>
        ))}
      </div>}
      <div className="assistant-chat-input">
        <textarea id="assistant-chat-input" aria-label="向 AI 光谱助手提问" value={chatDraft} rows={3}
          maxLength={CHAT_LIMITS.question} onChange={(event) => setChatDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault(); void sendChat();
            }
          }} placeholder="例如：520 nm 附近的峰是不是杂峰？Shift+Enter 换行" />
        <button className="primary" disabled={chatBusy || !chatDraft.trim()} onClick={() => void sendChat()} aria-label="发送消息"><Send size={16} /> 发送</button>
      </div>
      <div className="assistant-ai-actions">
        {chatBusy && <button className="small-button" onClick={() => cancelChat()}><X size={14} /> 取消聊天请求</button>}
        <button className="small-button" disabled={chatBusy || !messages.some((m) => m.role === 'user' && m.source === 'model')}
          onClick={() => void sendChat(true)}><RefreshCw size={14} /> 重新生成回复</button>
        <span className="assistant-note">Enter 发送 · Shift+Enter 换行 · 使用所选模型，可能计费</span>
      </div>
      {chatError && <ErrorNote>{chatError}</ErrorNote>}
      <p className="assistant-note">原始测量值独立保留；AI 参数建议需生成预览并人工确认。大文件发送摘要与最多 384 个真实测量点；提问涉及的波长区间会优先取点，局部也可能抽样。</p>
      {active?.parse && <div className="assistant-ai-actions">
        <button className="small-button" disabled={active.aiBusy || !result || !consent || !credentials.apiKey}
          onClick={() => void analyzeWithAi()}>
          {active.aiBusy ? <Loader2 className="spin" size={14} /> : <Sparkles size={14} />} AI 辅助分类（可能计费）
        </button>
        {active.aiBusy && <button className="small-button" onClick={() => aiController.current?.abort()}><X size={14} /> 取消 AI 请求</button>}
      </div>}
      {!consent && <p className="assistant-note">请在 AI 设置中同意数据发送与计费说明。</p>}
      {consent && !credentials.apiKey && <p className="assistant-note">请在 AI 设置中填写个人 API Key。</p>}
      {active?.aiError && <ErrorNote>{active.aiError}</ErrorNote>}
      {active?.ai && !stale && <div className="assistant-ai-report">
        <strong>AI 分类说明 · {active.ai.model}</strong><p>{active.ai.summary}</p>
        {!!active.ai.recommendations.length && <p>建议：{active.ai.recommendations.join('；')}</p>}
      </div>}
    </section>
  );

  return (
    <section className="assistant-page" aria-label="AI 光谱助手">
      <div className="assistant-upload-card">
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          multiple
          accept=".txt,.csv,.tsv,text/plain"
          aria-label="上传 F-7100 TXT 光谱"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            if (event.target.files) void addFiles(Array.from(event.target.files));
          }}
        />
        <div
          className={`assistant-dropzone ${dragging ? 'dragging' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="选择或拖入 F-7100 TXT 光谱"
          onClick={() => fileInput.current?.click()}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              fileInput.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <span className="assistant-drop-icon">
            {uploading ? <Loader2 className="spin" size={24} /> : <Upload size={24} />}
          </span>
          <div>
            <strong>上传日立 F-7100 TXT 或通用光谱文本</strong>
            <p>
              自动识别 UTF-8 / GB18030 / UTF-16 编码、分隔符和 Data points 数据段；三维 EEM 会明确拒绝，不会误读。
            </p>
            <small>支持 TXT / CSV / TSV · 单文件 ≤20 MB · 可多选；空白光谱可作为另一个文件上传</small>
          </div>
        </div>
        {uploadError && <ErrorNote>{uploadError}</ErrorNote>}
      </div>

      {entries.length > 0 && <section className="assistant-card" aria-label="批量光谱编辑">
        <h3>批量光谱编辑</h3>
        <p>选择参与对话的文件。区间单位为 nm，含起点和终点；删除移除处理后数据行，屏蔽保留波长并将强度留空。</p>
        <div className="assistant-quick-commands">
          <button className="small-button" onClick={() => setSelectedIds(entries.map(e => e.id))}>选择全部文件</button>
          {entries.map(e => <label key={e.id}><input type="checkbox" aria-label={`批量选择 ${e.file.name}`}
            checked={selectedIds.includes(e.id)} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, e.id] : ids.filter(id => id !== e.id))} />{e.file.name}</label>)}
        </div>
        <p>已选择 {selectedEntries.length} 个文件。在下方对话中描述批量操作，再点击“应用建议并生成预览”。</p>
        <div className="assistant-actions" aria-label="多文件导入 Sheet">
          <label>多文件导入方式{' '}
            <select aria-label="多文件导入方式" value={sheetImportMode}
              onChange={event => setSheetImportMode(event.target.value as 'separate' | 'combined')}>
              <option value="separate">分别导入不同 Sheet</option>
              <option value="combined">合并导入同一 Sheet</option>
            </select>
          </label>
          <button disabled={!canBatchExport} onClick={importSelectedSheets}>
            <Layers3 size={16} /> 导入所选文件到 Sheet
          </button>
        </div>
        <p className="assistant-note">所选文件需先确认处理结果。仅导入波长和处理后强度，按文件名区分；合并时按波长对齐，缺失值留空。此选择也用于确认批量编辑后的自动同步。</p>
        {batchPreview && <div className="assistant-operation" aria-label="批量编辑预览">
          <h4>操作预览（尚未提交）</h4>
          {batchPreview.plan.edits.map((edit, i) => <p key={i}>{describeBatchEdit(edit)}</p>)}
          {batchPreview.impacts.map(i => <p key={i.id}>{i.name}：受影响 {i.affected} 行；删除 {i.deleted} 行；屏蔽 {i.masked} 行；数值修改 {i.changed} 行；主峰风险 {i.protected} 行</p>)}
          <div style={{ overflowX: 'auto', maxHeight: 260 }}>
            <table><thead><tr><th>文件</th><th>源行号</th><th>波长 nm</th><th>修改前</th><th>修改后</th><th>理由</th></tr></thead>
              <tbody>{batchPreview.after.flatMap((d, i) => (d.result.editAudit ?? []).slice(batchPreview.before[i].result.editAudit?.length ?? 0)
                .slice(0, 30).map((a, index) => <tr key={`${d.id}-${index}`}><td>{d.name}</td><td>{a.rowNumber}</td><td>{a.wavelengthNm}</td>
                  <td>{a.beforeDeleted ? '删除' : a.before ?? '屏蔽'}</td><td>{a.afterDeleted ? '删除' : a.after ?? '屏蔽'}</td><td>{a.reason}</td></tr>))}</tbody></table>
          </div>
          <p>逐点明细每文件显示前 30 条；统计覆盖本地全部数据，完整记录随 Excel 导出。</p>
          {batchPreview.impacts.some(i => i.protected > 0) && <label><input type="checkbox" checked={allowProtected}
            onChange={e => setAllowProtected(e.target.checked)} />我已核对主峰风险，允许本计划修改保护区</label>}
          <label><input type="checkbox" checked={batchConfirmed} onChange={e => setBatchConfirmed(e.target.checked)} />我已核对逐文件影响，确认提交整批编辑</label>
          <button className="primary" disabled={!batchConfirmed || !previewIsCurrent() || (batchPreview.impacts.some(i => i.protected) && !allowProtected)}
            onClick={confirmBatch}>确认批量编辑</button>
          <button className="small-button" onClick={() => setBatchPreview(null)}>取消批量预览</button>
          {!previewIsCurrent() && <ErrorNote>文件选择或版本已变化，旧预览已失效，请重新提问。</ErrorNote>}
        </div>}
        <div className="assistant-ai-actions">
          <button className="small-button" disabled={!batchTransaction} onClick={undoBatch}>撤销上次批量编辑</button>
          <button className="small-button" disabled={!redoPlan} onClick={previewRedo}>重新应用批量编辑</button>
          <button className="primary" disabled={!canBatchExport || batchExporting} onClick={() => void exportBatch()}>统一导出 Excel</button>
        </div>
        {!canBatchExport && <p>统一导出需要所有所选文件的当前结果均已确认。</p>}
        {batchError && <ErrorNote>{batchError}</ErrorNote>}
      </section>}

      {entries.length > 0 && (
        <div className="assistant-file-bar" role="tablist" aria-label="已上传光谱文件">
          {entries.map((entry) => {
            const state = entry.parse ? 'ready' : entry.parseError ? 'error' : 'pending';
            return (
              <div className="assistant-file-tab-wrap" key={entry.id}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={entry.id === active?.id}
                  className={`assistant-file-tab ${entry.id === active?.id ? 'selected' : ''}`}
                  onClick={() => setActiveId(entry.id)}
                >
                  <FileText size={16} />
                  <span>
                    <strong>{entry.file.name}</strong>
                    <small>
                      {entry.parse
                        ? `${entry.parse.points.length} 点 · ${formatLabel(entry.parse)}`
                        : entry.parseError
                          ? '解析失败'
                          : '等待解析'}
                    </small>
                  </span>
                  <span className={`assistant-file-state ${state}`} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="assistant-file-remove"
                  aria-label={`移除 ${entry.file.name}`}
                  onClick={() => removeEntry(entry.id)}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {active && (
        <>
          <section className="assistant-card" aria-label="文件识别摘要">
            <div className="assistant-section-head">
              <div>
                <h3>文件识别摘要</h3>
                <p>{active.file.name} · 可检查并手动修正识别结果；原始文件内容不会被覆盖。</p>
              </div>
              <span className={`assistant-format-badge ${active.parse ? 'ok' : 'error'}`}>
                {active.parse ? formatLabel(active.parse) : '未识别'}
              </span>
            </div>
            {active.parseError && (
              <ErrorNote>
                {active.parseError}
                {active.parse ? ' 已保留上一次成功解析的数据。' : ''}
              </ErrorNote>
            )}
            {active.parse && (
              <>
                <div className="assistant-metrics">
                  <Metric label="激发波长" value={active.parse.metadata.excitationNm?.toString() ?? '—'} unit="nm" />
                  <Metric
                    label="实际测量范围"
                    value={`${fmt(active.parse.points[0].x, 5)}–${fmt(active.parse.points.at(-1)!.x, 5)}`}
                    unit="nm"
                  />
                  <Metric label="数据点" value={active.parse.points.length.toString()} unit="点" />
                  <Metric label="数据起始行" value={active.parse.dataStartLine.toString()} unit="" />
                  <Metric label="测量日期" value={active.parse.metadata.measuredOn || '—'} unit="" />
                  <Metric label="跳过行" value={active.parse.skippedRows.toString()} unit="行" />
                </div>
                <section className="assistant-scan-range" aria-label="扫描范围设置">
                  <strong>扫描范围 / nm（可修改）</strong>
                  <p className="assistant-note">仅处理并导出所选闭区间内的数据，包含两个端点；原始数据完整保留。每个文件独立设置。</p>
                  <div className="assistant-form-grid">
                    <Field label="扫描范围起点 / nm">
                      <input type="number" step="any" aria-invalid={!!scanRangeError}
                        min={active.parse.points[0].x} max={active.parse.points.at(-1)!.x}
                        value={active.scanRangeDraft?.from ?? String(active.parse.points[0].x)}
                        onChange={event => patchEntry(active.id, { scanRangeDraft: { from: event.target.value,
                          to: active.scanRangeDraft?.to ?? String(active.parse!.points.at(-1)!.x) } })} />
                    </Field>
                    <Field label="扫描范围终点 / nm">
                      <input type="number" step="any" aria-invalid={!!scanRangeError}
                        min={active.parse.points[0].x} max={active.parse.points.at(-1)!.x}
                        value={active.scanRangeDraft?.to ?? String(active.parse.points.at(-1)!.x)}
                        onChange={event => patchEntry(active.id, { scanRangeDraft: { from: active.scanRangeDraft?.from ?? String(active.parse!.points[0].x),
                          to: event.target.value } })} />
                    </Field>
                  </div>
                  {scanRangeError ? <ErrorNote>{scanRangeError}</ErrorNote> :
                    <p className="assistant-note">所选范围包含 {scanRangeCount} 个实际测量点，范围外 {active.parse.points.length - scanRangeCount} 点仅保留在原始数据中。</p>}
                  <div className="assistant-ai-actions">
                    <button className="small-button" disabled={!active.scanRangeDraft}
                      onClick={() => patchEntry(active.id, { scanRangeDraft: null })}>恢复完整范围</button>
                    <button className="small-button" disabled={!!scanRangeError || !stale}
                      onClick={() => recompute(active.id)}>按扫描范围生成预览</button>
                    {stale && <span className="assistant-note">设置已变化，请重新生成预览并确认结果。</span>}
                  </div>
                </section>
                <dl className="assistant-metadata">
                  <div><dt>样品</dt><dd>{active.parse.metadata.sample || '—'}</dd></div>
                  <div><dt>仪器</dt><dd>{active.parse.metadata.instrument || '—'}</dd></div>
                  <div><dt>扫描模式</dt><dd>{active.parse.metadata.scanMode || '—'}</dd></div>
                  <div><dt>文本编码</dt><dd>{encodingLabel(active.parse.encoding)}</dd></div>
                  <div><dt>分隔符</dt><dd>{delimiterLabel(active.parse.delimiter)}</dd></div>
                  <div><dt>源文件总行数</dt><dd>{active.parse.totalLines}</dd></div>
                </dl>
                <div className="assistant-form-grid assistant-summary-form">
                  <Field label="激发波长 / nm（可修正）" hint="留空则使用文件元数据；用于散射判断与斯托克斯位移。">
                    <input
                      type="number"
                      min={1}
                      value={active.excitation}
                      onChange={(event) =>
                        patchEntry(active.id, { excitation: event.target.value, confirmed: null })
                      }
                      placeholder="例如 360"
                    />
                  </Field>
                  <Field label="溶剂或基质" hint="用于估算水/乙醇拉曼散射位置。">
                    <input
                      value={active.solvent}
                      maxLength={200}
                      onChange={(event) =>
                        patchEntry(active.id, { solvent: event.target.value, confirmed: null })
                      }
                      placeholder="例如 水 / 乙醇 / 实际水样"
                    />
                  </Field>
                  <Field label="空白参考光谱" hint="从已上传文件中选择同条件空白；空白扣除不会外推。">
                    <select
                      value={active.blankId}
                      onChange={(event) =>
                        patchEntry(active.id, {
                          blankId: event.target.value,
                          subtractBlank: false,
                          blankSameConditions: false,
                          confirmed: null,
                        })
                      }
                    >
                      <option value="">不使用空白</option>
                      {entries
                        .filter((entry) => entry.id !== active.id && entry.parse)
                        .map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.file.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>
                <div className="assistant-actions assistant-blank-actions">
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={active.subtractBlank}
                      disabled={!blankEntry}
                      onChange={(event) =>
                        patchEntry(active.id, {
                          subtractBlank: event.target.checked,
                          confirmed: null,
                        })
                      }
                    />
                    启用 1:1 空白扣除
                  </label>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={active.blankSameConditions}
                      disabled={!blankEntry}
                      onChange={(event) =>
                        patchEntry(active.id, {
                          blankSameConditions: event.target.checked,
                          confirmed: null,
                        })
                      }
                    />
                    确认空白与样品测量条件一致
                  </label>
                  {active.subtractBlank && !active.blankSameConditions && (
                    <span className="assistant-stale">需要确认测量条件一致后才能扣除空白。</span>
                  )}
                </div>
                {active.parse.warnings.length > 0 && (
                  <ul className="assistant-warnings">
                    {active.parse.warnings.map((warning, index) => (
                      <li key={index}>
                        <AlertTriangle size={14} /> {warning}
                      </li>
                    ))}
                  </ul>
                )}
                <details className="assistant-data-preview">
                  <summary>
                    查看解析后的原始数据表（预览 {previewRows.length} / 共 {active.parse.points.length} 行）
                  </summary>
                  <div className="assistant-table-scroll">
                    <table className="assistant-data-table">
                      <thead>
                        <tr>
                          <th>序号</th>
                          <th>源文件行号</th>
                          <th>波长 / nm</th>
                          <th>原始强度</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map(({ point, index }) => (
                          <tr key={`${point.x}-${index}`}>
                            <td>{index + 1}</td>
                            <td>{active.parse!.rowNumbers[index]}</td>
                            <td>{fmt(point.x, 6)}</td>
                            <td>{fmt(point.y, 8)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="assistant-note">
                    预览仅显示首尾数据；完整原始值会写入 Excel“原始数据”表；同步到 Sheet 后可直接继续编辑和绘图。
                  </p>
                </details>
              </>
            )}
            <details className="assistant-parse-settings">
              <summary>检查 / 修正识别结果</summary>
              <div className="assistant-form-grid">
                <Field label="文本编码">
                  <select
                    value={active.parseOptions.encoding}
                    onChange={(event) =>
                      patchEntry(active.id, (entry) => ({
                        parseOptions: {
                          ...entry.parseOptions,
                          encoding: event.target.value as SpectrumEncoding,
                        },
                      }))
                    }
                  >
                    {Object.entries(encodingLabel).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="分隔符">
                  <select
                    value={active.parseOptions.delimiter}
                    onChange={(event) =>
                      patchEntry(active.id, (entry) => ({
                        parseOptions: {
                          ...entry.parseOptions,
                          delimiter: event.target.value as SpectrumDelimiter,
                        },
                      }))
                    }
                  >
                    <option value="auto">自动识别</option>
                    <option value={'\t'}>制表符</option>
                    <option value=",">逗号</option>
                    <option value=";">分号</option>
                    <option value="|">竖线</option>
                    <option value="space">空格</option>
                  </select>
                </Field>
                <Field label="首个数据行" hint={active.parse ? `自动识别为第 ${active.parse.dataStartLine} 行` : '留空自动识别'}>
                  <input
                    type="number"
                    min={1}
                    value={active.parseOptions.dataStartLine}
                    onChange={(event) =>
                      patchEntry(active.id, (entry) => ({
                        parseOptions: { ...entry.parseOptions, dataStartLine: event.target.value },
                      }))
                    }
                    placeholder="自动"
                  />
                </Field>
                <Field label="波长列（0 起）">
                  <input
                    type="number"
                    min={0}
                    value={active.parseOptions.wavelengthColumn}
                    onChange={(event) =>
                      patchEntry(active.id, (entry) => ({
                        parseOptions: {
                          ...entry.parseOptions,
                          wavelengthColumn: event.target.value,
                        },
                      }))
                    }
                    placeholder={active.parse ? String(active.parse.columns.wavelength) : '自动'}
                  />
                </Field>
                <Field label="强度列（0 起）">
                  <input
                    type="number"
                    min={0}
                    value={active.parseOptions.intensityColumn}
                    onChange={(event) =>
                      patchEntry(active.id, (entry) => ({
                        parseOptions: {
                          ...entry.parseOptions,
                          intensityColumn: event.target.value,
                        },
                      }))
                    }
                    placeholder={active.parse ? String(active.parse.columns.intensity) : '自动'}
                  />
                </Field>
              </div>
              <div className="assistant-actions">
                <button className="small-button" onClick={() => void reparse(active.id)}>
                  <RefreshCw size={14} /> 按此设置重新解析
                </button>
                <span className="assistant-note">
                  重新解析不会删除已有 Sheet；无法识别的行会显示跳过数量，不会静默丢失。
                </span>
              </div>
            </details>
          </section>

          <AssistantAiSettings consent={consent} onConsentChange={setConsent} />

          {active.parse && (
            <>
              <div className="assistant-main-grid">
                <section className="assistant-card assistant-chart-card" aria-label="光谱图展示">
                  <div className="assistant-section-head">
                    <div>
                      <h3>原始与处理后光谱</h3>
                      <p>
                        {result
                          ? `主峰 ${result.mainPeak?.originalX ?? '未识别'} nm · 修复 ${result.stats.repaired} 点 · 屏蔽 ${result.stats.masked} 点 · 保护区 ${result.protectedRanges.length ? `${result.protectedRanges.map((range) => `${fmt(range.fromNm, 4)}–${fmt(range.toNm, 4)}`).join('、')} nm` : '未设置'}`
                          : '原始测量数据'}
                      </p>
                    </div>
                    <div className="segmented">
                      <button
                        className={active.view === 'compare' ? 'selected' : ''}
                        onClick={() => patchEntry(active.id, { view: 'compare' })}
                      >
                        处理前后
                      </button>
                      <button
                        className={active.view === 'original' ? 'selected' : ''}
                        onClick={() => patchEntry(active.id, { view: 'original' })}
                      >
                        仅原始
                      </button>
                    </div>
                  </div>
                  <AssistantSpectrumChart
                    parsed={active.parse}
                    result={result}
                    view={active.view}
                    title={active.view === 'compare' ? '原始与处理后光谱对比' : '原始发射光谱'}
                  />
                </section>

                {chatPanel}
              </div>

              <section className="assistant-card" aria-label="异常检测与处理参数">
                <div className="assistant-section-head">
                  <div>
                    <h3>异常检测与处理参数</h3>
                    <p>阈值、窗口和处理强度均可复核；默认保护主峰，异常只做局部插值或屏蔽，不覆盖原始值。</p>
                  </div>
                  <span className="assistant-algorithm">算法 {result?.algorithmVersion ?? '待生成'}</span>
                </div>
                <div className="assistant-form-grid assistant-parameter-grid">
                  <Field label="处理强度">
                    <select
                      value={active.parameters.sensitivity}
                      onChange={(event) => {
                        const sensitivity = event.target.value as AssistantSensitivity;
                        patchParameters({
                          sensitivity,
                          thresholdSigma: SENSITIVITY_THRESHOLD[sensitivity],
                        });
                      }}
                    >
                      <option value="conservative">保守（只处理非常明显的异常）</option>
                      <option value="balanced">平衡</option>
                      <option value="aggressive">激进（更灵敏）</option>
                    </select>
                  </Field>
                  <Field label="异常识别阈值 / σ">
                    <input
                      type="number"
                      min={2.5}
                      max={10}
                      step={0.1}
                      value={active.parameters.thresholdSigma}
                      onChange={(event) =>
                        patchParameters({ thresholdSigma: Number(event.target.value) })
                      }
                    />
                  </Field>
                  <Field label="Hampel 窗口 / 点">
                    <select
                      value={active.parameters.windowSize}
                      onChange={(event) =>
                        patchParameters({ windowSize: Number(event.target.value) })
                      }
                    >
                      {[5, 7, 9, 11, 13, 15].map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="最多连续修复 / 点">
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={active.parameters.maxRepairRun}
                      onChange={(event) =>
                        patchParameters({ maxRepairRun: Number(event.target.value) })
                      }
                    />
                  </Field>
                  <Field label="主峰额外保护边界 / nm">
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={active.parameters.protectExtraNm}
                      onChange={(event) =>
                        patchParameters({ protectExtraNm: Number(event.target.value) })
                      }
                    />
                  </Field>
                  <Field label="散射区间半宽 / nm">
                    <input
                      type="number"
                      min={0.5}
                      max={20}
                      step={0.5}
                      value={active.parameters.scatteringToleranceNm}
                      onChange={(event) =>
                        patchParameters({ scatteringToleranceNm: Number(event.target.value) })
                      }
                    />
                  </Field>
                </div>
                <div className="assistant-range-grid">
                  <RangeEditor
                    label="手动目标保护区"
                    value={active.parameters.userProtectedRange}
                    onChange={(value) => patchParameters({ userProtectedRange: value })}
                  />
                  <RangeEditor
                    label="重分析区间"
                    value={active.parameters.analysisRange}
                    onChange={(value) => patchParameters({ analysisRange: value })}
                  />
                </div>
                <div className="assistant-toggle-grid">
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={active.parameters.protectMainPeak}
                      onChange={(event) =>
                        patchParameters({ protectMainPeak: event.target.checked })
                      }
                    />
                    自动保护主发射峰
                  </label>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={active.parameters.repairSpikes}
                      onChange={(event) =>
                        patchParameters({ repairSpikes: event.target.checked })
                      }
                    />
                    对孤立异常点做局部插值
                  </label>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={active.parameters.maskScattering}
                      onChange={(event) =>
                        patchParameters({ maskScattering: event.target.checked })
                      }
                    />
                    屏蔽未与保护区重叠的散射候选
                  </label>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={active.parameters.maskUnrepairable}
                      onChange={(event) =>
                        patchParameters({ maskUnrepairable: event.target.checked })
                      }
                    />
                    无法可靠修复的连续区间设为屏蔽
                  </label>
                </div>
                <div className="assistant-actions">
                  <button className="primary" onClick={() => recompute(active.id)}>
                    <RefreshCw size={16} /> 重新生成结果
                  </button>
                  <button
                    onClick={() =>
                      recompute(active.id, {
                        parameters: { ...DEFAULT_ASSISTANT_PARAMETERS },
                        subtractBlank: false,
                        blankSameConditions: false,
                      })
                    }
                  >
                    恢复默认参数
                  </button>
                  {stale && (
                    <span className="assistant-stale">
                      参数已变化，当前显示的是旧结果；重新生成并重新确认后才能导出或同步。
                    </span>
                  )}
                </div>
                {active.processError && <ErrorNote>{active.processError}</ErrorNote>}
              </section>

              {result && <AssistantRecords result={result} />}

              {result && (
                <section className="assistant-card" aria-label="质量检查">
                  <div className="assistant-section-head">
                    <div>
                      <h3>质量检查</h3>
                      <p>检查行数、主峰保留、屏蔽与修复边界，以及空白和散射处理。</p>
                    </div>
                  </div>
                  <ul className="assistant-checks">
                    {result.checks.map((check) => (
                      <li key={check.key} className={check.status}>
                        <span className="assistant-check-icon">
                          {check.status === 'pass' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                        </span>
                        <div>
                          <strong>{check.label}</strong>
                          <p>{check.detail}</p>
                        </div>
                        <small>{check.status === 'pass' ? '通过' : check.status === 'warn' ? '注意' : '失败'}</small>
                      </li>
                    ))}
                  </ul>
                  {result.warnings.length > 0 && (
                    <ul className="assistant-warnings">
                      {result.warnings.map((warning, index) => (
                        <li key={index}><AlertTriangle size={14} /> {warning}</li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              <section className="assistant-card assistant-result-actions" aria-label="结果操作">
                <div className="assistant-section-head">
                  <div>
                    <h3>结果操作</h3>
                    <p>只有确认后的同一份处理结果才允许导出或同步；Excel 与 Sheet 使用相同数值。</p>
                  </div>
                  <span className={`assistant-confirm-badge ${confirmed ? 'confirmed' : ''}`}>
                    {confirmed ? '已确认' : '未确认'}
                  </span>
                </div>
                <div className="assistant-actions">
                  <button className="primary" disabled={!canConfirm} onClick={() => {
                    if (confirmActive()) addMessage(active.id, 'assistant', '已确认当前处理结果。');
                  }}>
                    <CheckCircle2 size={16} /> 确认处理结果
                  </button>
                  <button disabled={!confirmed || active.exporting} onClick={() => void exportActive()}>
                    {active.exporting ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
                    导出 Excel
                  </button>
                  <button disabled={!confirmed || active.syncing} onClick={() => syncActive('auto')}>
                    {active.syncing ? <Loader2 className="spin" size={16} /> : <Layers3 size={16} />}
                    {syncLabel}
                  </button>
                  {active.sync && syncedCurrent && (
                    <button disabled={!confirmed || active.syncing} onClick={() => syncActive('new-version')}>
                      创建新版本
                    </button>
                  )}
                  {active.sync && !syncedCurrent && (
                    <button disabled={!confirmed || active.syncing} onClick={() => syncActive('update')}>
                      更新已同步 Sheet
                    </button>
                  )}
                </div>
                <label className="check-line assistant-autosync">
                  <input
                    type="checkbox"
                    checked={autoSync}
                    onChange={(event) => setAutoSync(event.target.checked)}
                  />
                  确认处理后自动同步（单文件创建新 Sheet；批量按所选导入方式同步）
                </label>
                {!canConfirm && (
                  <p className="assistant-note">
                    {stale
                      ? '参数已变化，请先重新生成结果。'
                      : result?.checks.some((check) => check.status === 'fail')
                        ? '质量检查存在失败项，暂不能确认。'
                        : '请先完成解析并生成处理结果。'}
                  </p>
                )}
                {active.sync && (
                  <div className="assistant-sync-note">
                    <CheckCircle2 size={16} />
                    <span>
                      已同步到 Sheet「{active.sync.sheetName}」· {active.sync.at}
                      {' '}
                      <button className="text-button" onClick={onOpenWorkspace}>
                        前往光谱工作台查看 <ArrowRight size={14} />
                      </button>
                    </span>
                  </div>
                )}
                {active.actionError && <ErrorNote>{active.actionError}</ErrorNote>}
              </section>
            </>
          )}
        </>
      )}

      {!active?.parse && <>
        {!active && <AssistantAiSettings consent={consent} onConsentChange={setConsent} />}
        {chatPanel}
      </>}

      {!entries.length && (
        <div className="assistant-empty">
          <Sparkles size={26} />
          <strong>从一份 F-7100 TXT 开始</strong>
          <p>
            上传后会自动识别元数据、绘制原始光谱、检测孤立异常尖峰与疑似散射，并保护钙钛矿量子点的真实发射峰。
            只有你确认后，结果才会导出或进入 Sheet。
          </p>
        </div>
      )}

      {active?.parse && result && (
        <div className="assistant-bottom-hint">
          <Trash2 size={14} /> 移除文件只影响当前 AI 助手会话，不会删除已同步的 Sheet 或已下载的 Excel。
        </div>
      )}
    </section>
  );
}

function RangeEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { fromNm: number; toNm: number } | null;
  onChange: (value: { fromNm: number; toNm: number } | null) => void;
}) {
  const [from, setFrom] = useState(value?.fromNm.toString() ?? '');
  const [to, setTo] = useState(value?.toNm.toString() ?? '');
  useEffect(() => {
    setFrom(value?.fromNm.toString() ?? '');
    setTo(value?.toNm.toString() ?? '');
  }, [value?.fromNm, value?.toNm]);
  const apply = (nextFrom: string, nextTo: string) => {
    if (!nextFrom.trim() || !nextTo.trim()) {
      onChange(null);
      return;
    }
    const a = Number(nextFrom),
      b = Number(nextTo);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > a)
      onChange({ fromNm: a, toNm: b });
  };
  const invalid =
    !!from.trim() && !!to.trim() && !(Number(from) > 0 && Number(to) > Number(from));
  return (
    <div className="assistant-range-editor">
      <span>{label}</span>
      <div>
        <input
          type="number"
          min={1}
          aria-label={`${label}起点`}
          value={from}
          placeholder="起点 nm"
          aria-invalid={invalid}
          onChange={(event) => {
            setFrom(event.target.value);
            apply(event.target.value, to);
          }}
        />
        <span>–</span>
        <input
          type="number"
          min={1}
          aria-label={`${label}终点`}
          value={to}
          placeholder="终点 nm"
          aria-invalid={invalid}
          onChange={(event) => {
            setTo(event.target.value);
            apply(from, event.target.value);
          }}
        />
        <small>{invalid ? '终点必须大于起点' : '留空表示不限制'}</small>
      </div>
    </div>
  );
}
