import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  addProbe, analyzeRecognition, cutHierarchy, defaultRecognition, demoRecognition, moveProbe, pca,
  preprocess, quenching, recognitionFingerprint, removeProbe, ward,
} from '../src/domain/recognition-2026.10.27';
import { hierarchySVG, responseColor } from '../src/domain/recognition-charts-2026.10.27';
import { recognitionTables } from '../src/services/recognition-export-2026.10.27';
import { blankWorkspace, demoWorkspace } from '../src/state/workspace';
import { createSheet, createSheetWithPayload, ensureWorkbooks, switchSheet } from '../src/domain/workbook';
import { chartSVG } from '../src/domain/chart';

const ref = JSON.parse(readFileSync(new URL('./fixtures/pca-ward-reference-2026.10.27.json', import.meta.url), 'utf8'));
const sameGroups = (labels: number[]) => labels.map((a) => labels.map((b) => a === b));
const closeMatrix = (a: number[][], b: number[][], digits = 10) => {
  expect(a.length).toBe(b.length);
  a.forEach((row, i) => { expect(row.length).toBe(b[i].length); row.forEach((x, j) => expect(x).toBeCloseTo(b[i][j], digits)); });
};

describe('quenching, stable IDs and complete experimental rows', () => {
  it('retains raw F, positive quenching, percentage and negative enhancement', () => {
    const d = demoRecognition(), q = quenching(d).q;
    expect(q[0][0]).toBe(0.74); expect(q[0][0]! * 100).toBe(74);
    expect(q[4][0]).toBe(-0.21); expect(q[4][0]! * 100).toBe(-21);
    expect(d.rows[0].values[d.probes[0].id]).toBe('260');
    expect(d.rows[4].values[d.probes[0].id]).toBe('1210');
  });
  it.each(['', 'oops', 'Infinity', 'NaN'])('locates invalid F=%s without replacing it', (value) => {
    const d = demoRecognition(), id = d.probes[1].id;
    d.rows[2].values[id] = value;
    const a = analyzeRecognition(d);
    expect(a.issues).toContainEqual(expect.objectContaining({ table: 'raw', row: 2, column: 5, probeId: id, blocking: true }));
    expect(a.q[2][1]).toBeNull(); expect(a.pca).toBeUndefined(); expect(a.hierarchy).toBeUndefined();
    expect(d.rows[2].values[id]).toBe(value);
  });
  it.each(['', 'oops', '0', '-1', 'Infinity'])('locates invalid F₀=%s', (value) => {
    const d = demoRecognition(), id = d.probes[0].id;
    d.batches[0].values[id] = value;
    const a = analyzeRecognition(d);
    expect(a.issues).toContainEqual(expect.objectContaining({ table: 'blank', row: 0, column: 1, blocking: true }));
    expect(a.q[0][0]).toBeNull(); expect(a.pca).toBeUndefined();
  });
  it('keeps measurements and blanks aligned through insert / rename / reorder / delete', () => {
    const original = demoRecognition(), ids = original.probes.map((p) => p.id);
    let d = addProbe(original, 1);
    const newId = d.probes[1].id;
    expect(d.rows[0].values[newId]).toBeUndefined();
    expect(d.rows[0].values[ids[1]]).toBe('810');
    d.probes[2].name = '重命名 Fe³⁺';
    d = moveProbe(d, 2, 0);
    expect(d.probes[0].id).toBe(ids[1]);
    expect(quenching(d).q[0][0]).toBe(0.19);
    d = removeProbe(d, newId);
    d = removeProbe(d, ids[0]);
    expect(d.probes.map((p) => p.id)).toEqual([ids[1], ids[2]]);
    expect(quenching(d).q[0]).toEqual([0.19, 0.35]);
    expect(d.batches[0].values[ids[2]]).toBe('1000');
    expect(original.probes.map((p) => p.id)).toEqual(ids);
    expect(original.rows[0].values[ids[0]]).toBe('260');
  });
  it('uses the explicitly associated batch and recalculates when F or F₀ changes', () => {
    const d = demoRecognition(), id = d.probes[0].id;
    d.batches.push({ id: 'second', name: '第二批次', values: { ...d.batches[0].values, [id]: '2000' } });
    d.rows[0].batchId = 'second';
    expect(quenching(d).q[0][0]).toBe(0.87);
    d.batches.reverse(); d.probes[0].name = '新名称';
    expect(quenching(d).q[0][0]).toBe(0.87);
    d.rows[0].values[id] = '400';
    expect(quenching(d).q[0][0]).toBe(0.8);
    d.batches.find((b) => b.id === 'second')!.values[id] = '1000';
    expect(quenching(d).q[0][0]).toBe(0.6);
  });
  it('never joins separate incomplete rows or silently drops a replicate', () => {
    const d = demoRecognition();
    delete d.rows[0].values[d.probes[0].id]; delete d.rows[1].values[d.probes[1].id];
    expect(analyzeRecognition(d).pca).toBeUndefined(); expect(d.rows).toHaveLength(6);
    const valid = demoRecognition(), before = analyzeRecognition(valid);
    valid.rows.forEach((r, i) => { r.ion = `arbitrary-ion-${i}`; r.sample = `sample-${i}`; r.replicate = `R${i}`; });
    const after = analyzeRecognition(valid);
    expect(after.pca).toEqual(before.pca); expect(after.hierarchy).toEqual(before.hierarchy);
    expect(after.pca!.scores).toHaveLength(6);
  });
  it('requires explicit sample / replicate / batch associations', () => {
    const d = demoRecognition();
    d.rows[0].replicate = ''; d.rows[1].batchId = 'missing';
    expect(analyzeRecognition(d).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 0, column: 2, blocking: true }),
      expect.objectContaining({ row: 1, column: 3, blocking: true }),
    ]));
    d.rows[0] = { ...d.rows[1], id: 'different-row' };
    expect(analyzeRecognition(d).issues.some((issue) => issue.reason.includes('重复'))).toBe(true);
  });
  it('excludes an explicitly unselected probe without filling its missing readings', () => {
    let d = addProbe(demoRecognition());
    expect(analyzeRecognition(d).pca).toBeUndefined();
    d.probes.at(-1)!.selected = false;
    const a = analyzeRecognition(d);
    expect(a.errors).toEqual([]); expect(a.selected).toHaveLength(3);
    expect(a.q[0].at(-1)).toBeNull(); expect(a.pca!.loadings).toHaveLength(3);
    expect(a.pca!.scores).toHaveLength(6);
  });
  it('rejects ambiguous batch names at the exact name cell', () => {
    const d = demoRecognition(); d.batches.push({ ...d.batches[0], id: 'another' });
    const a = analyzeRecognition(d);
    expect(a.pca).toBeUndefined();
    expect(a.issues).toContainEqual(expect.objectContaining({ table: 'blank', row: 1, column: 0, blocking: true }));
  });
});

describe('independent NumPy SVD and SciPy Ward reference', () => {
  it.each(['center', 'zscore'] as const)('matches %s PCA, loadings, scores and full-space Ward', (mode) => {
    const expected = ref[mode], prepared = preprocess(ref.q, mode), actual = pca(prepared.matrix);
    closeMatrix(prepared.matrix, expected.matrix);
    actual.eigenvalues.forEach((value, i) => expect(value).toBeCloseTo(expected.eigenvalues[i], 10));
    actual.explained.forEach((value, i) => expect(value).toBeCloseTo(expected.explained[i], 10));
    const signs = actual.loadings[0].map((_, pc) =>
      actual.loadings.reduce((sum, row, j) => sum + row[pc] * expected.loadings[j][pc], 0) < 0 ? -1 : 1);
    closeMatrix(actual.loadings.map((row) => row.map((x, i) => x * signs[i])), expected.loadings);
    closeMatrix(actual.scores.map((row) => row.map((x, i) => x * signs[i])), expected.scores);
    const reconstructed = actual.scores.map((row) => prepared.means.map((_, j) => row.reduce((sum, x, i) => sum + x * actual.loadings[j][i], 0)));
    closeMatrix(reconstructed, prepared.matrix);
    const h = ward(prepared.matrix);
    closeMatrix(h.merges.map((m) => [m.left, m.right, m.height, m.size]), expected.linkage);
    expect(sameGroups(cutHierarchy(h, 'count', 3))).toEqual(sameGroups(expected.clusters));
    expect(sameGroups(cutHierarchy(h, 'height', 0.5))).toEqual(sameGroups(expected.clusters));
    expect(new Set(h.order).size).toBe(ref.q.length);
    // PC3 is small but real: the full-matrix result must not be replaced by PC1/PC2 distances.
    const truncated = ward(actual.scores.map((r) => r.slice(0, 2)));
    expect(h.merges[0].height).not.toBeCloseTo(truncated.merges[0].height, 8);
  });
  it('does not invent PC2 for rank-one data and rejects zero variance or insufficient input', () => {
    const x = [[1, 2], [2, 4], [3, 6]];
    const a = pca(preprocess(x, 'center').matrix);
    expect(a.rank).toBe(1); expect(a.scores[0]).toHaveLength(1); expect(a.explained[0]).toBeCloseTo(1, 12);
    expect(() => preprocess([[1, 4], [2, 4]], 'center')).toThrow('零方差');
    expect(() => preprocess([[1, 2]], 'zscore')).toThrow('至少');
    expect(() => pca([[1], [2]])).toThrow('2 个有效探针');
  });
  it('makes invalid cut and failed recalculation explicit without old results', () => {
    const d = demoRecognition(); expect(analyzeRecognition(d).pca).toBeDefined();
    d.settings.clusterCount = 100;
    const failed = analyzeRecognition(d);
    expect(failed.errors.join()).toContain('聚类数'); expect(failed.pca).toBeUndefined(); expect(failed.clusters).toBeUndefined();
    expect(() => cutHierarchy(ward(ref.center.matrix), 'height', NaN)).toThrow('非负数');
  });
});

describe('shared results, charts, persistence and old workbook compatibility', () => {
  it('keeps precision and metadata consistent in all exported result tables', () => {
    const d = demoRecognition(), a = analyzeRecognition(d), tables = recognitionTables(d, a);
    expect(tables.map((t) => t.name)).toEqual(['原始强度', '空白与批次', '猝灭率', 'PCA得分', 'PCA载荷', '方差解释率', '聚类结果', 'Ward合并', '分析设置']);
    const q = tables.find((t) => t.name === '猝灭率')!;
    expect(q.rows[0].slice(3, 5)).toEqual([0.74, 74]); expect(q.rows[4].slice(3, 5)).toEqual([-0.21, -21]);
    expect(tables.find((t) => t.name === 'PCA得分')!.rows[0].slice(3)).toEqual(a.pca!.scores[0]);
    d.settings.decimals = 0;
    expect(recognitionTables(d, a).find((t) => t.name === 'PCA得分')!.rows[0].slice(3)).toEqual(a.pca!.scores[0]);
  });
  it('independently applies ion, probe, cluster and diverging heatmap colors', () => {
    const d = demoRecognition(), a = analyzeRecognition(d), before = recognitionFingerprint(d);
    d.probes[0].color = '#112233'; d.settings.ionColors['Fe³⁺'] = '#112233';
    d.settings.clusterColors['1'] = '#aabbcc'; d.settings.heatColors.negative = '#123456';
    expect(recognitionFingerprint(d)).toBe(before);
    expect(analyzeRecognition(d).pca).toEqual(a.pca);
    expect(responseColor(-1, 1, d.settings.heatColors)).toBe('#123456');
    expect(responseColor(0, 1, d.settings.heatColors)).toBe('#ffffff');
    expect(hierarchySVG(d, a, { ...d.settings.styles.tree, title: 'Fe³⁺ 树' }, false)).toContain('#aabbcc');
  });
  it('keeps heatmap values and labels aligned after tree ordering and probe reordering', () => {
    const d = moveProbe(demoRecognition(), 2, 0), a = analyzeRecognition(d);
    const svg = hierarchySVG(d, a, { ...d.settings.styles.heatmap, title: '中文 CO₃²⁻ 热图' }, true);
    for (const row of a.hierarchy!.order) for (const p of a.selected) {
      const j = d.probes.findIndex((probe) => probe.id === p.id);
      expect(svg).toContain(`data-heat-row="${row}" data-probe-id="${p.id}" data-value="${a.q[row][j]}"`);
    }
    expect(svg).toContain('中文 CO₃²⁻ 热图'); expect(svg).toContain('零为色阶中心');
    d.settings.heatmap = 'zscore';
    expect(hierarchySVG(d, a, d.settings.styles.heatmap, true)).toContain(`data-value="${a.standardized![0][0]}"`);
  });
  it('escapes user labels and exports real hover metadata and point shapes', () => {
    const svg = chartSVG({ series: [{ name: 'Fe³⁺', color: '#112233', kind: 'scatter', pointShape: 'diamond', opacity: 0.7, labels: true,
      points: [{ x: 1, y: -1, label: '<script>', tooltip: '样本 A\nCO₃²⁻\nPC1: 1' }] }] }, { ...defaultRecognition().settings.styles.scores, title: 'PCA' });
    expect(svg).toContain('<polygon'); expect(svg).toContain('opacity="0.7"');
    expect(svg).toContain('&lt;script&gt;'); expect(svg).not.toContain('<script>'); expect(svg).toContain('PC1: 1');
  });
  it('migrates old data and round-trips multiple input and result sheets without modifying old pages', () => {
    const old = demoWorkspace(); delete old.recognition;
    if (old.workbooks) delete old.workbooks.recognition;
    let w = ensureWorkbooks(old);
    expect(w.recognition).toEqual(defaultRecognition()); expect(w.spectra).toEqual(old.spectra);
    const d = demoRecognition(); w = { ...w, recognition: d };
    const source = w.workbooks.recognition.activeId;
    w = ensureWorkbooks({ ...w, ...createSheet(w, 'recognition') });
    expect(w.recognition!.rows).toEqual([]);
    w = ensureWorkbooks({ ...w, ...switchSheet(w, 'recognition', source) });
    expect(w.recognition).toEqual(d);
    const table = recognitionTables(d, analyzeRecognition(d))[3];
    w = ensureWorkbooks({ ...w, ...createSheetWithPayload(w, 'recognition', '结果-2026.10.27', { recognition: { ...d,
      snapshot: { table, sourceSheetId: source, sourceName: '来源', sourceFingerprint: recognitionFingerprint(d), capturedAt: '2026.10.27' } } }) });
    const restored = ensureWorkbooks(JSON.parse(JSON.stringify(w)));
    expect(restored.recognition!.snapshot!.table).toEqual(table);
    expect(restored.workbooks.recognition.store[source]).toEqual({ recognition: d });
    expect(restored.spectra).toEqual(old.spectra); expect(restored.objects).toEqual(old.objects); expect(restored.calibration).toEqual(old.calibration);
    expect(blankWorkspace().spectra).toEqual([]);
  });
});
