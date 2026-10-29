import { chartSVG, escapeXML as esc } from './chart';
import { fmt } from './math';
import { ionColor, type RecognitionAnalysis, type RecognitionData } from './recognition-2026.10.27';
import { chartAxes, type ChartStyle, type PlotData } from './types';

const ink = '#252525';
const sub = '₀₁₂₃₄₅₆₇₈₉', sup = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻';
const superscript = '0123456789+−';
interface Run { text: string; level: 'normal' | 'sub' | 'super' }

/** Explicit charges accept Fe3+, CO3^2-, CO₃²⁻. Ambiguous polyatomic digits stay subscripts. */
export function chemicalRuns(value: string): Run[] {
  let body = value.trim(), charge = '';
  const explicit = body.match(/\^(?:\{([0-9]*[+−-])\}|([0-9]*[+−-]))$/);
  if (explicit) { charge = explicit[1] ?? explicit[2]; body = body.slice(0, explicit.index); }
  else if (/[+−-]$/.test(body)) {
    const atom = body.match(/^([A-Z][a-z]?)(\d*)([+−-])$/);
    if (atom) { body = atom[1]; charge = atom[2] + atom[3]; }
    else { charge = body.slice(-1); body = body.slice(0, -1); }
  }
  const formula = /^(?:[A-Z][a-z]?\d*|[₀-₉⁰-⁹⁺⁻]|[()[\]·.])+$/u.test(body);
  const runs: Run[] = [];
  const append = (text: string, level: Run['level']) => {
    if (runs.at(-1)?.level === level) runs[runs.length - 1].text += text;
    else runs.push({ text, level });
  };
  for (const c of body) {
    if (sub.includes(c)) append(String(sub.indexOf(c)), 'sub');
    else if (sup.includes(c)) append(superscript[sup.indexOf(c)], 'super');
    else append(c, formula && /\d/.test(c) ? 'sub' : 'normal');
  }
  if (charge) append(charge.replace('-', '−'), 'super');
  return runs;
}
export function chemicalText(value: string): string {
  return chemicalRuns(value).map(({ text, level }) => level === 'normal' ? esc(text)
    : `<tspan baseline-shift="${level}" font-size="72%">${esc(text)}</tspan>`).join('');
}
const textWidth = (text: string, fs: number) => [...text].reduce((sum, c) => sum + fs *
  (c.codePointAt(0)! > 0x2e80 ? 1.08 : /[MW@]/.test(c) ? 1 : /[A-Z]/.test(c) ? 0.78 : 0.66), 0);
const chemicalWidth = (value: string, fs: number) => chemicalRuns(value)
  .reduce((sum, run) => sum + textWidth(run.text, fs * (run.level === 'normal' ? 1 : 0.72)), 8);

export interface LabelBox { x: number; y: number; width: number; height: number }
interface LabelGroup { name: string; x: number; y: number }
const overlaps = (a: LabelBox, b: LabelBox) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

/** Deterministic placement moves text only; sample coordinates never enter the optimizer. */
export function placeIonLabels(groups: LabelGroup[], obstacles: LabelBox[], bounds: LabelBox, fs: number): LabelBox[] | null {
  const placed: LabelBox[] = [], result: LabelBox[] = [];
  // Wide labels first leave short labels more choices in crowded plots.
  const order = groups.map((group, i) => ({ ...group, i, width: chemicalWidth(group.name, fs) }))
    .sort((a, b) => b.width - a.width || a.i - b.i);
  for (const group of order) {
    // The bundled CJK font has taller metrics than Arial, especially for mixed sub/superscripts.
    const width = group.width, height = fs * 2.3, step = Math.max(8, fs * 0.65);
    let found: LabelBox | undefined;
    const maxRadius = Math.hypot(bounds.width, bounds.height);
    for (let radius = 0; radius <= maxRadius && !found; radius += step) {
      const count = radius === 0 ? 1 : Math.max(16, Math.ceil(2 * Math.PI * radius / step));
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 4 + i * Math.PI * 2 / count;
        const box = { x: group.x + Math.cos(angle) * radius - width / 2,
          y: group.y + Math.sin(angle) * radius - height / 2, width, height };
        if (box.x < bounds.x || box.y < bounds.y || box.x + width > bounds.x + bounds.width
          || box.y + height > bounds.y + bounds.height) continue;
        if (obstacles.some((o) => overlaps(box, o)) || placed.some((o) => overlaps(box, o))) continue;
        found = box; break;
      }
    }
    if (!found) return null;
    placed.push(found); result[group.i] = found;
  }
  return result;
}

export function scoreAxes(d: RecognitionData, a: RecognitionAnalysis) {
  const rank = a.pca?.rank ?? 0, pcX = d.settings.pcX < rank ? d.settings.pcX : 0;
  const pcY = d.settings.pcY < rank && d.settings.pcY !== pcX ? d.settings.pcY : pcX === 0 ? 1 : 0;
  return { pcX, pcY };
}
export function scorePlot(d: RecognitionData, a: RecognitionAnalysis): PlotData {
  if (!a.pca || a.pca.rank < 2) throw new Error('PCA 得分图至少需要两个有效主成分');
  const { pcX, pcY } = scoreAxes(d, a);
  return { series: [...new Set(d.rows.map((r) => r.ion))].map((ion) => ({
    name: ion, color: ionColor(d, ion), kind: 'scatter',
    pointShape: d.settings.ionShapes?.[ion] ?? d.settings.shape, opacity: d.settings.opacity,
    points: d.rows.flatMap((row, i) => row.ion !== ion ? [] : [{
      x: a.pca!.scores[i][pcX], y: a.pca!.scores[i][pcY],
      tooltip: `样本 ID: ${row.sample}\n离子: ${row.ion}\n平行编号: ${row.replicate}\nPC${pcX + 1}: ${a.pca!.scores[i][pcX]}\nPC${pcY + 1}: ${a.pca!.scores[i][pcY]}`,
    }]),
  })) };
}
export function scoreStyle(d: RecognitionData, a: RecognitionAnalysis, style: ChartStyle): ChartStyle {
  const { pcX, pcY } = scoreAxes(d, a), axes = chartAxes(style);
  const label = (value: string, pc: number) => `${value.replace(/PC\d+.*$/, '').trim()} PC${pc + 1} (${((a.pca?.explained[pc] ?? 0) * 100).toFixed(2)}%)`.trim();
  return { ...style, legend: 'none', grid: false,
    axes: { ...style.axes, top: { ...axes.top, visible: false }, right: { ...axes.right, visible: false } },
    xLabel: label(style.xLabel, pcX), yLabel: label(style.yLabel, pcY) };
}
export function scoresSVG(d: RecognitionData, a: RecognitionAnalysis, baseStyle: ChartStyle): string {
  const plot = scorePlot(d, a), style = scoreStyle(d, a, baseStyle), fs = style.fontSize;
  const totalWidth = plot.series.reduce((sum, series) => sum + chemicalWidth(series.name, fs) * fs * 2, 0);
  const longest = Math.max(...plot.series.map((series) => chemicalWidth(series.name, fs)));
  let minWidth = Math.max(1000, longest + 400, Math.sqrt(totalWidth * 2) + 180), minHeight = Math.max(600, Math.sqrt(totalWidth / 2) + 160);
  for (let attempt = 0; attempt < 8; attempt++) {
    let fits = false;
    const svg = chartSVG(plot, style, { minWidth, minHeight, rightMargin: fs * 3, titlePadding: fs * 0.6,
      foreground: ink, axisWidth: style.lineWidth,
      render: ({ left, top, width, height, sx, sy }) => {
        const marks = plot.series.flatMap((series) => series.points.map((p) => ({ x: sx(p.x), y: sy(p.y) })));
        const radius = style.pointSize * 1.45 + 4;
        const obstacles: LabelBox[] = marks.map((p) => ({ x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2 }));
        if (style.pointValues) plot.series.forEach((series) => series.points.forEach((p) => {
          const vf = Math.max(9, fs * 0.75), x = sx(p.x), y = sy(p.y), above = y - style.pointSize - 5;
          const baseline = above - vf * 0.8 >= top ? above : Math.min(y + style.pointSize + vf + 2, top + height - 3);
          const valueWidth = textWidth(fmt(p.y, 4), vf) + 8;
          const px = Math.max(left + 2, Math.min(left + width - 2, x));
          const offset = x - left < 40 ? 0 : left + width - x < 40 ? valueWidth : valueWidth / 2;
          obstacles.push({ x: px - offset - 3, y: baseline - vf - 3, width: valueWidth + 6, height: vf * 1.4 + 6 });
        }));
        const groups = plot.series.map((series) => ({ name: series.name,
          x: series.points.reduce((sum, p) => sum + sx(p.x), 0) / series.points.length,
          y: series.points.reduce((sum, p) => sum + sy(p.y), 0) / series.points.length }));
        const boxes = placeIonLabels(groups, obstacles, { x: left + 6, y: top + 6, width: width - 12, height: height - 12 }, fs);
        if (!boxes) return '';
        fits = true;
        return boxes.map((box, i) => {
          const group = groups[i], series = plot.series[i], cx = box.x + box.width / 2, cy = box.y + box.height / 2;
          let leader = '';
          if (Math.hypot(cx - group.x, cy - group.y) > fs * 2.5) {
            const point = series.points.map((p) => ({ x: sx(p.x), y: sy(p.y) }))
              .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0];
            const ex = Math.max(box.x, Math.min(box.x + box.width, point.x)), ey = Math.max(box.y, Math.min(box.y + box.height, point.y));
            const distance = Math.hypot(ex - point.x, ey - point.y), t = Math.min(1, radius / (distance || 1));
            if (distance > radius + fs * 0.8)
              leader = `<line data-label-leader="true" x1="${point.x + (ex - point.x) * t}" y1="${point.y + (ey - point.y) * t}" x2="${ex}" y2="${ey}" stroke="${esc(series.color)}" stroke-width="0.7"/>`;
          }
          return `${leader}<text data-ion-label="${esc(group.name)}" aria-label="${esc(group.name)}" x="${cx}" y="${box.y + fs * 1.55}" text-anchor="middle" fill="${esc(series.color)}" font-size="${fs}">${chemicalText(group.name)}</text>`;
        }).join('');
      },
    });
    if (fits) return svg;
    minWidth *= 1.4; minHeight *= 1.4;
  }
  throw new Error('离子标签过密，请缩小字号后重试');
}

export function treeStyle(style: ChartStyle): ChartStyle {
  const xLabel = !style.xLabel || style.xLabel === '样本 / 离子 / 平行编号' ? 'Ward 合并高度'
    : /Ward.*(?:距离|高度)/i.test(style.xLabel) ? style.xLabel : `${style.xLabel}（Ward 合并高度）`;
  return { ...style, grid: false, legend: 'none', xLabel,
    yLabel: style.yLabel === 'Ward 距离' ? '离子' : style.yLabel };
}

/** Leaves start at distance zero on the left; unmodified Ward heights extend to the right. */
export function horizontalHierarchySVG(d: RecognitionData, a: RecognitionAnalysis, baseStyle: ChartStyle): string {
  const h = a.hierarchy;
  if (!h || !a.clusters) throw new Error('请先修正数据并完成聚类');
  const style = treeStyle(baseStyle), fs = style.fontSize, n = h.size;
  const maxHeight = h.merges.at(-1)?.height ?? 0, scale = maxHeight || 1;
  const labelWidth = Math.max(60, ...h.order.map((row) => chemicalWidth(d.rows[row].ion, fs)));
  const left = Math.max(95, labelWidth + fs * 2.4 + 25), top = 22 + (style.title ? fs + 35 : 10), bottom = fs * 3 + 30;
  const W = Math.max(1000, left + 650, textWidth(style.xLabel, fs + 1) + left + 50);
  const H = Math.max(600, top + bottom + n * Math.max(28, fs * 2.4));
  const pw = W - left - Math.max(35, fs * 3), ph = H - top - bottom, step = ph / n, axisY = top + ph;
  const sx = (height: number) => left + height / scale * pw;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(style.title || '层次聚类树状图')}" font-family="${esc(style.fontFamily)}, Perovskite Lab Sans, sans-serif"><defs></defs><rect width="${W}" height="${H}" fill="#ffffff"/>`];
  const text = (x: number, y: number, value: string, anchor = 'start', size = fs, extra = '') =>
    out.push(`<text x="${x}" y="${y}" fill="${ink}" font-size="${size}" text-anchor="${anchor}" ${extra}>${esc(value)}</text>`);
  const line = (x: number, y: number, x2: number, y2: number, extra = '', width = style.lineWidth) =>
    out.push(`<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${ink}" stroke-width="${width}" ${extra}/>`);
  if (style.title) text(W / 2, fs + 12, style.title, 'middle', fs + 5);
  const position: { x: number; y: number }[] = [];
  h.order.forEach((row, i) => {
    const y = top + (i + 0.5) * step, sample = d.rows[row];
    position[row] = { x: left, y };
    out.push(`<g data-leaf="${row}" data-row-id="${esc(sample.id)}" data-cluster="${a.clusters![row]}"><title>${esc(`样本 ID: ${sample.sample}\n离子: ${sample.ion}\n平行编号: ${sample.replicate}\n簇: ${a.clusters![row]}`)}</title><rect x="${left - labelWidth - 14}" y="${y - step / 2}" width="${labelWidth + 14}" height="${step}" fill="transparent"/><text data-leaf-label="${row}" x="${left - 14}" y="${y + fs * 0.34}" font-size="${fs}" text-anchor="end" fill="${ink}" aria-label="${esc(sample.ion)}">${chemicalText(sample.ion)}</text></g>`);
  });
  h.merges.forEach((merge, i) => {
    const l = position[merge.left], r = position[merge.right], x = sx(merge.height);
    out.push(`<g data-merge="${i}" data-left="${merge.left}" data-right="${merge.right}" data-height="${merge.height}"><title>${esc(`Ward 合并高度: ${merge.height}\n样本数: ${merge.size}`)}</title>`);
    line(l.x, l.y, x, l.y); line(r.x, r.y, x, r.y); line(x, l.y, x, r.y);
    out.push('</g>'); position[n + i] = { x, y: (l.y + r.y) / 2 };
  });
  if (d.settings.cutMode === 'height') {
    const value = Number(d.settings.cutHeight);
    if (Number.isFinite(value) && value >= 0 && value <= maxHeight)
      line(sx(value), top, sx(value), axisY, `data-cut-height="${value}" stroke-dasharray="6 4"`, 1);
  }
  const axis = chartAxes(style).bottom;
  if (axis.visible) {
    out.push('<g data-axis="bottom">'); line(left, axisY, left + pw, axisY);
    const divisions = Math.max(1, Math.min(20, Math.round(axis.divisions)));
    for (let i = 0; i <= divisions; i++) {
      const value = i / divisions * scale, x = sx(value);
      const outward = axis.ticks === 'out' || axis.ticks === 'both' ? axis.tickLength : 0;
      const inward = axis.ticks === 'in' || axis.ticks === 'both' ? axis.tickLength : 0;
      if (axis.ticks !== 'none') line(x, axisY - inward, x, axisY + outward, '', axis.tickWidth);
      if (axis.tickLabels) text(x, axisY + outward + fs + 8, fmt(value, 4), 'middle');
    }
    text(left + pw / 2, H - 18, style.xLabel, 'middle', fs + 1, 'data-axis-title="true"');
    out.push('</g>');
  }
  const yTitleX = fs * 1.6 + 2;
  if (style.yLabel) text(yTitleX, top + ph / 2, style.yLabel, 'middle', fs + 1, `transform="rotate(-90 ${yTitleX} ${top + ph / 2})"`);
  out.push('</svg>');
  return out.join('');
}
