import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { validateBatchOperation, validateChatReply, validateChatContext, type BatchEdit, type BatchEditOperation } from '../shared/ai-chat-2026.10.25';
import { previewBatchEdit, commitBatchEdit, undoBatchEdit, replayBatchEdits, type BatchDocument } from '../src/domain/assistant-batch-edit';
import { processAssistantSpectrum, DEFAULT_ASSISTANT_PARAMETERS } from '../src/domain/assistant-processing-2026.10.25';
import { parseSpectrumText } from '../src/services/f7100-2026.10.25';
import { buildChatContext } from '../src/domain/assistant-context-2026.10.25';
import { buildAssistantBatchWorkbook, buildAssistantWorkbook, uniqueExcelSheetName } from '../src/services/assistant-export-2026.10.25';
import { buildAssistantSheetBundle } from '../src/services/assistant-sheet-2026.10.25';

const parsed = ['A.TXT', 'B.TXT', 'C.csv'].map(name => parseSpectrumText('nm,Data\n' + Array.from({ length: 301 }, (_, i) => `${300+i},${10 + 500 * Math.exp(-0.5 * ((300+i-520)/8)**2)}`).join('\n'), name));
const docs: BatchDocument[] = parsed.map((p,i) => ({ id: `file-${i}`, name: p.fileName, version: `v-${i}`,
  result: processAssistantSpectrum({ points: p.points, rowNumbers: p.rowNumbers, excitationNm: 250,
    subtractBlank: false, blankSameConditions: false, parameters: DEFAULT_ASSISTANT_PARAMETERS }) }));
const deletion: BatchEdit = { type: 'delete-range', fromNm: 350, toNm: 400, reason: '用户要求移除干扰范围' };
const plan = (edits: BatchEdit[] = [deletion], files = docs): BatchEditOperation => ({ type: 'batch-edit', sessionId: 'file-0', revision: files[0].version,
  targets: files.map(d => ({ fileId: d.id, version: d.version })), edits });
const exportInputs = (files: BatchDocument[]) => files.map((d,i) => ({ id: d.id, version: d.version, parsed: parsed[i], result: d.result,
  audit: { fileName: d.name, sheetName: d.name, excitationNm: 250, solvent: '', ai: null, userInstructions: ['批量编辑'], exportedOn: '2026.10.25' } }));
const context = () => ({ ...buildChatContext({ id: docs[0].id, revision: docs[0].version, parse: parsed[0], parameters: DEFAULT_ASSISTANT_PARAMETERS,
  result: docs[0].result, stale: false, confirmed: false, excitationNm: 250, solvent: '', hasBlank: false, subtractBlank: false, blankSameConditions: false }, ''),
  selectedFiles: docs.map(d => ({ id: d.id, name: d.name, version: d.version, scanRange: { fromNm: 300, toNm: 600 }, pointCount: 301,
    summary: { remaining: 301, deleted: 0, masked: 0, maximum: { x: 520, y: 510 } } })) });

describe('batch plan schema and authority', () => {
  it('accepts complete selected-file context and constrained plans', () => {
    expect(validateChatContext(context()).selectedFiles).toHaveLength(3);
    expect(validateChatReply({ reply: '待确认', operation: plan() }, context()).operation).toEqual(plan());
  });
  it.each([
    { edits: [{ ...deletion, fromNm: '350' }] }, { edits: [{ ...deletion, fromNm: 401 }] },
    { edits: [{ ...deletion, intensities: [1,2] }] }, { code: 'eval()' }, { edits: [] },
    { edits: [{ type: 'execute', reason: '任意代码' }] }, { edits: [{ type: 'set-point', wavelengthNm: 410, value: Infinity, reason: 'x' }] },
    { edits: [{ type: 'normalize', fromNm: 350, toNm: 400, target: 0, reason: 'x' }] },
    { targets: [{ fileId: 'file-0', version: 'v-0' }, { fileId: 'file-0', version: 'v-0' }] },
    { edits: [{ ...deletion, allowProtected: true }] }, { edits: [{ ...deletion, reason: '' }] },
  ])('rejects invalid AI fields/types: %j', patch => {
    expect(() => validateBatchOperation({ ...plan(), ...patch })).toThrow();
  });
  it('rejects unselected, missing and stale file targets at model boundary', () => {
    for (const targets of [[...plan().targets, { fileId: 'foreign', version: 'v' }], plan().targets.slice(1),
      plan().targets.map(t => ({ ...t, version: 'old' }))]) {
      expect(() => validateChatReply({ reply: 'x', operation: { ...plan(), targets } }, context())).toThrow();
    }
  });
});

describe('immutable local batch pipeline', () => {
  it('deletes 51 closed-interval rows per file while retaining all 903 original values and source rows', () => {
    const original = structuredClone(docs), preview = previewBatchEdit(docs, plan());
    expect(docs).toEqual(original);
    expect(preview.impacts.map(i => [i.affected,i.deleted])).toEqual([[51,51],[51,51],[51,51]]);
    const committed = commitBatchEdit(docs, preview);
    for (let i=0;i<3;i++) {
      expect(committed[i].result.points.filter(p => !p.deleted)).toHaveLength(250);
      expect(committed[i].result.points.map(p => [p.x,p.original,p.rowNumber])).toEqual(original[i].result.points.map(p => [p.x,p.original,p.rowNumber]));
      expect(committed[i].result.editAudit).toHaveLength(51);
      expect(committed[i].result.editAudit![0]).toMatchObject({ beforeDeleted: false, afterDeleted: true, wavelengthNm: 350 });
    }
    expect(previewBatchEdit(docs, plan()).after).toEqual(committed);
  });
  it('masks rows, edits only exact processed points, and records reasons/before/after', () => {
    const p = previewBatchEdit(docs, plan([{ type: 'mask-range', fromNm: 350, toNm: 400, reason: '屏蔽' },
      { type: 'set-point', wavelengthNm: 410, value: 123.456, reason: '用户指定' }]));
    const after = commitBatchEdit(docs, p);
    after.forEach(d => {
      expect(d.result.points.filter(p => p.processed === null)).toHaveLength(51);
      expect(d.result.points.filter(p => !p.deleted)).toHaveLength(301);
      expect(d.result.points.find(p => p.x === 410)).toMatchObject({ processed: 123.456, original: parsed[0].points[110].y });
      expect(d.result.editAudit!.at(-1)).toMatchObject({ reason: '用户指定', after: 123.456, original: parsed[0].points[110].y });
    });
  });
  it('keeps a closed interval and applies offset, scale, max-absolute normalization in order', () => {
    const p = previewBatchEdit(docs, plan([{ type: 'keep-range', fromNm: 400, toNm: 550, reason: '保留' },
      { type: 'offset', fromNm: 400, toNm: 450, value: -20, reason: '偏移' },
      { type: 'scale', fromNm: 400, toNm: 450, value: 2, reason: '缩放' },
      { type: 'normalize', fromNm: 400, toNm: 450, target: 1, reason: '归一化' }]));
    expect(p.after[0].result.points.filter(p => !p.deleted)).toHaveLength(151);
    expect(p.after[0].result.points.find(p => p.x === 400)!.processed).toBe(-1);
    expect(docs[0].result.points[100].processed).toBe(10);
  });
  it('rejects whole batch on a missing point, range overflow, permissions or changed version', () => {
    const original = structuredClone(docs);
    for (const edits of [[{ type: 'set-point', wavelengthNm: 410.5, value: 1, reason: '不存在' }],
      [{ ...deletion, fromNm: 299 }], [deletion, { type: 'set-point', wavelengthNm: 350, value: 1, reason: '已删除' }]] as BatchEdit[][])
      expect(() => previewBatchEdit(docs, plan(edits))).toThrow();
    expect(() => previewBatchEdit(docs, plan(), ['mask-range'])).toThrow('未授权');
    const preview = previewBatchEdit(docs, plan());
    expect(() => commitBatchEdit(docs.map((d,i) => i===2 ? { ...d, version: 'new' } : d), preview)).toThrow();
    expect(docs).toEqual(original);
  });
  it('rejects a late failure without applying earlier files and rejects non-finite arithmetic', () => {
    const fewer = docs.map((d,i) => i===2 ? { ...d, result: { ...d.result, points: d.result.points.filter(p => p.x !== 410) } } : d);
    expect(() => previewBatchEdit(fewer, plan([{ type: 'set-point', wavelengthNm: 410, value: 2, reason: 'x' }]))).toThrow();
    expect(() => previewBatchEdit(docs, plan([{ type: 'scale', fromNm: 500, toNm: 550, value: 1e100, reason: 'overflow' }]))).toThrow('溢出');
  });
  it('requires separate peak permission, rejects tampered previews', () => {
    const p = previewBatchEdit(docs, plan([{ type: 'set-point', wavelengthNm: 520, value: 2, reason: '指定主峰' }]));
    expect(p.impacts[0].protected).toBe(1);
    expect(() => commitBatchEdit(docs, p)).toThrow('主峰');
    expect(commitBatchEdit(docs, p, true)[0].result.mainPeak!.processedY).toBe(2);
    p.after[0].result.points[0].processed = 999;
    expect(() => commitBatchEdit(docs, p, true)).toThrow('预览');
  });
  it('undo restores all values and rows, appends inverse audit and invalidates old plans; reapply is replayable', () => {
    const p = previewBatchEdit(docs, plan()), after = commitBatchEdit(docs, p), undo = undoBatchEdit(after, p);
    expect(undo[0].result.points).toEqual(docs[0].result.points);
    expect(undo[0].version).not.toBe(docs[0].version);
    expect(undo[0].result.editAudit).toHaveLength(102);
    expect(undo[0].result.editAudit!.at(-1)!.action).toBe('undo');
    expect(() => commitBatchEdit(undo, p)).toThrow();
    expect(() => undoBatchEdit(undo, p)).toThrow();
    const again = previewBatchEdit(undo, plan([deletion], undo));
    expect(commitBatchEdit(undo, again)[0].result.points).toEqual(after[0].result.points);
  });
  it('replays active edits on a new numerical base and retains undo history', () => {
    const p = previewBatchEdit(docs, plan()), after = commitBatchEdit(docs, p);
    const rebased = replayBatchEdits({ ...docs[0], version: 'new-baseline' }, after[0].result);
    expect(rebased.result.points.filter(p => p.deleted)).toHaveLength(51);
    expect(rebased.result.editAudit!.at(-1)!.action).toBe('rebase');
    const undone = undoBatchEdit(after, p);
    expect(replayBatchEdits({ ...docs[0], version: 'new' }, undone[0].result).result.points.some(p => p.deleted)).toBe(false);
  });
});

describe('combined Excel and Sheet parity', () => {
  it('exports three complete samples, deleted vs masked rows, full audit, parameters, and the same Sheet values', async () => {
    const p = previewBatchEdit(docs, plan([deletion, { type: 'mask-range', fromNm: 410, toNm: 411, reason: '屏蔽' },
      { type: 'set-point', wavelengthNm: 420, value: 123, reason: '指定' }]));
    const inputs = exportInputs(commitBatchEdit(docs,p));
    const wb = XLSX.read(await buildAssistantBatchWorkbook(inputs), { type: 'array' });
    expect(wb.SheetNames).toEqual(['汇总_处理后','汇总_原始','A.TXT','B.TXT','C.csv','修改记录','处理参数']);
    const raw = XLSX.utils.sheet_to_json(wb.Sheets['汇总_原始']);
    const processed = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['汇总_处理后'], { defval: '' });
    expect(raw).toHaveLength(903); expect(processed).toHaveLength(750);
    for (const input of inputs) {
      const sheet = buildAssistantSheetBundle({ ...input, unit: 'µM' });
      const rows = processed.filter(r => r.文件ID === input.id);
      expect(sheet.payload.grid.slice(1).map(r => [r[0],r[2]])).toEqual(rows.map(r => [String(r.波长_nm),String(r.处理后强度)]));
      expect(sheet.payload.rawSpectra[0].points).toHaveLength(301);
      expect(sheet.payload.rawSpectra[1].points).toHaveLength(248);
      expect(rows.find(r => r.波长_nm===410)!.处理后强度).toBe('');
      expect(rows.find(r => r.波长_nm===420)!.处理后强度).toBe(123);
    }
    const logs = XLSX.utils.sheet_to_json(wb.Sheets['修改记录']);
    expect(logs.length).toBeGreaterThanOrEqual(162);
    const single = XLSX.read(await buildAssistantWorkbook(inputs[0]), { type: 'array' });
    expect(XLSX.utils.sheet_to_json(single.Sheets['原始数据'])).toHaveLength(301);
    expect(XLSX.utils.sheet_to_json(single.Sheets['处理后数据'])).toHaveLength(250);
  });
  it('sanitizes/truncates names, resolves case collisions and splits every sheet below row limits', async () => {
    const used = new Set<string>();
    const names = ['a'.repeat(50), 'A'.repeat(50), "'bad/[]:*?\\name'", 'History'].map(n => uniqueExcelSheetName(n,used));
    expect(new Set(names.map(n => n.toLowerCase())).size).toBe(4);
    names.forEach(n => { expect(n.length).toBeLessThanOrEqual(31); expect(n).not.toMatch(/[\\/:?*\[\]]/); });
    const wb = XLSX.read(await buildAssistantBatchWorkbook(exportInputs(docs), 200), { type: 'array' });
    for (const name of wb.SheetNames) expect(XLSX.utils.decode_range(wb.Sheets[name]['!ref']!).e.r + 1).toBeLessThanOrEqual(200);
    const originals = wb.SheetNames.filter(n => n.startsWith('汇总_原始')).flatMap(n => XLSX.utils.sheet_to_json(wb.Sheets[n]));
    expect(originals).toHaveLength(903);
  });
});

it('executes against every local row even when the model sees only 384 sampled points', () => {
  const points = Array.from({ length: 1001 }, (_, i) => ({ x: 300 + i / 10, y: i + 1 }));
  const result = processAssistantSpectrum({ points, rowNumbers: points.map((_,i) => i+2), excitationNm: 250,
    subtractBlank: false, blankSameConditions: false, parameters: DEFAULT_ASSISTANT_PARAMETERS });
  const doc = { ...docs[0], result };
  const ctx = buildChatContext({ id: doc.id, revision: doc.version, parse: { ...parsed[0], points }, parameters: DEFAULT_ASSISTANT_PARAMETERS,
    result, stale: false, confirmed: false, excitationNm: 250, solvent: '', hasBlank: false, subtractBlank: false, blankSameConditions: false }, '删除350–375 nm');
  expect(ctx.data.coverage).toBe('sampled'); expect(ctx.data.points.length).toBeLessThanOrEqual(384);
  const preview = previewBatchEdit([doc], plan([{ ...deletion, fromNm: 350, toNm: 375 }], [doc]));
  expect(preview.impacts[0].deleted).toBe(251);
  expect(preview.after[0].result.points.filter(p => !p.deleted)).toHaveLength(750);
});
