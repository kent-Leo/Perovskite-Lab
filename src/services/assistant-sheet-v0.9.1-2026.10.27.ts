import type { Workspace } from '../state/workspace';
import {
  createSheetWithPayload,
  sheetSnapshots,
  switchSheet,
  workbookOf,
  writeSheetPayload,
  type RawSheetPayload,
} from '../domain/workbook';
import {
  palette,
  uid,
  type ColumnMetadata,
  type Spectrum,
} from '../domain/types';
import type { AssistantAudit } from './assistant-export-v0.9.1-2026.10.27';
import type {
  AssistantProcessingResult,
} from '../domain/assistant-processing-v0.9.1-2026.10.27';
import type { ParsedSpectrumFile } from './f7100-v0.9.1-2026.10.27';

export interface AssistantSheetBuildInput {
  sourceId?: string;
  parsed: ParsedSpectrumFile;
  result: AssistantProcessingResult;
  audit: AssistantAudit;
  unit: string;
  fallbackExcitation?: string;
}

export interface AssistantSheetBundle {
  payload: RawSheetPayload & { rawSpectra: Spectrum[] };
  metadata: Record<string, ColumnMetadata>;
  processedSpectrumId: string;
  processedPoints: number;
}

export function baseAiSheetName(fileName: string, version = 1) {
  const base = fileName.replace(/\.[^.]+$/, '').trim() || '光谱';
  const suffix = version > 1 ? `_AI处理 v${version}` : '_AI处理';
  return `${base.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
}

interface ProcessedColumn {
  spectrum: Spectrum;
  values: Map<number, string>;
  metadata?: ColumnMetadata;
}

function assembleSheet(columns: ProcessedColumn[], unit: string, excitation: string): AssistantSheetBundle {
  const wavelengths = [...new Set(columns.flatMap(column => [...column.values.keys()]))].sort((a, b) => a - b);
  const names = new Set<string>();
  const metadata: Record<string, ColumnMetadata> = { 'raw-0': { title: '波长', unit: 'nm' } };
  const spectra = columns.map((column, index) => {
    const base = column.spectrum.name;
    let name = base;
    for (let suffix = 2; names.has(name); suffix++) name = `${base} (${suffix})`;
    names.add(name);
    const color = column.metadata?.color ?? palette[index % palette.length];
    metadata[`raw-${index + 1}`] = { ...column.metadata, title: name, unit: 'a.u.', color };
    return { ...column.spectrum, name, color };
  });
  return {
    payload: {
      grid: [['波长 / nm', ...spectra.map(s => s.name)],
        ...wavelengths.map(x => [String(x), ...columns.map(column => column.values.get(x) ?? '')])],
      mapping: { kind: 'wide', allowEmptyIntensity: true, start: 1, header: true, x: 0, ys: spectra.map((_, i) => i + 1), name: 0, concentration: 0, unit },
      spectra,
      rawSpectra: spectra.map(s => ({ ...s, points: s.points.map(p => ({ ...p })) })),
      rawColumnSpectra: Object.fromEntries(spectra.map((s, i) => [`raw-${i + 1}`, s.id])),
      excitation,
    },
    metadata,
    processedSpectrumId: spectra[0].id,
    processedPoints: spectra.reduce((sum, s) => sum + s.points.length, 0),
  };
}

/** Only confirmed processed values enter the editable spectrum workbook. */
export function buildAssistantSheetBundle(input: AssistantSheetBuildInput): AssistantSheetBundle {
  return buildAssistantSheetsBundle([input]);
}

export function buildAssistantSheetsBundle(inputs: AssistantSheetBuildInput[]): AssistantSheetBundle {
  if (!inputs.length) throw new Error('请选择要导入的文件');
  const columns = inputs.map(({ parsed, result, audit, unit, sourceId }): ProcessedColumn => {
    const retained = result.points.filter(point => !point.deleted);
    return {
      spectrum: {
        id: sourceId ? `assistant-${sourceId}` : uid(), name: parsed.fileName,
        role: 'target', concentration: '', unit, color: palette[0], visible: true,
        source: `AI光谱助手 / ${parsed.fileName} / ${audit.exportedOn || '未记录日期'}`,
        points: retained.filter(p => p.processed !== null).map(p => ({ x: p.x, y: p.processed! })),
      },
      values: new Map(retained.map(p => [p.x, p.processed === null ? '' : String(p.processed)])),
    };
  });
  const excitations = inputs.map(input => String(input.audit.excitationNm ?? input.parsed.metadata.excitationNm ?? input.fallbackExcitation ?? ''));
  return assembleSheet(columns, inputs[0].unit, new Set(excitations).size === 1 ? excitations[0] : '');
}

function columnsFromBundle(bundle: { payload: RawSheetPayload; metadata: AssistantSheetBundle['metadata'] }): ProcessedColumn[] {
  return bundle.payload.mapping.ys.map(index => {
    const id = bundle.payload.rawColumnSpectra[`raw-${index}`];
    const spectrum = bundle.payload.spectra.find(s => s.id === id);
    if (!spectrum) throw new Error('目标 Sheet 的数据列已变化，请创建新 Sheet');
    return {
      spectrum,
      metadata: bundle.metadata[`raw-${index}`],
      values: new Map(bundle.payload.grid.slice(1).filter(row => row[0]?.trim() && Number.isFinite(Number(row[0])))
        .map(row => [Number(row[0]), row[index] ?? ''])),
    };
  });
}

export interface SyncAssistantResultOptions {
  mode: 'create' | 'update';
  preserveOtherSeries?: boolean;
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
  input: AssistantSheetBuildInput | AssistantSheetBuildInput[],
  options: SyncAssistantResultOptions,
): SyncAssistantResultOutcome {
  let bundle = buildAssistantSheetsBundle(Array.isArray(input) ? input : [input]);
  if (options.mode === 'update') {
    if (!options.targetSheetId) throw new Error('请选择要更新的 Sheet');
    const wb = workbookOf(w, 'raw');
    const tab = wb.tabs.find((entry) => entry.id === options.targetSheetId);
    if (!tab) throw new Error('目标 Sheet 已不存在，请重新创建');
    if (options.preserveOtherSeries) {
      const existing = sheetSnapshots(w, 'raw').find(snapshot => snapshot.tab.id === tab.id)!.payload as RawSheetPayload;
      const incoming = columnsFromBundle(bundle);
      const previous = columnsFromBundle({ payload: existing, metadata: w.sheetMetadata?.[tab.id] ?? {} });
      const replacements = new Map(incoming.map(column => [column.spectrum.id, column]));
      const previousIds = new Set(previous.map(column => column.spectrum.id));
      const columns = previous.map(column => {
        const replacement = replacements.get(column.spectrum.id);
        return replacement ? { ...replacement, metadata: column.metadata,
          spectrum: { ...replacement.spectrum, name: column.spectrum.name } } : column;
      })
        .concat(incoming.filter(column => !previousIds.has(column.spectrum.id)));
      bundle = assembleSheet(columns, bundle.payload.mapping.unit,
        existing.excitation === bundle.payload.excitation ? existing.excitation ?? '' : '');
    }
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
