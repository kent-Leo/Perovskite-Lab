import { fmt, numeric } from './math';
import type { ChartStyle, PlotData } from './types';
export const escapeXML = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
export function chartSVG(data: PlotData, style: ChartStyle): string {
  const ps = data.series.flatMap((s) => s.points);
  if (!ps.length) throw new Error('暂无可绘制数据');
  const bar = !!data.categories;
  const legendItems = data.series.filter((s) => s.kind !== 'bar');
  const labelWidth = (s: string) =>
    Array.from(s).reduce((n, c) => n + (c.codePointAt(0)! > 0x2e80 ? 1 : 0.65) * style.fontSize, 0);
  const categoryWidth = (data.categories ?? []).reduce((n, s) => Math.max(n, labelWidth(s)), 0);
  const legendWidth = legendItems.reduce((n, s) => Math.max(n, labelWidth(s.name)), 0);
  const legendRows = Math.ceil(legendItems.length / 3);
  const bottomLegend = style.legend === 'bottom' && legendItems.length > 0;
  const left = bar ? Math.max(105, categoryWidth * 0.866 + 15) : 105,
    top = style.title ? 70 : 40,
    right = style.legend === 'right' ? Math.max(230, legendWidth + 80) : 45,
    bottom = bar
      ? Math.max(125, categoryWidth * 0.5 + 65)
      : bottomLegend
        ? Math.max(125, 80 + legendRows * 28)
        : 85;
  const W = Math.max(1000, left + right + Math.max(550, (data.categories?.length ?? 0) * 65)),
    H = Math.max(
      600,
      top + bottom + 350,
      style.legend === 'right' ? top + legendItems.length * 32 + bottom : 0,
    );
  const pw = W - left - right,
    ph = H - top - bottom;
  const xvals = ps.map((p) => p.x),
    yvals = ps.map((p) => p.y);
  let x0 = xvals.reduce((a, b) => Math.min(a, b), Infinity),
    x1 = xvals.reduce((a, b) => Math.max(a, b), -Infinity),
    y0 = yvals.reduce((a, b) => Math.min(a, b), 0),
    y1 = yvals.reduce((a, b) => Math.max(a, b), -Infinity);
  if (bar) {
    x0 = -0.6;
    x1 = data.categories!.length - 0.4;
  } else if (x0 === x1) {
    x0 -= 1;
    x1 += 1;
  }
  if (y0 === y1) {
    y0 -= 1;
    y1 += 1;
  } else {
    const pad = (y1 - y0) * 0.08;
    y1 += pad;
    if (y0 < 0) y0 -= pad;
  }
  const parseBound = (s: string, auto: number) => {
    if (!s.trim()) return auto;
    const n = numeric(s);
    if (n === null) throw new Error('坐标范围必须为有效数值');
    return n;
  };
  x0 = parseBound(style.xMin, x0);
  x1 = parseBound(style.xMax, x1);
  y0 = parseBound(style.yMin, y0);
  y1 = parseBound(style.yMax, y1);
  if (x1 <= x0 || y1 <= y0) throw new Error('坐标最大值必须大于最小值');
  const sx = (x: number) => left + ((x - x0) / (x1 - x0)) * pw,
    sy = (y: number) => top + ph - ((y - y0) / (y1 - y0)) * ph;
  const fs = style.fontSize,
    fg = '#243b39',
    out: string[] = [];
  const text = (x: number, y: number, s: string, anchor = 'start', size = fs, extra = '') =>
    out.push(
      `<text x="${x}" y="${y}" fill="${fg}" font-size="${size}" text-anchor="${anchor}" ${extra}>${escapeXML(s)}</text>`,
    );
  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color = fg,
    width = 1.1,
    dashed = false,
  ) =>
    out.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"${dashed ? ' stroke-dasharray="7 5"' : ''}/>`,
    );
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXML(style.title || '科研图表')}" font-family="${escapeXML(style.fontFamily)}, Perovskite Lab Sans, sans-serif"><rect width="${W}" height="${H}" fill="#ffffff"/><defs><clipPath id="plot-clip"><rect x="${left}" y="${top}" width="${pw}" height="${ph}"/></clipPath></defs>`,
  );
  if (style.title) text(W / 2, 33, style.title, 'middle', fs + 5);
  for (let i = 0; i <= 5; i++) {
    const y = y0 + ((y1 - y0) * i) / 5,
      p = sy(y);
    if (style.grid) line(left, p, left + pw, p, '#e5ebe9', 0.8);
    line(left - 5, p, left, p);
    text(left - 12, p + fs * 0.34, fmt(y, 3), 'end');
  }
  if (bar) {
    data.categories!.forEach((name, i) => {
      const x = sx(i);
      text(x, top + ph + 22, name, 'end', fs, `transform="rotate(-30 ${x} ${top + ph + 22})"`);
    });
  } else
    for (let i = 0; i <= 5; i++) {
      const x = x0 + ((x1 - x0) * i) / 5,
        p = sx(x);
      if (style.grid) line(p, top, p, top + ph, '#e5ebe9', 0.8);
      line(p, top + ph, p, top + ph + 5);
      text(p, top + ph + 28, fmt(x, 4), 'middle');
    }
  line(left, top, left, top + ph);
  line(left, top + ph, left + pw, top + ph);
  text(left + pw / 2, bottomLegend ? H - bottom + 55 : H - 20, style.xLabel, 'middle', fs + 1);
  text(
    25,
    top + ph / 2,
    style.yLabel,
    'middle',
    fs + 1,
    `transform="rotate(-90 25 ${top + ph / 2})"`,
  );
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
  if (data.annotation) text(left + 15, top + 25, data.annotation, 'start', fs);
  if (style.legend !== 'none')
    legendItems.forEach((s, i) => {
      const x = style.legend === 'right' ? W - right + 28 : left + ((i % 3) * pw) / 3,
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
