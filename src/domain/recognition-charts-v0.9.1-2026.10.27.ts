import { escapeXML as esc } from './chart';
import { clusterColor, type RecognitionAnalysis, type RecognitionData } from './recognition-v0.9.1-2026.10.27';
import type { ChartStyle } from './types';

export function responseColor(value: number, limit: number, colors: RecognitionData['settings']['heatColors']): string {
  const t = Math.min(1, Math.abs(value) / (limit || 1));
  const from = colors.zero, to = value < 0 ? colors.negative : colors.positive;
  return '#' + [1, 3, 5].map((i) => Math.round(parseInt(from.slice(i, i + 2), 16) * (1 - t)
    + parseInt(to.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
}
const label = (d: RecognitionData, i: number) => `${d.rows[i].sample} · ${d.rows[i].ion} · 平行 ${d.rows[i].replicate}`;
const textWidth = (value: string, size: number) => [...value].reduce((sum, c) => sum + (c.codePointAt(0)! > 0x2e80 ? 1 : 0.65) * size, 0);

/** One hierarchy supplies every leaf position, label and heat cell index. */
export function hierarchySVG(d: RecognitionData, a: RecognitionAnalysis, style: ChartStyle, heatmap: boolean): string {
  const h = a.hierarchy, clusters = a.clusters;
  if (!h || !clusters) throw new Error('请先修正数据并完成聚类');
  const n = h.size, fs = style.fontSize, probes = a.selected;
  const maxHeight = h.merges.at(-1)!.height || 1;
  const sampleWidth = Math.max(...h.order.map((i) => textWidth(label(d, i), fs)), 80);
  const cellW = Math.max(76, ...probes.map((p) => textWidth(p.name, fs) + 20));
  const leafStep = heatmap ? Math.max(26, fs + 12) : Math.max(32, fs * 2);
  const left = heatmap ? 250 + sampleWidth : 95;
  const legendFont = style.legendFontSize ?? fs, legendRow = legendFont + 12;
  const k = Math.max(...clusters);
  const legendHeight = style.legend === 'none' ? 0 : style.legend === 'bottom'
    ? Math.ceil(k / 4) * legendRow + 20 : 0;
  const legendWidth = style.legend === 'right' ? 160 : 0;
  const W = heatmap ? Math.max(1000, left + probes.length * cellW + 70 + legendWidth)
    : Math.max(1000, left + n * leafStep + 60 + legendWidth);
  const top = heatmap ? Math.max(125, fs * 5) : 90;
  const H = heatmap ? Math.max(480, top + n * leafStep + 150 + legendHeight,
    style.legend === 'right' ? top + k * legendRow + 90 : 0)
    : 530 + sampleWidth * 0.8 + legendHeight;
  const pw = W - left - 60 - legendWidth;
  const ph = heatmap ? n * leafStep : 360;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(style.title)}" font-family="${esc(style.fontFamily)}, Perovskite Lab Sans, sans-serif"><defs></defs><rect width="${W}" height="${H}" fill="#ffffff"/>`];
  const text = (x: number, y: number, value: string, anchor = 'start', size = fs, extra = '') =>
    out.push(`<text x="${x}" y="${y}" fill="#243b39" font-size="${size}" text-anchor="${anchor}" ${extra}>${esc(value)}</text>`);
  const line = (x: number, y: number, x2: number, y2: number, color = '#526764', dashed = false) =>
    out.push(`<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${style.lineWidth}"${dashed ? ' stroke-dasharray="6 4"' : ''}/>`);
  text(W / 2, fs + 18, style.title, 'middle', fs + 5);
  const position: { x: number; y: number; cluster: number }[] = [];
  const treeRight = 230;
  h.order.forEach((row, i) => {
    position[row] = heatmap
      ? { x: treeRight, y: top + (i + 0.5) * leafStep, cluster: clusters[row] }
      : { x: left + (i + 0.5) * pw / n, y: top + ph, cluster: clusters[row] };
  });
  h.merges.forEach((m, i) => {
    const l = position[m.left], r = position[m.right];
    const cluster = l.cluster === r.cluster ? l.cluster : 0;
    const color = cluster ? clusterColor(d, cluster) : '#637573';
    const node = heatmap
      ? { x: treeRight - m.height / maxHeight * 170, y: (l.y + r.y) / 2, cluster }
      : { x: (l.x + r.x) / 2, y: top + ph - m.height / maxHeight * ph, cluster };
    out.push(`<g data-merge="${i}" data-height="${m.height}">`);
    if (heatmap) {
      line(l.x, l.y, node.x, l.y, l.cluster ? clusterColor(d, l.cluster) : color);
      line(r.x, r.y, node.x, r.y, r.cluster ? clusterColor(d, r.cluster) : color);
      line(node.x, l.y, node.x, r.y, color);
    } else {
      line(l.x, l.y, l.x, node.y, l.cluster ? clusterColor(d, l.cluster) : color);
      line(r.x, r.y, r.x, node.y, r.cluster ? clusterColor(d, r.cluster) : color);
      line(l.x, node.y, r.x, node.y, color);
    }
    out.push('</g>'); position[n + i] = node;
  });
  if (d.settings.cutMode === 'height') {
    const height = Number(d.settings.cutHeight);
    if (height <= maxHeight) {
      if (heatmap) { const x = treeRight - height / maxHeight * 170; line(x, top, x, top + ph, '#9b6835', true); }
      else { const y = top + ph - height / maxHeight * ph; line(left, y, left + pw, y, '#9b6835', true); }
    }
  }
  if (heatmap) {
    const indices = probes.map((p) => d.probes.findIndex((all) => all.id === p.id));
    const matrix = d.settings.heatmap === 'q' ? a.q.map((row) => indices.map((j) => row[j]!)) : a.standardized!;
    const limit = Math.max(...matrix.flat().map(Math.abs)) || 1;
    const metric = d.settings.heatmap === 'q' ? '原始 q = (F₀−F)/F₀' : 'Z-score（样本标准差，ddof=1）';
    text(left, top - fs * 2.6, `${metric}；零为色阶中心`, 'start', fs);
    probes.forEach((p, j) => text(left + (j + 0.5) * cellW, top - 12, p.name, 'middle'));
    h.order.forEach((row, i) => {
      const y = top + i * leafStep;
      text(left - 12, y + leafStep / 2 + fs * 0.35, label(d, row), 'end', fs, `data-row-label="${row}"`);
      probes.forEach((probe, j) => {
        const value = matrix[row][j];
        out.push(`<rect data-heat-row="${row}" data-probe-id="${esc(probe.id)}" data-value="${value}" x="${left + j * cellW}" y="${y}" width="${cellW}" height="${leafStep}" fill="${responseColor(value, limit, d.settings.heatColors)}" stroke="#ffffff" stroke-width="0.5"><title>${esc(`${label(d, row)} / ${probe.name}\n${metric}: ${value}`)}</title></rect>`);
        if (style.pointValues) text(left + (j + 0.5) * cellW, y + leafStep / 2 + fs * 0.3,
          value.toFixed(d.settings.decimals), 'middle', Math.min(fs, 12));
      });
    });
    const colorY = top + ph + 55, colorWidth = Math.min(300, pw);
    for (let i = 0; i < 120; i++) out.push(`<rect x="${left + i * colorWidth / 120}" y="${colorY}" width="${colorWidth / 120 + 0.5}" height="14" fill="${responseColor((i / 119 * 2 - 1) * limit, limit, d.settings.heatColors)}"/>`);
    [-limit, 0, limit].forEach((value, i) => text(left + i * colorWidth / 2, colorY + 35, value.toPrecision(3), 'middle', fs * 0.8));
    text(left + probes.length * cellW / 2, top + ph + 32, style.xLabel, 'middle');
    text(20, top + ph / 2, style.yLabel, 'middle', fs, `transform="rotate(-90 20 ${top + ph / 2})"`);
    [0, 0.5, 1].forEach((v) => text(treeRight - v * 170, top - 15, (v * maxHeight).toPrecision(3), 'middle', fs * 0.7));
    text(145, top - 40, 'Ward 距离', 'middle', fs * 0.8);
  } else {
    line(left, top, left, top + ph);
    [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
      const y = top + ph - v * ph;
      text(left - 10, y + fs * 0.3, (v * maxHeight).toPrecision(3), 'end', fs * 0.8);
      if (style.grid) line(left, y, left + pw, y, '#e5ebe9');
    });
    h.order.forEach((row) => {
      const x = position[row].x, y = top + ph + 20;
      text(x, y, label(d, row), 'start', fs, `data-leaf="${row}" transform="rotate(50 ${x} ${y})"`);
    });
    text(left + pw / 2, H - legendHeight - 18, style.xLabel, 'middle');
    text(24, top + ph / 2, style.yLabel, 'middle', fs, `transform="rotate(-90 24 ${top + ph / 2})"`);
  }
  if (style.legend !== 'none') {
    const x = style.legend === 'free' ? Math.min(W - 100, Math.max(10, (style.legendX ?? 0.8) * W))
      : style.legend === 'bottom' ? left : W - legendWidth + 15;
    const y = style.legend === 'free' ? Math.min(H - k * legendRow - 10, Math.max(legendFont + 10, (style.legendY ?? 0.1) * H))
      : style.legend === 'bottom' ? H - legendHeight + legendRow : top;
    out.push(`<g data-legend="true" data-legend-x="${x / W}" data-legend-y="${y / H}" style="cursor:move;touch-action:none">`);
    for (let i = 1; i <= k; i++) {
      const lx = style.legend === 'bottom' ? x + ((i - 1) % 4) * 140 : x;
      const ly = style.legend === 'bottom' ? y + Math.floor((i - 1) / 4) * legendRow : y + (i - 1) * legendRow;
      line(lx, ly - 4, lx + 20, ly - 4, clusterColor(d, i));
      text(lx + 28, ly, `簇 ${i}`, 'start', legendFont);
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('');
}
