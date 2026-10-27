import { describe, expect, it } from 'vitest';
import { analyzeRecognition, defaultRecognition, demoRecognition, quenching } from '../src/domain/recognition-v0.9.1-2026.10.27';
import {
  applyRecognitionInput, insertRecognitionInput, moveRecognitionInput, prepareRecognitionPaste,
  recognitionInputGrid, recognitionInputIssue, recognitionInputOrder, removeRecognitionInput,
} from '../src/domain/recognition-input-v0.9.1-2026.10.27';
import { recognitionTables } from '../src/services/recognition-export-v0.9.1-2026.10.27';
import type { WorksheetColumn } from '../src/domain/worksheet-v0.3.0-2026.10.27';

describe('unified blank and sample input table', () => {
  it('displays legacy records without migrating IDs, values, or the sample matrix', () => {
    const d = demoRecognition(), original = structuredClone(d), before = analyzeRecognition(d);
    const grid = recognitionInputGrid(d);
    expect(grid).toHaveLength(7); expect(grid[0].slice(0, 6)).toEqual(['空白', '批次 1', '', '', '', '1000']);
    expect(grid[1].slice(0, 6)).toEqual(['样品', '批次 1', '演示-1', 'Fe³⁺', '1', '260']);
    const restored = applyRecognitionInput(d, recognitionInputOrder(d), grid);
    expect(restored.rows).toEqual(d.rows); expect(restored.batches).toEqual(d.batches);
    expect(analyzeRecognition(restored).pca).toEqual(before.pca); expect(d).toEqual(original);
  });
  it('keeps sample associations when a referenced blank is renamed', () => {
    const d = demoRecognition(), rows = recognitionInputGrid(d);
    rows[0][1] = '重命名批次';
    const next = applyRecognitionInput(d, recognitionInputOrder(d), rows);
    expect(next.rows.map((r) => r.batchId)).toEqual(d.rows.map((r) => r.batchId));
    expect(quenching(next).q).toEqual(quenching(d).q);
    expect(recognitionInputGrid(next)[1][1]).toBe('重命名批次');
  });
  it('resolves multiple batches and forward references in one atomic paste', () => {
    const d = defaultRecognition();
    const grid = [
      ['样品', '甲', 'S1', 'Fe³⁺', '1', '260', '810', '650'],
      ['空白', '乙', '', '', '', '2000', '1000', '1000'],
      ['样品', '乙', 'S2', 'Cu²⁺', '1', '400', '600', '700'],
      ['空白', '甲', '', '', '', '1000', '1000', '1000'],
    ];
    const next = applyRecognitionInput(d, recognitionInputOrder(d), grid);
    expect(next.rows).toHaveLength(2); expect(next.batches).toHaveLength(2);
    expect(quenching(next).q).toEqual([[0.74, 0.19, 0.35], [0.8, 0.4, 0.3]]);
    expect(recognitionInputGrid(next).map((r) => r[0])).toEqual(['样品', '空白', '样品', '空白']);
    expect(analyzeRecognition(next).pca!.scores).toHaveLength(2);
    expect(d.rows).toEqual([]); expect(d.batches[0].values).toEqual({});
  });
  it('retains hidden rows and IDs when editing a filtered batch', () => {
    let d = insertRecognitionInput(demoRecognition(), 'blank');
    const second = d.batches[1]; second.values = { ...d.batches[0].values };
    d.rows[1] = { ...d.rows[1], batchId: second.id };
    const visible = recognitionInputOrder(d).filter((ref) => ref.type === 'blank' ? ref.id === second.id : d.rows.find((r) => r.id === ref.id)?.batchId === second.id);
    const grid = recognitionInputGrid(d, visible), sample = visible.findIndex((r) => r.type === 'sample');
    grid[sample][5] = '333.123456789';
    const next = applyRecognitionInput(d, visible, grid);
    expect(next.rows[0]).toEqual(d.rows[0]); expect(next.rows).toHaveLength(6); expect(next.batches).toHaveLength(2);
    expect(next.rows[1].values[d.probes[0].id]).toBe('333.123456789');
    expect(next.rows.map((r) => r.id)).toEqual(d.rows.map((r) => r.id));
  });
  it('preserves batch references and correct issue coordinates after moving mixed rows', () => {
    const d = demoRecognition(), order = recognitionInputOrder(d);
    const next = moveRecognitionInput(d, order, 0, 6);
    expect(recognitionInputOrder(next)[6].type).toBe('blank');
    expect(quenching(next).q).toEqual(quenching(d).q);
    expect(recognitionInputIssue(next, { table: 'blank', row: 0, column: 1, reason: '', blocking: true })).toEqual({ row: 6, column: 5 });
    expect(recognitionInputIssue(next, { table: 'raw', row: 0, column: 3, reason: '', blocking: true })).toEqual({ row: 0, column: 1 });
    const restored = JSON.parse(JSON.stringify(next));
    expect(recognitionInputGrid(restored)).toEqual(recognitionInputGrid(next));
  });
  it('blocks removing or converting a referenced blank, including hidden samples', () => {
    const d = demoRecognition(), ref = recognitionInputOrder(d)[0];
    expect(() => removeRecognitionInput(d, ref)).toThrow('仍被样品使用');
    const grid = recognitionInputGrid(d, [ref]); grid[0][0] = '样品'; grid[0][1] = '';
    expect(() => applyRecognitionInput(d, [ref], grid)).toThrow('仍被样品使用');
    expect(d.batches).toHaveLength(1); expect(d.rows).toHaveLength(6);
    const unused = insertRecognitionInput(d, 'blank');
    expect(removeRecognitionInput(unused, { type: 'blank', id: unused.batches[1].id }).batches).toHaveLength(1);
  });
  it('keeps empty drafts and never silently substitutes zeros or deletes cleared samples', () => {
    const d = demoRecognition(), order = recognitionInputOrder(d);
    const next = applyRecognitionInput(d, order, []);
    expect(next.rows).toHaveLength(6); expect(next.batches).toHaveLength(1);
    expect(quenching(next).q[0]).toEqual([null, null, null]);
    expect(analyzeRecognition(next).pca).toBeUndefined();
  });
  it('rejects unknown roles, unknown batches and metadata in blank rows atomically', () => {
    const d = demoRecognition(), before = structuredClone(d), order = recognitionInputOrder(d);
    const badRole = recognitionInputGrid(d); badRole[1][0] = '未知';
    expect(() => applyRecognitionInput(d, order, badRole)).toThrow('类型');
    const badBatch = recognitionInputGrid(d); badBatch[1][1] = '不存在的批次';
    expect(() => applyRecognitionInput(d, order, badBatch)).toThrow('不存在');
    const badBlank = recognitionInputGrid(d); badBlank[0][2] = '不得丢失的记录';
    expect(() => applyRecognitionInput(d, order, badBlank)).toThrow('请留空');
    expect(d).toEqual(before);
  });
  it('retains duplicate blank records and reports ambiguity rather than overwriting them', () => {
    const d = defaultRecognition();
    const next = applyRecognitionInput(d, recognitionInputOrder(d), [
      ['空白', '甲', '', '', '', '1000', '1000', '1000'],
      ['空白', '甲', '', '', '', '2000', '2000', '2000'],
    ]);
    expect(next.batches).toHaveLength(2);
    expect(analyzeRecognition(next).issues.filter((i) => i.column === 0)).toHaveLength(2);
  });
  it('round-trips the exported unified table with header and provenance columns', () => {
    const d = demoRecognition(), table = recognitionTables(d, analyzeRecognition(d))[0];
    expect(table.name).toBe('实验数据');
    const columns: WorksheetColumn[] = table.headers.slice(0, -2).map((title, i) => ({ key: String(i), title }));
    columns.push({ key: 'delete', title: '删除行', readOnly: true });
    const tsv = [table.headers, ...table.rows].map((r) => r.join('\t')).join('\n');
    const empty = defaultRecognition(), prepared = prepareRecognitionPaste(recognitionInputGrid(empty), columns, { row: 0, column: 0 }, tsv);
    const restored = applyRecognitionInput(empty, recognitionInputOrder(empty), prepared.rows, { kind: 'paste', selection: prepared.selection });
    expect(quenching(restored).q).toEqual(quenching(d).q);
    expect(restored.rows).toHaveLength(6); expect(restored.batches).toHaveLength(1);
    expect(table.rows[0][0]).toBe('空白'); expect(table.rows[1].slice(0, 6)).toEqual(['样品', '批次 1', '演示-1', 'Fe³⁺', '1', 260]);
    expect(() => prepareRecognitionPaste([], columns, { row: 0, column: 0 }, tsv.replace('探针 1', '错位探针'))).toThrow('表头');
    expect(() => prepareRecognitionPaste([], columns, { row: 0, column: 0 }, '类型\t批次\t样本 ID\t离子种类\t平行编号\t探针 1\t探针 2\n空白\t甲\t\t\t\t1000\t1000')).toThrow('表头');
  });
});
