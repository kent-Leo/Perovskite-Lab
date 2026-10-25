import type { Workspace } from '../state/workspace';
import {
  createSheetWithPayload,
  switchSheet,
  workbookOf,
  writeSheetPayload,
  type RawSheetPayload,
} from '../domain/workbook';
import {
  palette,
  uid,
  type ColumnMetadata,
  type Point,
  type Spectrum,
} from '../domain/types';
import {
  assistantProcessedRows,
  type AssistantAudit,
  type AssistantExportInput,
} from './assistant-export-2026.10.25';
import type {
  AssistantPoint,
  AssistantProcessingResult,
} from '../domain/assistant-processing-2026.10.25';
import type { ParsedSpectrumFile } from './f7100-2026.10.25';

export interface AssistantSheetBuildInput {
  parsed: ParsedSpectrumFile;
  result: AssistantProcessingResult;
  audit: AssistantAudit;
  unit: string;
  fallbackExcitation?: string;
}

export interface AssistantSheetBundle {
  payload: RawSheetPayload;
  metadata: Record<string, ColumnMetadata>;
  originalSpectrumId: string;
  processedSpectrumId: string;
  processedPoints: number;
}

const STATUS_LABEL: Record<AssistantPoint['status'], string> = {
  normal: '正常',
  repaired: '已修复',
  masked: '已屏蔽',
  unresolved: '仅标记',
};
const KIND_LABEL: Record<NonNullable<AssistantPoint['anomalyKind']>, string> = {
  'positive-spike': '孤立正异常尖峰',
  'negative-spike': '孤立负异常尖峰',
  scattering: '疑似散射干扰',
  unrepairable: '连续异常区间',
};

export function baseAiSheetName(fileName: string, version = 1) {
  const base = fileName.replace(/\.[^.]+$/, '').trim() || '光谱';
  const suffix = version > 1 ? `_AI处理 v${version}` : '_AI处理';
  return `${base.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
}

function originalSpectrum(points: Point[], name: string, source: string, unit: string): Spectrum {
  return {
    id: uid(),
    name,
    role: 'target',
    concentration: '',
    unit,
    color: palette[0],
    visible: true,
    points,
    source,
  };
}

function processedSpectrum(
  points: Point[],
  name: string,
  source: string,
  unit: string,
): Spectrum {
  return {
    id: uid(),
    name,
    role: 'target',
    concentration: '',
    unit,
    color: palette[1],
    visible: true,
    points,
    source,
  };
}

/** Converts one confirmed result into a normal editable raw-workbook sheet. */
export function buildAssistantSheetBundle(input: AssistantSheetBuildInput): AssistantSheetBundle {
  const { parsed, result, audit, unit } = input;
  const source = `AI光谱助手 / ${parsed.fileName} / ${audit.exportedOn || '未记录日期'}`;
  const base = parsed.fileName.replace(/\.[^.]+$/, '');
  const originalPoints = result.points.map((point) => ({ x: point.x, y: point.original }));
  const processedPoints = result.points
    .filter((point) => !point.deleted && point.processed !== null)
    .map((point) => ({ x: point.x, y: point.processed as number }));
  const original = originalSpectrum(originalPoints, `${base} · 原始`, source, unit);
  const processed = processedSpectrum(processedPoints, `${base} · AI处理`, source, unit);
  const rows = assistantProcessedRows(input).map((row) => [
    String(row.波长_nm),
    String(row.原始强度),
    row.处理后强度 === '' ? '' : String(row.处理后强度),
    row.异常标记,
    row.处理方法,
  ]);
  const grid = [
    ['波长 / nm', '原始强度', '处理后强度', '异常标记', '处理方法'],
    ...rows,
  ];
  const payload: RawSheetPayload = {
    grid,
    mapping: {
      kind: 'wide',
      start: 1,
      header: true,
      x: 0,
      ys: [1, 2],
      name: 0,
      concentration: 0,
      unit,
    },
    spectra: [original, processed],
    rawSpectra: [
      { ...original, points: originalPoints },
      { ...processed, points: processedPoints },
    ],
    rawColumnSpectra: {
      'raw-1': original.id,
      'raw-2': processed.id,
    },
    excitation:
      input.audit.excitationNm !== null
        ? String(input.audit.excitationNm)
        : input.parsed.metadata.excitationNm !== null
          ? String(input.parsed.metadata.excitationNm)
          : (input.fallbackExcitation ?? ''),
  };
  const metadata: Record<string, ColumnMetadata> = {
    'raw-0': { title: '波长', unit: 'nm' },
    'raw-1': { title: '原始强度', unit: 'a.u.', color: original.color },
    'raw-2': { title: '处理后强度', unit: 'a.u.', color: processed.color },
    'raw-3': { title: '异常标记', comment: '正常 / 已修复 / 已屏蔽 / 仅标记' },
    'raw-4': { title: '处理方法', comment: '逐点算法与理由见 Excel 杂峰处理记录' },
  };
  return {
    payload,
    metadata,
    originalSpectrumId: original.id,
    processedSpectrumId: processed.id,
    processedPoints: processedPoints.length,
  };
}

export interface SyncAssistantResultOptions {
  mode: 'create' | 'update';
  /** Existing sheet to replace; required for update mode. */
  targetSheetId?: string;
  sheetName: string;
}

export interface SyncAssistantResultOutcome {
  patch: Partial<Workspace>;
  sheetId: string;
  sheetName: string;
  created: boolean;
}

/**
 * Writes the confirmed result into the raw workbook. Create mode never
 * overwrites an existing sheet; update mode replaces only the chosen sheet.
 * Excel and the Sheet read the same `result` object.
 */
export function syncAssistantResult(
  w: Workspace,
  input: AssistantSheetBuildInput,
  options: SyncAssistantResultOptions,
): SyncAssistantResultOutcome {
  const bundle = buildAssistantSheetBundle(input);
  if (options.mode === 'update') {
    if (!options.targetSheetId) throw new Error('请选择要更新的 Sheet');
    const wb = workbookOf(w, 'raw');
    const tab = wb.tabs.find((entry) => entry.id === options.targetSheetId);
    if (!tab) throw new Error('目标 Sheet 已不存在，请重新创建');
    const written = writeSheetPayload(w, 'raw', tab.id, bundle.payload);
    const switched = switchSheet({ ...w, ...written }, 'raw', tab.id);
    return {
      patch: {
        ...written,
        ...switched,
        demo: false,
        sheetMetadata: { ...w.sheetMetadata, [tab.id]: bundle.metadata },
      },
      sheetId: tab.id,
      sheetName: tab.name,
      created: false,
    };
  }
  const patch = createSheetWithPayload(w, 'raw', options.sheetName, bundle.payload);
  const tabs = patch.workbooks?.raw?.tabs ?? workbookOf(w, 'raw').tabs;
  const activeId = patch.workbooks?.raw?.activeId ?? tabs.at(-1)!.id;
  const createdTab = tabs.find((tab) => tab.id === activeId) ?? tabs.at(-1)!;
  return {
    patch: {
      ...patch,
      demo: false,
      sheetMetadata: { ...w.sheetMetadata, [createdTab.id]: bundle.metadata },
    },
    sheetId: createdTab.id,
    sheetName: createdTab.name,
    created: true,
  };
}

/** AI-created sheet names for one source file, used to offer update/new-version. */
export function aiSheetsForFile(w: Workspace) {
  return workbookOf(w, 'raw').tabs
    .filter((tab) => /_AI处理(?: v\d+)?$/.test(tab.name))
    .map((tab) => ({ id: tab.id, name: tab.name }));
}
