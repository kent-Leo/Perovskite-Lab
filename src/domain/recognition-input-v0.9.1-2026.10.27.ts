import { uid } from './types';
import type { CellIssue, RecognitionData } from './recognition-v0.9.1-2026.10.27';
import { pasteWorksheetRange, WORKSHEET_LIMITS, type CellAddress, type CellSelection, type WorksheetColumn } from './worksheet-v0.3.0-2026.10.27';
import { readTextTable } from '../services/import';

export type InputRef = { type: 'blank' | 'sample'; id: string };
export const INPUT_PROBE_START = 5;
const refKey = (ref: InputRef) => `${ref.type}/${ref.id}`;
export const inputTypeLabel = (ref: InputRef) => ref.type === 'blank' ? '空白' : '样品';

/** Resolve persisted display order without copying any measurements. */
export function recognitionInputOrder(d: RecognitionData): InputRef[] {
  const available: InputRef[] = [
    ...d.batches.map((b): InputRef => ({ type: 'blank', id: b.id })),
    ...d.rows.map((r): InputRef => ({ type: 'sample', id: r.id })),
  ];
  const valid = new Set(available.map(refKey)), seen = new Set<string>();
  return [...(d.inputOrder ?? []), ...available].filter((ref) => {
    const key = refKey(ref);
    if (!valid.has(key) || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function recognitionInputGrid(d: RecognitionData, order = recognitionInputOrder(d)): string[][] {
  const batches = new Map(d.batches.map((b) => [b.id, b]));
  const samples = new Map(d.rows.map((r) => [r.id, r]));
  return order.map((ref) => {
    const b = ref.type === 'blank' ? batches.get(ref.id)! : undefined;
    const r = ref.type === 'sample' ? samples.get(ref.id)! : undefined;
    const values = b?.values ?? r!.values;
    return [inputTypeLabel(ref), b ? b.name : batches.get(r!.batchId)?.name ?? r!.batchId,
      r?.sample ?? '', r?.ion ?? '', r?.replicate ?? '',
      ...d.probes.map((p) => values[p.id] ?? ''), ''];
  });
}

function orderedData(d: RecognitionData, inputOrder: InputRef[]): RecognitionData {
  const batches = new Map(d.batches.map((b) => [b.id, b])), samples = new Map(d.rows.map((r) => [r.id, r]));
  return { ...d, inputOrder,
    batches: inputOrder.flatMap((ref) => ref.type === 'blank' && batches.has(ref.id) ? [batches.get(ref.id)!] : []),
    rows: inputOrder.flatMap((ref) => ref.type === 'sample' && samples.has(ref.id) ? [samples.get(ref.id)!] : []),
  };
}

/** Apply the visible rectangle atomically, retaining hidden rows and stable IDs. */
export function applyRecognitionInput(
  d: RecognitionData, visible: InputRef[], grid: string[][],
  change?: { kind: string; selection: CellSelection },
): RecognitionData {
  const previous = recognitionInputGrid(d, visible), replacements: InputRef[] = [];
  const batches = new Map(d.batches.map((b) => [b.id, b]));
  const samples = new Map(d.rows.map((r) => [r.id, r]));
  const pending: { ref: InputRef; token: string; row: number; oldId?: string; touched: boolean }[] = [];
  const count = Math.max(visible.length, grid.length);
  for (let i = 0; i < count; i++) {
    const cells = grid[i] ?? [], old = visible[i];
    if (!old && !cells.some((v) => v.trim())) continue;
    const label = cells[0]?.trim() ?? '';
    const type = /^(空白|blank)$/i.test(label) ? 'blank'
      : /^(样品|样本|sample)$/i.test(label) ? 'sample' : !label ? old?.type ?? 'sample' : null;
    if (!type) throw new Error(`第 ${i + 1} 行类型须为“空白”或“样品”`);
    const ref: InputRef = { type, id: old?.type === type ? old.id : uid() };
    replacements.push(ref);
    if (old && refKey(old) !== refKey(ref)) {
      if (old.type === 'blank') batches.delete(old.id); else samples.delete(old.id);
    }
    const values = Object.fromEntries(d.probes.map((p, j) => [p.id, cells[j + INPUT_PROBE_START] ?? '']));
    if (type === 'blank') {
      if (cells.slice(2, INPUT_PROBE_START).some((v) => v.trim() && v.trim() !== '—'))
        throw new Error(`第 ${i + 1} 行为空白，样本 ID、离子和平行编号请留空`);
      batches.set(ref.id, { id: ref.id, name: cells[1] ?? '', values });
    } else {
      const oldSample = old?.type === 'sample' ? samples.get(old.id) : undefined;
      samples.set(ref.id, { id: ref.id, sample: cells[2] ?? '', ion: cells[3] ?? '', replicate: cells[4] ?? '', batchId: '', values });
      const selection = change?.selection;
      const touched = !!selection && change?.kind !== 'edit'
        && i >= Math.min(selection.anchor.row, selection.focus.row)
        && i <= Math.max(selection.anchor.row, selection.focus.row)
        && Math.min(selection.anchor.column, selection.focus.column) <= 1
        && Math.max(selection.anchor.column, selection.focus.column) >= 1;
      pending.push({ ref, token: cells[1] ?? '', row: i, oldId: oldSample?.batchId,
        touched: touched || !oldSample || cells[1] !== previous[i]?.[1] });
    }
  }
  // Resolve after all blank rows, including forward references in one Excel paste.
  for (const item of pending) {
    let batchId = item.oldId ?? '';
    if (item.touched) {
      const token = item.token.trim();
      const matches = [...batches.values()].filter((b) => b.id === token || b.name.trim() === token);
      if (token && matches.length !== 1)
        throw new Error(`第 ${item.row + 1} 行批次“${token}”${matches.length ? '重复' : '不存在'}，请在同表保留一行对应空白`);
      batchId = matches[0]?.id ?? '';
    }
    samples.set(item.ref.id, { ...samples.get(item.ref.id)!, batchId });
  }
  for (const b of d.batches) {
    if (!batches.has(b.id) && [...samples.values()].some((r) => r.batchId === b.id))
      throw new Error('该空白仍被样品使用，请先为相关样品选择其他批次');
  }
  let cursor = 0;
  const visibleKeys = new Set(visible.map(refKey)), order: InputRef[] = [];
  const all = recognitionInputOrder(d);
  for (const ref of all) {
    if (visibleKeys.has(refKey(ref))) { if (replacements[cursor]) order.push(replacements[cursor++]); }
    else order.push(ref);
  }
  order.push(...replacements.slice(cursor));
  return orderedData({ ...d, batches: [...batches.values()], rows: [...samples.values()] }, order);
}

export function insertRecognitionInput(d: RecognitionData, type: InputRef['type'], at?: number, batchId?: string): RecognitionData {
  const ref = { type, id: uid() }, order = recognitionInputOrder(d);
  order.splice(Math.max(0, Math.min(at ?? order.length, order.length)), 0, ref);
  if (type === 'blank') {
    let n = 1;
    while (d.batches.some((b) => b.name === `批次 ${n}`)) n++;
    return orderedData({ ...d, batches: [...d.batches, { id: ref.id, name: `批次 ${n}`, values: {} }] }, order);
  }
  return orderedData({ ...d, rows: [...d.rows, { id: ref.id, sample: '', ion: '', replicate: '',
    batchId: batchId ?? (d.batches.length === 1 ? d.batches[0].id : ''), values: {} }] }, order);
}

export function removeRecognitionInput(d: RecognitionData, ref: InputRef): RecognitionData {
  if (ref.type === 'blank' && d.rows.some((r) => r.batchId === ref.id))
    throw new Error('该空白仍被样品使用，请先为相关样品选择其他批次');
  return orderedData(d, recognitionInputOrder(d).filter((r) => refKey(r) !== refKey(ref)));
}

export function moveRecognitionInput(d: RecognitionData, visible: InputRef[], from: number, to: number): RecognitionData {
  const next = [...visible];
  if (!next[from] || !next[to]) return d;
  next.splice(to, 0, next.splice(from, 1)[0]);
  const keys = new Set(visible.map(refKey)); let i = 0;
  return orderedData(d, recognitionInputOrder(d).map((ref) => keys.has(refKey(ref)) ? next[i++] : ref));
}

export function recognitionInputIssue(d: RecognitionData, issue: CellIssue, order = recognitionInputOrder(d)): CellAddress {
  const id = issue.table === 'blank' ? d.batches[issue.row]?.id : d.rows[issue.row]?.id;
  return { row: order.findIndex((ref) => ref.id === id && ref.type === (issue.table === 'blank' ? 'blank' : 'sample')),
    column: issue.table === 'blank' ? issue.column === 0 ? 1 : issue.column + 4
      : issue.column < 3 ? issue.column + 2 : issue.column === 3 ? 1 : issue.column + 1 };
}

/** Accept the exported header and provenance columns as well as plain TSV data. */
export function prepareRecognitionPaste(rows: string[][], columns: WorksheetColumn[], at: CellAddress, text: string) {
  if (new TextEncoder().encode(text).byteLength > WORKSHEET_LIMITS.bytes) throw new Error('粘贴数据超过 20 MB，请分批粘贴');
  if (at.column === 0 && /^类型[\t,]/.test(text)) {
    const parsed = readTextTable(text, text.includes('\t') ? '\t' : ',').rows;
    const header = parsed[0].map(String), dataWidth = columns.length - 1;
    if (header.length < dataWidth || header[1] !== '批次' || header.slice(0, dataWidth).some((v, i) => v !== columns[i].title))
      throw new Error('粘贴表头与当前探针列不一致，请先调整探针名称和顺序');
    const extra = header.slice(dataWidth);
    if (extra.length && (extra.length !== 2 || extra[0] !== '批次 ID' || extra[1] !== '记录 ID'))
      throw new Error('粘贴表包含未知列，请只保留实验数据列或导出的对应关系 ID 列');
    // JSON quoting preserves tabs/newlines in user labels for the table parser.
    text = parsed.slice(1).map((r) => r.slice(0, dataWidth).map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join('\t')).join('\n');
  }
  return pasteWorksheetRange(rows, columns.map((c, i) => i === 0 ? { ...c, type: 'text' } : c), at, text);
}
