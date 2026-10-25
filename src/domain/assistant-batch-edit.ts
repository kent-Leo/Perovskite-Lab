import { validateBatchOperation, type BatchEdit, type BatchEditOperation } from '../../shared/ai-chat-2026.10.25';
import type { AssistantProcessingResult } from './assistant-processing-2026.10.25';

export interface EditAudit {
  batchId: string; action: 'apply' | 'undo' | 'rebase'; fileId: string; operationIndex: number;
  edit: BatchEdit; wavelengthNm: number; rowNumber: number | null; original: number;
  before: number | null; after: number | null; beforeDeleted: boolean; afterDeleted: boolean; reason: string;
}
export interface BatchDocument { id: string; name: string; version: string; result: AssistantProcessingResult }
export interface BatchImpact { id: string; name: string; affected: number; deleted: number; masked: number; changed: number; protected: number }
export interface BatchPreview {
  plan: BatchEditOperation; before: BatchDocument[]; after: BatchDocument[]; impacts: BatchImpact[];
  fingerprint: string;
}
export const BATCH_PERMISSIONS: readonly BatchEdit['type'][] = ['delete-range', 'mask-range', 'keep-range', 'set-point', 'offset', 'scale', 'normalize'];

/** Stable replay key includes the complete plan and full local data, never model samples. */
export function editRevision(value: unknown) {
  const text = JSON.stringify(value);
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 2246822519); }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
const fingerprint = (docs: BatchDocument[]) => editRevision(docs);

function summarize(result: AssistantProcessingResult): AssistantProcessingResult {
  const live = result.points.filter(p => !p.deleted), peak = result.mainPeak;
  const p = peak ? live.find(p => p.x === peak.originalX) : null;
  return { ...result,
    stats: { ...result.stats, points: live.length, masked: live.filter(p => p.processed === null).length,
      repaired: live.filter(p => p.status === 'repaired').length, unresolved: live.filter(p => p.status === 'unresolved').length,
      protectedPoints: live.filter(p => p.protected).length },
    mainPeak: peak ? { ...peak, processedX: p?.processed == null ? null : p.x, processedY: p?.processed ?? null,
      shiftNm: p?.processed == null ? null : 0,
      heightRatio: p?.processed == null || Math.abs(peak.correctedY) < 1e-12 ? null : p.processed / peak.correctedY } : null,
    checks: result.checks.filter(c => !['rows', 'peak', 'mask', 'repair'].includes(c.key)).concat({
      key: 'manual', label: '人工编辑可追溯', status: 'warn',
      detail: `处理后保留 ${live.length} 行，删除 ${result.points.length - live.length} 行；原始测量值完整保留，主峰改动须单独授权。`,
    }),
  };
}

/** Pure all-or-nothing preview. Deleted rows remain in the immutable audit backing store only. */
export function previewBatchEdit(documents: BatchDocument[], value: unknown,
  permissions: readonly BatchEdit['type'][] = BATCH_PERMISSIONS): BatchPreview {
  const plan = validateBatchOperation(value);
  if (documents.length !== plan.targets.length) throw new Error('必须包含全部所选文件，整批未提交');
  if (new Set(documents.map(d => d.id)).size !== documents.length) throw new Error('本地文件 ID 重复');
  const before = plan.targets.map(t => {
    const d = documents.find(d => d.id === t.fileId);
    if (!d || d.version !== t.version) throw new Error('文件缺失或版本已失效，整批未提交');
    return structuredClone(d);
  });
  const batchId = editRevision(plan), impacts: BatchImpact[] = [];
  const after = before.map(doc => {
    const result = structuredClone(doc.result), audit: EditAudit[] = [];
    const affected = new Set<number>(), protectedRows = new Set<number>();
    const lower = result.points[0]?.x, upper = result.points.at(-1)?.x;
    if (lower === undefined || upper === undefined) throw new Error(`${doc.name}：无测量数据`);
    plan.edits.forEach((edit, operationIndex) => {
      if (!permissions.includes(edit.type)) throw new Error('未授权的编辑操作');
      const from = edit.type === 'set-point' ? edit.wavelengthNm : edit.fromNm;
      const to = edit.type === 'set-point' ? edit.wavelengthNm : edit.toNm;
      if (from < lower || to > upper) throw new Error(`${doc.name}：编辑范围超出实际测量范围`);
      const inRange = result.points.filter(p => !p.deleted && p.x >= from && p.x <= to);
      if (!inRange.length) throw new Error(`${doc.name}：指定范围或波长没有可用测量点`);
      if (edit.type === 'set-point' && inRange.length !== 1) throw new Error(`${doc.name}：指定波长不唯一`);
      const selected = edit.type === 'keep-range' ? result.points.filter(p => !p.deleted && (p.x < from || p.x > to)) : inRange;
      const maximum = edit.type === 'normalize' ? inRange.reduce((m, p) => Math.max(m, Math.abs(p.processed ?? 0)), 0) : 1;
      if (maximum === 0) throw new Error(`${doc.name}：零值或全屏蔽区间不能归一化`);
      for (const p of selected) {
        const old = p.processed, wasDeleted = !!p.deleted;
        if (edit.type === 'delete-range' || edit.type === 'keep-range') p.deleted = true;
        else if (edit.type === 'mask-range') p.processed = null;
        else if (edit.type === 'set-point') p.processed = edit.value;
        else if (p.processed !== null) {
          p.processed = edit.type === 'offset' ? p.processed + edit.value : edit.type === 'scale'
            ? p.processed * edit.value : edit.type === 'normalize' ? p.processed / maximum * edit.target : p.processed;
        }
        if (p.processed !== null && (!Number.isFinite(p.processed) || Math.abs(p.processed) > 1e100))
          throw new Error(`${doc.name}：处理强度溢出`);
        if (old === p.processed && wasDeleted === !!p.deleted) continue;
        affected.add(p.index);
        if (p.protected || p.x === result.mainPeak?.originalX) protectedRows.add(p.index);
        audit.push({ batchId, action: 'apply', fileId: doc.id, operationIndex, edit, wavelengthNm: p.x,
          rowNumber: p.rowNumber, original: p.original, before: old, after: p.processed,
          beforeDeleted: wasDeleted, afterDeleted: !!p.deleted, reason: edit.reason });
        p.status = p.processed === null ? 'masked' : 'normal';
        p.method = `人工编辑：${edit.type}`; p.reason = edit.reason;
      }
    });
    // Always protect the actual raw maximum, including when peak detection found no candidate.
    const maximum = result.points.reduce((a, b) => a.original > b.original ? a : b);
    if (affected.has(maximum.index)) protectedRows.add(maximum.index);
    result.editAudit = [...(result.editAudit ?? []), ...audit];
    result.editPlans = [...(result.editPlans ?? []), { action: 'apply', plan }];
    const next = summarize(result);
    impacts.push({ id: doc.id, name: doc.name, affected: affected.size, protected: protectedRows.size,
      deleted: audit.filter(a => !a.beforeDeleted && a.afterDeleted).length,
      masked: audit.filter(a => a.before !== null && a.after === null && !a.afterDeleted).length,
      changed: new Set(audit.filter(a => !a.afterDeleted && a.after !== null && a.before !== a.after).map(a => a.wavelengthNm)).size });
    return { ...doc, result: next, version: editRevision({ previous: doc.version, plan, result: next }) };
  });
  return { plan, before, after, impacts, fingerprint: fingerprint(before) };
}

export function commitBatchEdit(documents: BatchDocument[], preview: BatchPreview, allowProtected = false): BatchDocument[] {
  const checked = previewBatchEdit(documents, preview.plan);
  if (checked.fingerprint !== preview.fingerprint || fingerprint(checked.after) !== fingerprint(preview.after))
    throw new Error('预览数据或版本已失效，整批未提交');
  if (!allowProtected && checked.impacts.some(i => i.protected)) throw new Error('涉及主峰保护区，需要单独确认风险');
  return checked.after;
}

/** Restores values and row membership, appends inverse audit, and advances versions (no ABA revival). */
export function undoBatchEdit(documents: BatchDocument[], transaction: BatchPreview): BatchDocument[] {
  if (fingerprint(transaction.before) !== transaction.fingerprint) throw new Error('撤销快照已变化');
  return transaction.after.map((after, i) => {
    const current = documents.find(d => d.id === after.id);
    if (!current || current.version !== after.version || fingerprint([current]) !== fingerprint([after]))
      throw new Error('撤销目标版本已失效，整批未提交');
    const before = transaction.before[i];
    const inverse = (after.result.editAudit ?? []).slice(before.result.editAudit?.length ?? 0).reverse().map(a => ({ ...a,
      action: 'undo' as const, before: a.after, after: a.before, beforeDeleted: a.afterDeleted, afterDeleted: a.beforeDeleted,
      reason: `撤销：${a.reason}` }));
    const result = structuredClone(before.result);
    result.editAudit = [...(after.result.editAudit ?? []), ...inverse];
    result.editPlans = [...(after.result.editPlans ?? []), { action: 'undo', plan: transaction.plan }];
    return { ...before, result, version: editRevision({ previous: after.version, action: 'undo', result }) };
  });
}

/** Re-evaluate active human plans on a fresh numerical baseline; failure rejects the new preview. */
export function replayBatchEdits(base: BatchDocument, previous: AssistantProcessingResult): BatchDocument {
  const active: BatchEditOperation[] = [];
  for (const record of previous.editPlans ?? []) {
    if (record.action === 'apply') active.push(record.plan);
    else if (record.action === 'undo') {
      const index = active.map(p => editRevision(p)).lastIndexOf(editRevision(record.plan));
      if (index >= 0) active.splice(index, 1);
    }
  }
  let next = base;
  for (const plan of active) {
    next = previewBatchEdit([next], { ...plan, targets: [{ fileId: base.id, version: next.version }] }).after[0];
  }
  const result: AssistantProcessingResult = { ...next.result,
    editAudit: [...(previous.editAudit ?? []), ...(next.result.editAudit ?? []).map(a => ({ ...a, action: 'rebase' as const }))],
    editPlans: [...(previous.editPlans ?? [])],
  };
  return { ...next, result, version: editRevision({ base: base.version, result }) };
}
