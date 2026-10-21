import { fmt, numeric } from './math';
import { chartAxes, axisSides, type AxisSide, type ChartStyle, type PlotData } from './types';
export const escapeXML = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
export function chartSVG(data: PlotData, style: ChartStyle): string {
  const ps = data.series.flatMap((s) => s.points);
  if (!ps.length) throw new Error('暂无可绘制数据');
  const bar = !!data.categories, axes = chartAxes(style), fs = style.fontSize;
  for (const axis of Object.values(axes)) {
    if (!Number.isInteger(axis.divisions) || axis.divisions < 1 || axis.divisions > 20)
      throw new Error('刻度分段数须为 1–20 的整数');
    if (!Number.isFinite(axis.tickLength) || axis.tickLength < 0 || axis.tickLength > 20 ||
        !Number.isFinite(axis.tickWidth) || axis.tickWidth < 0.5 || axis.tickWidth > 5)
      throw new Error('刻度长度须为 0–20，粗细须为 0.5–5');
  }
  const xvals = ps.map((p) => p.x), yvals = ps.map((p) => p.y);
  let x0 = xvals.reduce((a, b) => Math.min(a, b), Infinity),
    x1 = xvals.reduce((a, b) => Math.max(a, b), -Infinity),
    y0 = yvals.reduce((a, b) => Math.min(a, b), 0),
    y1 = yvals.reduce((a, b) => Math.max(a, b), -Infinity);
  if (bar) { x0 = -0.6; x1 = data.categories!.length - 0.4; }
  else if (x0 === x1) { x0 -= 1; x1 += 1; }
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  else { const pad = (y1 - y0) * 0.08; y1 += pad; if (y0 < 0) y0 -= pad; }
  const parseBound = (s: string, auto: number) => {
    if (!s.trim()) return auto;
    const n = numeric(s);
    if (n === null) throw new Error('坐标范围必须为有效数值');
    return n;
  };
  x0 = parseBound(style.xMin, x0); x1 = parseBound(style.xMax, x1);
  y0 = parseBound(style.yMin, y0); y1 = parseBound(style.yMax, y1);
  if (x1 <= x0 || y1 <= y0) throw new Error('坐标最大值必须大于最小值');
  const ticksFor = (side: AxisSide) => {
    const horizontal = side === 'bottom' || side === 'top';
    if (horizontal && bar) return data.categories!.map((label, value) => ({ value, label }))
      .filter(({ value }) => value >= x0 && value <= x1);
    const min = horizontal ? x0 : y0, max = horizontal ? x1 : y1, n = axes[side].divisions;
    return Array.from({ length: n + 1 }, (_, i) => {
      const value = min + ((max - min) * i) / n;
      return { value, label: fmt(value, horizontal ? 4 : 3) };
    });
  };
  const labelWidth = (s: string, size = fs) => Array.from(s).reduce(
    (n, c) => n + (c.codePointAt(0)! > 0x2e80 ? 1 : 0.65) * size, 0);
  const outward = (side: AxisSide) => {
    const a = axes[side];
    return a.ticks === 'out' || a.ticks === 'both' ? a.tickLength : 0;
  };
  const margin = (side: AxisSide) => {
    const a = axes[side];
    if (!a.visible) return 22;
    const horizontal = side === 'bottom' || side === 'top';
    const tickSpace = !a.tickLabels ? 0 : horizontal
      ? bar ? Math.max(fs + 12, ...ticksFor(side).map((t) => labelWidth(t.label) * 0.5 + fs + 10 + (side === 'top' ? fs * 2 : 0))) : fs + 14
      : Math.max(0, ...ticksFor(side).map((t) => labelWidth(t.label))) + 10;
    return Math.max(30, outward(side) + tickSpace + (a.label ? fs + 25 : 12));
  };
  const legendItems = data.series.filter((s) => s.kind !== 'bar');
  const legendRows = Math.ceil(legendItems.length / 3);
  const legendWidth = Math.max(0, ...legendItems.map((s) => labelWidth(s.name)));
  const bottomLegend = style.legend === 'bottom' && legendItems.length > 0;
  const bottomAxis = margin('bottom'), topAxis = margin('top'), rightAxis = margin('right');
  // Leave room for long axis titles and rotated category labels in exported figures.
  const verticalTitle = Math.max(...(['left', 'right'] as const).map((side) =>
    axes[side].visible ? labelWidth(axes[side].label, fs + 1) + 25 : 0));
  const horizontalTitle = Math.max(...(['top', 'bottom'] as const).map((side) =>
    axes[side].visible ? labelWidth(axes[side].label, fs + 1) + 25 : 0));
  const edgeLabels = bar ? Math.max(0, ...(data.categories ?? []).map((s) => labelWidth(s) * 0.866)) : fs * 3;
  const left = Math.max(margin('left'), axes.bottom.visible && axes.bottom.tickLabels ? edgeLabels : 0),
    top = topAxis + (style.title ? fs + 35 : 10),
    right = Math.max(rightAxis, axes.top.visible && axes.top.tickLabels ? edgeLabels : 0) +
      (style.legend === 'right' ? Math.max(200, legendWidth + 80) : 0),
    bottom = bottomAxis + (bottomLegend ? legendRows * 28 + 28 : 10);
  const horizontalTicks = Math.max(0, ...(['top', 'bottom'] as const).map((side) => {
    const axis = axes[side];
    if (!axis.visible || !axis.tickLabels) return 0;
    const width = Math.max(0, ...ticksFor(side).map((t) => labelWidth(t.label)));
    return bar ? (width * 0.866 + 16) * (data.categories?.length ?? 0)
      : (width + 16) * axis.divisions;
  }));
  const W = Math.max(1000, left + right + Math.max(550, horizontalTitle, horizontalTicks)),
    H = Math.max(600, top + bottom + Math.max(350, verticalTitle),
      style.legend === 'right' ? top + legendItems.length * 32 + bottom : 0);
  const pw = W - left - right, ph = H - top - bottom;
  const sx = (x: number) => left + ((x - x0) / (x1 - x0)) * pw,
    sy = (y: number) => top + ph - ((y - y0) / (y1 - y0)) * ph;
  const fg = '#243b39', out: string[] = [];
  const text = (x: number, y: number, s: string, anchor = 'start', size = fs, extra = '') =>
    out.push(`<text x="${x}" y="${y}" fill="${fg}" font-size="${size}" text-anchor="${anchor}" ${extra}>${escapeXML(s)}</text>`);
  const line = (x1: number, y1: number, x2: number, y2: number, color = fg, width = 1.1, dashed = false) =>
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"${dashed ? ' stroke-dasharray="7 5"' : ''}/>`);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXML(style.title || '科研图表')}" font-family="${escapeXML(style.fontFamily)}, Perovskite Lab Sans, sans-serif"><rect width="${W}" height="${H}" fill="#ffffff"/><defs><clipPath id="plot-clip"><rect x="${left}" y="${top}" width="${pw}" height="${ph}"/></clipPath></defs>`);
  if (style.title) text(W / 2, fs + 12, style.title, 'middle', fs + 5);
  if (style.grid) {
    for (const { value } of ticksFor('left')) line(left, sy(value), left + pw, sy(value), '#e5ebe9', 0.8);
    if (!bar) for (const { value } of ticksFor('bottom')) line(sx(value), top, sx(value), top + ph, '#e5ebe9', 0.8);
  }
  out.push('<g clip-path="url(#plot-clip)">');
  for (const s of data.series) {
    if (s.kind === 'bar') {
      for (const p of s.points) {
        const bw = (pw / (x1 - x0)) * 0.6,
          y = sy(p.y),
          z = sy(0);
        out.push(
          `<rect x="${sx(p.x) - bw / 2}" y="${Math.min(y, z)}" width="${bw}" height="${Math.max(0.6, Math.abs(y - z))}" fill="${s.color}"/>`,
        );
      }
    } else {
      if (s.kind !== 'scatter')
        out.push(
          `<polyline points="${s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="${style.lineWidth}" stroke-linejoin="round"${s.dashed || style.dashed ? ' stroke-dasharray="8 5"' : ''}/>`,
        );
      if (style.points || s.kind === 'scatter')
        for (const p of s.points)
          out.push(
            `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${style.pointSize}" fill="${s.color}"/>`,
          );
    }
  }
  out.push('</g>');

  for (const side of axisSides) {
    const a = axes[side];
    if (!a.visible) continue;
    const horizontal = side === 'top' || side === 'bottom',
      sign = side === 'bottom' || side === 'right' ? 1 : -1,
      baseline = horizontal ? side === 'top' ? top : top + ph : side === 'left' ? left : left + pw;
    out.push(`<g data-axis="${side}">`);
    if (horizontal) line(left, baseline, left + pw, baseline);
    else line(baseline, top, baseline, top + ph);
    out.push('<g data-axis-ticks="true">');
    for (const { value } of ticksFor(side)) {
      if (a.ticks === 'none' || a.tickLength === 0) continue;
      const p = horizontal ? sx(value) : sy(value),
        inward = a.ticks === 'in' || a.ticks === 'both' ? -a.tickLength : 0,
        outside = outward(side);
      if (horizontal) line(p, baseline + sign * inward, p, baseline + sign * outside, fg, a.tickWidth);
      else line(baseline + sign * inward, p, baseline + sign * outside, p, fg, a.tickWidth);
    }
    out.push('</g><g data-axis-tick-labels="true">');
    if (a.tickLabels) for (const { value, label } of ticksFor(side)) {
      if (horizontal) {
        const x = sx(value), y = baseline + sign * (outward(side) + fs + 8);
        text(x, y, label, bar ? side === 'bottom' ? 'end' : 'start' : 'middle', fs,
          bar ? `transform="rotate(-30 ${x} ${y})"` : '');
      } else text(baseline + sign * (outward(side) + 10), sy(value) + fs * 0.34, label, side === 'left' ? 'end' : 'start');
    }
    out.push('</g>');
    if (a.label) {
      if (horizontal) {
        const y = side === 'top' ? baseline - topAxis + fs + 5 : baseline + bottomAxis - 8;
        text(left + pw / 2, y, a.label, 'middle', fs + 1, 'data-axis-title="true"');
      } else {
        const x = side === 'left' ? left - margin('left') + fs + 2 : baseline + rightAxis - fs - 2,
          y = top + ph / 2, rotation = side === 'left' ? -90 : 90;
        text(x, y, a.label, 'middle', fs + 1, `data-axis-title="true" transform="rotate(${rotation} ${x} ${y})"`);
      }
    }
    out.push('</g>');
  }
  if (data.annotation) text(left + 15, top + 25, data.annotation, 'start', fs);
  if (style.legend !== 'none')
    legendItems.forEach((s, i) => {
      const x = style.legend === 'right' ? left + pw + rightAxis + 28 : left + ((i % 3) * pw) / 3,
        y =
          style.legend === 'right'
            ? top + 20 + i * 32
            : H - (legendRows - 1) * 28 - 25 + Math.floor(i / 3) * 28;
      line(x, y - 5, x + 23, y - 5, s.color, style.lineWidth, s.dashed);
      text(x + 31, y, s.name, 'start', fs);
    });
  out.push('</svg>');
  return out.join('');
}
