import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeRecognition, asQuenchingInput, demoRecognition, ionColor, recognitionFingerprint, ward } from '../src/domain/recognition-2026.10.27';
import { hierarchySVG } from '../src/domain/recognition-charts-2026.10.27';
import { chemicalRuns, chemicalText, placeIonLabels, scorePlot, scoresSVG, treeStyle } from '../src/domain/recognition-paper-charts-v0.9.2-2026.10.29';
import { APP_VERSION } from '../src/version-v0.9.0-2026.10.27';

describe('paper recognition charts', () => {
  it.each([
    ['Fe³⁺', [{ text: 'Fe', level: 'normal' }, { text: '3+', level: 'super' }]],
    ['Fe3+', [{ text: 'Fe', level: 'normal' }, { text: '3+', level: 'super' }]],
    ['CO₃²⁻', [{ text: 'CO', level: 'normal' }, { text: '3', level: 'sub' }, { text: '2−', level: 'super' }]],
    ['CO3^2-', [{ text: 'CO', level: 'normal' }, { text: '3', level: 'sub' }, { text: '2−', level: 'super' }]],
    ['SO4^{2-}', [{ text: 'SO', level: 'normal' }, { text: '4', level: 'sub' }, { text: '2−', level: 'super' }]],
    ['NH4+', [{ text: 'NH', level: 'normal' }, { text: '4', level: 'sub' }, { text: '+', level: 'super' }]],
  ])('typesets %s with explicit subscripts and charges', (value, runs) => expect(chemicalRuns(value)).toEqual(runs));

  it('escapes free text without inventing a chemical formula', () => {
    expect(chemicalText('离子 <script>')).toBe('离子 &lt;script&gt;');
    expect(chemicalText('样本 123')).toBe('样本 123');
  });

  it('gives larger ion panels distinct default colors and keeps explicit overrides', () => {
    const d = demoRecognition();
    d.rows = Array.from({ length: 500 }, (_, i) => ({ ...d.rows[i % 6], ion: `ion-${i}` }));
    const colors = d.rows.map((row) => ionColor(d, row.ion));
    expect(new Set(colors).size).toBe(500); expect(colors.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
    d.settings.ionColors['ion-20'] = '#123456'; expect(ionColor(d, 'ion-20')).toBe('#123456');
  });

  it('keeps every score and real variance when adding one label per ion', () => {
    const d = demoRecognition(), a = analyzeRecognition(d), before = structuredClone(a);
    const svg = scoresSVG(d, a, { ...d.settings.styles.scores, legend: 'right', grid: true,
      axes: { top: { visible: true }, right: { visible: true } } });
    expect(svg.match(/data-point="true"/g)).toHaveLength(d.rows.length);
    expect(svg.match(/data-ion-label=/g)).toHaveLength(3);
    expect(svg).not.toContain('data-sample-label'); expect(svg).not.toContain('data-legend');
    expect(svg).not.toContain('data-axis="top"'); expect(svg).not.toContain('data-axis="right"');
    expect(svg).not.toContain('#e5ebe9');
    expect(svg).toContain('PC1 (67.45%)'); expect(svg).toContain('PC2 (32.51%)');
    d.rows.forEach((row, i) => expect(scorePlot(d, a).series.flatMap((s) => s.points))
      .toContainEqual(expect.objectContaining({ x: a.pca!.scores[i][0], y: a.pca!.scores[i][1] })));
    expect(a).toEqual(before);
  });

  it('retains alternate axes, distinct shape overrides, colors and numeric hover precision', () => {
    const d = demoRecognition(), a = analyzeRecognition(d), before = recognitionFingerprint(d);
    d.settings.pcX = 2; d.settings.pcY = 0; d.settings.ionColors['Fe³⁺'] = '#123456';
    d.settings.ionShapes = { 'Fe³⁺': 'diamond', 'CO₃²⁻': 'square' }; d.settings.opacity = 0.6;
    const plot = scorePlot(d, a), svg = scoresSVG(d, a, d.settings.styles.scores);
    expect(plot.series[0].pointShape).toBe('diamond'); expect(plot.series[1].pointShape).toBe('square');
    expect(plot.series[2].pointShape).toBe('circle');
    expect(svg).toContain('PC3 (0.04%)'); expect(svg).toContain('opacity="0.6"');
    expect(svg).toContain('fill="#123456"'); expect(svg).toContain(`PC3: ${a.pca!.scores[0][2]}`);
    expect(recognitionFingerprint(d)).toBe(before);
    expect(analyzeRecognition(d).pca).toEqual(a.pca); expect(analyzeRecognition(d).hierarchy).toEqual(a.hierarchy);
  });

  it('places coincident ion labels inside bounds without covering any point or other label', () => {
    const bounds = { x: 40, y: 40, width: 1200, height: 800 };
    const groups = Array.from({ length: 24 }, (_, i) => ({ name: `Fe${i + 1}+`, x: 640, y: 440 }));
    const obstacles = [{ x: 625, y: 425, width: 30, height: 30 }];
    const boxes = placeIonLabels(groups, obstacles, bounds, 30)!;
    expect(boxes).not.toBeNull(); expect(boxes).toHaveLength(groups.length);
    const overlap = (a: typeof bounds, b: typeof bounds) => a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y;
    boxes.forEach((box, i) => {
      expect(box.x).toBeGreaterThanOrEqual(bounds.x); expect(box.y).toBeGreaterThanOrEqual(bounds.y);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      expect(obstacles.some((o) => overlap(box, o))).toBe(false);
      expect(boxes.slice(0, i).some((o) => overlap(box, o))).toBe(false);
    });
    expect(placeIonLabels(groups, obstacles, { ...bounds, width: 10, height: 10 }, 30)).toBeNull();
  });

  it('draws every original merge and leaf with actual Ward heights and no cluster legend', () => {
    const d = demoRecognition(), a = analyzeRecognition(d), before = structuredClone(a.hierarchy);
    const svg = hierarchySVG(d, a, { ...d.settings.styles.tree, legend: 'right' }, false);
    expect(svg.match(/data-leaf=/g)).toHaveLength(d.rows.length);
    expect([...svg.matchAll(/data-leaf="(\d+)"/g)].map((m) => Number(m[1]))).toEqual(a.hierarchy!.order);
    a.hierarchy!.merges.forEach((m, i) => expect(svg).toContain(`data-merge="${i}" data-left="${m.left}" data-right="${m.right}" data-height="${m.height}"`));
    expect(svg).not.toContain('data-legend'); expect(svg).not.toContain('rotate(50');
    expect(svg).toContain('Ward 合并高度'); expect(svg).toContain('样本 ID: 演示-1');
    expect(a.hierarchy).toEqual(before);
    expect(treeStyle({ ...d.settings.styles.tree, xLabel: '样本 / 离子 / 平行编号', yLabel: 'Ward 距离' }))
      .toMatchObject({ xLabel: 'Ward 合并高度', yLabel: '离子' });
  });

  it('preserves all 500 replicates, including zero-height duplicate merges, with legible leaf spacing', () => {
    const d = demoRecognition();
    d.rows = Array.from({ length: 500 }, (_, i) => ({ ...d.rows[i % 6], id: `row-${i}`, sample: `sample-${i}` }));
    const hierarchy = ward(d.rows.map((_, i) => [i % 6, (i % 6) ** 2]));
    const a = { ...analyzeRecognition(d), hierarchy };
    const svg = hierarchySVG(d, a, d.settings.styles.tree, false);
    expect(svg.match(/data-leaf=/g)).toHaveLength(500); expect(svg.match(/data-merge=/g)).toHaveLength(499);
    expect(hierarchy.merges.some((m) => m.height === 0)).toBe(true);
    expect(Number(svg.match(/height="([\d.]+)"/)![1])).toBeGreaterThanOrEqual(500 * 28);
  });

  it('retains heatmap geometry, labels and colors when only paper styles change', () => {
    const d = demoRecognition(), a = analyzeRecognition(d);
    const before = hierarchySVG(d, a, d.settings.styles.heatmap, true);
    d.settings.styles.scores.fontSize = 30; d.settings.styles.tree.fontFamily = 'Times New Roman';
    d.settings.ionShapes = { 'Fe³⁺': 'triangle' }; d.settings.chartLayout = 'paired';
    expect(hierarchySVG(d, analyzeRecognition(d), d.settings.styles.heatmap, true)).toBe(before);
  });

  it('upgrades saved paper styles once, preserving custom settings, source rows and numerical results', () => {
    const d = demoRecognition(), before = analyzeRecognition(d);
    delete d.settings.paperStyleVersion;
    d.settings.styles.scores = { ...d.settings.styles.scores, title: '原有标题', fontFamily: 'Times New Roman',
      fontSize: 22, lineWidth: 2.4, xMin: '-10', widthCm: 12, legend: 'right', grid: true };
    d.settings.styles.tree.xLabel = '样本 / 离子 / 平行编号'; d.settings.styles.tree.yLabel = 'Ward 距离';
    const original = structuredClone(d), upgraded = asQuenchingInput(d);
    expect(d).toEqual(original); expect(upgraded.rows).toEqual(original.rows);
    expect(upgraded.settings.styles.scores).toMatchObject({ title: '原有标题', fontFamily: 'Times New Roman',
      fontSize: 22, lineWidth: 1.1, xMin: '-10', widthCm: 12, legend: 'none', grid: false });
    expect(upgraded.settings.styles.tree).toMatchObject({ fontFamily: 'Times New Roman', fontSize: 22,
      lineWidth: 1.1, xLabel: 'Ward 合并高度', yLabel: '离子' });
    expect(upgraded.settings.styles.loadings).toEqual(original.settings.styles.loadings);
    expect(upgraded.settings.styles.heatmap).toEqual(original.settings.styles.heatmap);
    expect(asQuenchingInput(upgraded)).toBe(upgraded);
    expect(analyzeRecognition(upgraded).pca).toEqual(before.pca);
    expect(analyzeRecognition(upgraded).hierarchy).toEqual(before.hierarchy);
  });

  it('uses the branch release in the package, current app and worksheet entry points', () => {
    const packageData = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(APP_VERSION).toBe('0.9.2'); expect(packageData.version).toBe(APP_VERSION);
    for (const file of ['../index.html', '../worksheet-v0.2.0-2026.10.19.html'])
      expect(readFileSync(new URL(file, import.meta.url), 'utf8')).toContain(`v${APP_VERSION}`);
  });
});
