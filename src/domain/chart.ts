import { chartFontStack, svgFontRuns, legendTypography, type ChartTypography } from './chart-fonts-2026.11.3';
import { fmt, numeric } from './math';
import { chartAxes, axisSides, type AxisSide, type ChartStyle, type GroupedBarOptions, type PlotData } from './types';
export const escapeXML = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
/** A readable interval (1 / 2 / 5 × 10ⁿ) that yields roughly five segments. */
function autoInterval(min: number, max: number): number {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return 1;
  const rough = span / 5, magnitude = 10 ** Math.floor(Math.log10(rough)), ratio = rough / magnitude;
  return (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * magnitude;
}
/** Tick interval in axis data units; a missing or non-positive value means automatic. */
export function axisInterval(min: number, max: number, step: number): number {
  return Number.isFinite(step) && step > 0 ? step : autoInterval(min, max);
}
/** Ticks sit on multiples of the interval so every label stays a round number. */
export function axisTickValues(min: number, max: number, step: number): number[] {
  const interval = axisInterval(min, max, step);
  const first = Math.ceil(min / interval - 1e-9), last = Math.floor(max / interval + 1e-9);
  if (last - first > 200) throw new Error('刻度间隔过小，请增大间隔或留空自动');
  const values: number[] = [];
  for (let i = first; i <= last; i++) values.push(Number((i * interval).toPrecision(12)));
  // A range shorter than one interval still shows its two ends.
  return values.length ? values : [min, max];
}
/** Optional annotations share the exact scales used to draw the measured points. */
export interface ChartOverlay {
  minWidth?: number; minHeight?: number; rightMargin?: number; titlePadding?: number;
  foreground?: string; axisWidth?: number;
  render: (layout: { left: number; top: number; width: number; height: number;
    sx: (x: number) => number; sy: (y: number) => number }) => string;
}

/** Pixel-space layout reserves a slot for each visible series, including missing cells. */
export function groupedBarLayout(center: number, index: number, count: number, pitch: number, options: GroupedBarOptions) {
  const gap = Math.max(0, options.innerGap);
  const available = Math.max(1, pitch - Math.max(0, options.groupGap));
  const width = Math.max(0.1, Math.min(options.barWidth, (available - gap * Math.max(0, count - 1)) / Math.max(1, count)));
  const actualGap = count > 1 ? Math.min(gap, Math.max(0, (available - width * count) / (count - 1))) : 0;
  const total = count * width + Math.max(0, count - 1) * actualGap;
  return { x: center - total / 2 + index * (width + actualGap), width };
}

function paleColor(hex: string, fraction: number) {
  const match = /^#([\da-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = Number.parseInt(match[1], 16);
  const channels = [value >> 16, (value >> 8) & 255, value & 255];
  return `#${channels.map((channel) => Math.round(channel + (255 - channel) * fraction).toString(16).padStart(2, '0')).join('')}`;
}
export function chartSVG(data: PlotData, style: ChartStyle, overlay?: ChartOverlay): string {
  const ps = data.series.flatMap((s) => s.points);
  if (!ps.length) throw new Error('暂无可绘制数据');
  const bar = !!data.categories, grouped = data.groupedBars, axes = chartAxes(style), fs = style.fontSize;
  if (grouped && (!bar || !data.series.every((series) => series.kind === 'bar')))
    throw new Error('分组柱状图需要分类和柱形系列');
  if (grouped && ps.some((p) => !Number.isFinite(p.y) || (p.error != null && (!Number.isFinite(p.error) || p.error < 0))))
    throw new Error('柱形数值和误差必须为有效数值，误差不能为负');
  if (grouped) {
    for (const key of ['barWidth', 'innerGap', 'groupGap', 'borderWidth', 'errorWidth', 'errorCapWidth', 'categoryAngle'] as const)
      if (!Number.isFinite(grouped[key]) || (key !== 'categoryAngle' && grouped[key] < 0)) throw new Error('分组图表尺寸必须为有效的非负数');
    if (ps.some((p) => !Number.isFinite(p.y + (p.error ?? 0)) || !Number.isFinite(p.y - (p.error ?? 0))))
      throw new Error('误差棒端点超出数值范围');
  }
  for (const axis of Object.values(axes)) {
    if (axis.step !== undefined && (!Number.isFinite(axis.step) || axis.step < 0))
      throw new Error('刻度间隔须为大于 0 的数值，或留空自动');
    if (!Number.isFinite(axis.tickLength) || axis.tickLength < 0 || axis.tickLength > 20 ||
        !Number.isFinite(axis.tickWidth) || axis.tickWidth < 0.5 || axis.tickWidth > 5)
      throw new Error('刻度长度须为 0–20，粗细须为 0.5–5');
  }
  const xvals = ps.map((p) => p.x), yvals = ps.flatMap((p) =>
    grouped && p.error != null ? [p.y - p.error, p.y + p.error] : [p.y]);
  let x0 = xvals.reduce((a, b) => Math.min(a, b), Infinity),
    x1 = xvals.reduce((a, b) => Math.max(a, b), -Infinity),
    y0 = yvals.reduce((a, b) => Math.min(a, b), 0),
    y1 = yvals.reduce((a, b) => Math.max(a, b), -Infinity);
  if (bar) { x0 = grouped ? -0.5 : -0.6; x1 = data.categories!.length - (grouped ? 0.5 : 0.4); }
  else if (x0 === x1) { x0 -= 1; x1 += 1; }
  else if (data.series.some((s) => s.pointShape || s.arrows)) {
    const pad = (x1 - x0) * 0.1; x0 -= pad; x1 += pad;
  }
  if (grouped) y1 = Math.max(0, y1);
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
  if (grouped && ![x0, x1, y0, y1, x1 - x0, y1 - y0].every(Number.isFinite)) throw new Error('分组图表范围超出数值范围');
  const ticksFor = (side: AxisSide) => {
    const horizontal = side === 'bottom' || side === 'top';
    if (horizontal && bar) return data.categories!.map((label, value) => ({ value, label }))
      .filter(({ value }) => value >= x0 && value <= x1);
    const min = horizontal ? x0 : y0, max = horizontal ? x1 : y1;
    return axisTickValues(min, max, axes[side].step)
      .map((value) => ({ value, label: fmt(value, horizontal ? 4 : 3) }));
  };
  const labelWidth = (s: string, size = fs) => Array.from(s).reduce(
    (n, c) => n + (c.codePointAt(0)! > 0x2e80 ? 1 : 0.65) * size, 0);
  const valueWidth = grouped && style.pointValues ? ps.reduce((max, p) => Math.max(max, labelWidth(fmt(p.y, 4), Math.max(9, fs * 0.75))), 0) : 0;
  const markWidth = Math.max(valueWidth, grouped && ps.some((p) => p.error != null) ? grouped.errorCapWidth : 0);
  const layoutOptions = grouped ? { ...grouped,
    innerGap: Math.max(grouped.innerGap, markWidth + 6 - grouped.barWidth),
    groupGap: Math.max(grouped.groupGap, valueWidth + 6 - grouped.barWidth),
  } : undefined;
  const outward = (side: AxisSide) => {
    const a = axes[side];
    return a.ticks === 'out' || a.ticks === 'both' ? a.tickLength : 0;
  };
  const categoryAngle = grouped ? Math.max(-90, Math.min(90, grouped.categoryAngle)) : -30;
  const categoryRadians = Math.abs(categoryAngle) * Math.PI / 180;
  const margin = (side: AxisSide) => {
    const a = axes[side];
    if (!a.visible) return 22;
    const horizontal = side === 'bottom' || side === 'top';
    const tickSpace = !a.tickLabels ? 0 : horizontal
      ? bar ? Math.max(fs + 12, ...ticksFor(side).map((t) => labelWidth(t.label) * (grouped ? Math.sin(categoryRadians) : 0.5) + fs + 10 + (side === 'top' ? fs * 2 : 0))) : fs + 14
      : Math.max(0, ...ticksFor(side).map((t) => labelWidth(t.label))) + 10;
    return Math.max(30, outward(side) + tickSpace + (a.label ? fs + 25 + (overlay?.titlePadding ?? 0) : 12));
  };
  const legendItems = data.series;
  const legendFontSize = Number.isFinite(style.legendFontSize)
    ? Math.max(8, Math.min(30, Number(style.legendFontSize)))
    : fs;
  const legendRow = Math.max(18, legendFontSize + 10);
  const legendRows = Math.ceil(legendItems.length / 3);
  const legendWidth = Math.max(0, ...legendItems.map((s) => labelWidth(s.name, legendFontSize)));
  const hasLegend = style.legend !== 'none' && legendItems.length > 0;
  const bottomLegend = style.legend === 'bottom' && hasLegend;
  const topLegend = style.legend === 'top' && hasLegend;
  const bottomAxis = margin('bottom'), topAxis = margin('top'), rightAxis = margin('right');
  // Leave room for long axis titles and rotated category labels in exported figures.
  const verticalTitle = Math.max(...(['left', 'right'] as const).map((side) =>
    axes[side].visible ? labelWidth(axes[side].label, fs + 1) + 25 : 0));
  const horizontalTitle = Math.max(...(['top', 'bottom'] as const).map((side) =>
    axes[side].visible ? labelWidth(axes[side].label, fs + 1) + 25 : 0));
  const edgeLabels = bar ? Math.max(0, ...(data.categories ?? []).map((s) => labelWidth(s) * (grouped ? Math.cos(categoryRadians) : 0.866))) + (grouped ? fs : 0) : fs * 3;
  const left = Math.max(margin('left'), axes.bottom.visible && axes.bottom.tickLabels ? edgeLabels : 0),
    top = topAxis + (style.title ? fs + 35 : 10) + (topLegend ? legendRows * legendRow + 8 : 0),
    right = Math.max(rightAxis, overlay?.rightMargin ?? 0, (axes.top.visible && axes.top.tickLabels || grouped && categoryAngle >= 0 && axes.bottom.tickLabels) ? edgeLabels : 0) +
      (style.legend === 'right' && hasLegend ? Math.max(200, legendWidth + 80) : 0),
    bottom = bottomAxis + (bottomLegend ? legendRows * legendRow + legendRow : 10);
  const horizontalTicks = Math.max(0, ...(['top', 'bottom'] as const).map((side) => {
    const axis = axes[side];
    if (!axis.visible || !axis.tickLabels) return 0;
    const width = Math.max(0, ...ticksFor(side).map((t) => labelWidth(t.label)));
    return bar ? (width * (grouped ? Math.cos(categoryRadians) : 0.866) + 16) * (data.categories?.length ?? 0)
      : (width + 16) * Math.max(1, ticksFor(side).length);
  }));
  const groupedPitch = layoutOptions ? Math.max(0, layoutOptions.barWidth) * data.series.length +
    Math.max(0, layoutOptions.innerGap) * Math.max(0, data.series.length - 1) + Math.max(0, layoutOptions.groupGap) : 0;
  const groupedWidth = grouped ? groupedPitch * (data.categories?.length ?? 0) : 0;
  const legendSpan = (bottomLegend || topLegend) ? Math.min(3, legendItems.length) * (legendWidth + 48) : 0;
  const W = Math.max(1000, overlay?.minWidth ?? 0, left + right + Math.max(550, horizontalTitle, horizontalTicks, groupedWidth, legendSpan)),
    H = Math.max(600, overlay?.minHeight ?? 0, top + bottom + Math.max(350, verticalTitle),
      style.legend === 'right' && hasLegend
        ? top + legendItems.length * legendRow + bottom
        : 0);
  const pw = W - left - right, ph = H - top - bottom;
  const sx = (x: number) => left + ((x - x0) / (x1 - x0)) * pw,
    sy = (y: number) => top + ph - ((y - y0) / (y1 - y0)) * ph;
  const fg = overlay?.foreground ?? '#243b39', out: string[] = [];
  // Multiple sheet charts share one DOM. Equal clip geometries may share an ID;
  // different geometries and colors must not accidentally use another SVG's defs.
  const clipId = grouped ? `grouped-clip-${[left, top, pw, ph].map((value) => Math.round(value * 1000)).join('-')}` : 'plot-clip';
  const gradientId = (index: number) => `grouped-fill-${data.series[index].color.replace('#', '')}-${index}`;
  const text = (x: number, y: number, s: string, anchor = 'start', size = fs, extra = '', typography: ChartTypography = style) =>
    out.push(`<text x="${x}" y="${y}" fill="${fg}" font-size="${size}" text-anchor="${anchor}" ${extra}>${svgFontRuns(s, typography)}</text>`);
  const line = (x1: number, y1: number, x2: number, y2: number, color = fg, width = 1.1, dashed = false) =>
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"${dashed ? ' stroke-dasharray="7 5"' : ''}/>`);
  const gradients = grouped?.fill === 'gradient' ? data.series.map((series, i) => `<linearGradient id="${gradientId(i)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${paleColor(series.color, 0.36)}"/><stop offset="1" stop-color="${series.color}"/></linearGradient>`).join('') : '';
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXML(style.title || '科研图表')}" font-family="${escapeXML(chartFontStack(style))}"><rect width="${W}" height="${H}" fill="#ffffff"/><defs><clipPath id="${clipId}"><rect x="${left}" y="${top}" width="${pw}" height="${ph}"/></clipPath>${gradients}</defs>`);
  if (style.title) text(W / 2, fs + 12, style.title, 'middle', fs + 5);
  if (style.grid) {
    for (const { value } of ticksFor('left')) line(left, sy(value), left + pw, sy(value), '#e5ebe9', 0.8);
    if (!bar) for (const { value } of ticksFor('bottom')) line(sx(value), top, sx(value), top + ph, '#e5ebe9', 0.8);
  }
  out.push(`<g clip-path="url(#${clipId})">`);
  for (const [seriesIndex, s] of data.series.entries()) {
    if (s.kind === 'bar') {
      for (const p of s.points) {
        const box = layoutOptions ? groupedBarLayout(sx(p.x), seriesIndex, data.series.length, pw / (x1 - x0), layoutOptions) : null,
          bw = box?.width ?? (pw / (x1 - x0)) * 0.6,
          x = box?.x ?? sx(p.x) - bw / 2,
          y = sy(p.y),
          z = sy(0);
        const barY = Math.min(y, z), barHeight = Math.max(0.6, Math.abs(y - z));
        if (grouped) {
          out.push(`<g data-grouped-bar="true" data-series-index="${seriesIndex}" data-category-index="${p.x}">`);
          out.push(`<rect x="${x}" y="${barY}" width="${bw}" height="${barHeight}" fill="${grouped.fill === 'gradient' ? `url(#${gradientId(seriesIndex)})` : s.color}"/>`);
          if (grouped.borderWidth > 0)
            out.push(`<rect x="${x}" y="${barY}" width="${bw}" height="${barHeight}" fill="none" stroke="${grouped.borderColor}" stroke-width="${grouped.borderWidth}"/>`);
          out.push('</g>');
          if (p.error != null) {
            const cx = x + bw / 2, high = sy(p.y + p.error), low = sy(p.y - p.error), cap = grouped.errorCapWidth / 2;
            out.push(`<g data-error-bar="true" data-series-index="${seriesIndex}" data-category-index="${p.x}">`);
            line(cx, high, cx, low, grouped.errorColor, grouped.errorWidth);
            line(cx - cap, high, cx + cap, high, grouped.errorColor, grouped.errorWidth);
            line(cx - cap, low, cx + cap, low, grouped.errorColor, grouped.errorWidth);
            out.push('</g>');
          }
        } else out.push(`<rect x="${x}" y="${barY}" width="${bw}" height="${barHeight}" fill="${s.color}"/>`);
      }
    } else {
      if (s.kind !== 'scatter')
        out.push(
          `<polyline points="${s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="${style.lineWidth}" stroke-linejoin="round"${s.dashed || style.dashed ? ' stroke-dasharray="8 5"' : ''}/>`,
        );
      if (style.points || s.kind === 'scatter')
        for (const p of s.points) {
          const x = sx(p.x), y = sy(p.y), r = style.pointSize;
          out.push(`<g data-point="true" opacity="${s.opacity ?? 1}">`);
          if (p.tooltip) out.push(`<title>${escapeXML(p.tooltip)}</title>`);
          if (s.arrows) {
            line(sx(0), sy(0), x, y, s.color, style.lineWidth);
            const angle = Math.atan2(y - sy(0), x - sx(0)), head = 10;
            line(x, y, x - head * Math.cos(angle - 0.4), y - head * Math.sin(angle - 0.4), s.color, style.lineWidth);
            line(x, y, x - head * Math.cos(angle + 0.4), y - head * Math.sin(angle + 0.4), s.color, style.lineWidth);
          } else if (s.pointShape === 'square')
            out.push(`<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="${s.color}"/>`);
          else if (s.pointShape === 'triangle' || s.pointShape === 'diamond') {
            const points = s.pointShape === 'triangle'
              ? `${x},${y - r * 1.4} ${x - r * 1.2},${y + r} ${x + r * 1.2},${y + r}`
              : `${x},${y - r * 1.4} ${x - r * 1.4},${y} ${x},${y + r * 1.4} ${x + r * 1.4},${y}`;
            out.push(`<polygon points="${points}" fill="${s.color}"/>`);
          } else out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${s.color}"/>`);
          out.push('</g>');
          if (s.labels && p.label) text(
            Math.min(left + pw - 8, Math.max(left + 8, x + r + 4)),
            Math.max(top + fs, Math.min(top + ph - 4, s.arrows && y >= sy(0) ? y + fs + 10 : y - r - 6)),
            p.label, x > left + pw * 0.8 ? 'end' : 'start', Math.max(10, fs * 0.8), 'data-sample-label="true"',
          );
        }
    }
  }
  out.push('</g>');
  if (style.pointValues) {
    // Numeric labels are clamped to the plot area so they never spill into the
    // axes or legend, and they carry data-point-value instead of entering the
    // data-axis / data-legend groups.
    const valueFontSize = Math.max(9, fs * 0.75),
      clampX = (x: number) => Math.max(left + 2, Math.min(left + pw - 2, x));
    const valueAnchor = (x: number) =>
      x - left < 40 ? 'start' : left + pw - x < 40 ? 'end' : 'middle';
    const valueLabel = (x: number, y: number, value: number) => {
      const halfWidth = labelWidth(fmt(value, 4), valueFontSize) / 2 + 2;
      text(grouped ? Math.max(left + halfWidth, Math.min(left + pw - halfWidth, x)) : clampX(x),
        y, fmt(value, 4), grouped ? 'middle' : valueAnchor(x), valueFontSize, 'data-point-value="true"');
    };
    for (const [seriesIndex, s] of data.series.entries()) {
      // Derived series (for example a calibration fit line) are not data points.
      if (s.showPointValues === false) continue;
      if (s.kind === 'bar') {
        for (const p of s.points) {
          if (grouped && (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1)) continue;
          const y = sy(p.y + (grouped && p.error != null ? (p.y >= 0 ? p.error : -p.error) : 0));
          // Positive bars carry the value above the cap, negative bars below the base.
          const baseline =
            p.y >= 0
              ? Math.max(top + valueFontSize, y - 5)
              : Math.min(top + ph - 3, y + valueFontSize + 5);
          const box = layoutOptions ? groupedBarLayout(sx(p.x), seriesIndex, data.series.length, pw / (x1 - x0), layoutOptions) : null;
          valueLabel(box ? box.x + box.width / 2 : sx(p.x), baseline, p.y);
        }
      } else {
        for (const p of s.points) {
          const y = sy(p.y), above = y - style.pointSize - 5;
          // Prefer the free side of the point, then clamp inside the plot area.
          const baseline =
            above - valueFontSize * 0.8 >= top
              ? above
              : Math.min(y + style.pointSize + valueFontSize + 2, top + ph - 3);
          valueLabel(sx(p.x), baseline, p.y);
        }
      }
    }
  }

  for (const side of axisSides) {
    const a = axes[side];
    if (!a.visible) continue;
    const horizontal = side === 'top' || side === 'bottom',
      sign = side === 'bottom' || side === 'right' ? 1 : -1,
      baseline = horizontal ? side === 'top' ? top : top + ph : side === 'left' ? left : left + pw;
    out.push(`<g data-axis="${side}">`);
    if (horizontal) line(left, baseline, left + pw, baseline, fg, overlay?.axisWidth);
    else line(baseline, top, baseline, top + ph, fg, overlay?.axisWidth);
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
        const angle = bar ? categoryAngle : 0;
        const anchor = !bar || angle === 0 ? 'middle' : (side === 'bottom') === (angle < 0) ? 'end' : 'start';
        text(x, y, label, anchor, fs, bar && angle ? `transform="rotate(${angle} ${x} ${y})"` : '');
      } else text(baseline + sign * (outward(side) + 10), sy(value) + fs * 0.34, label, side === 'left' ? 'end' : 'start');
    }
    out.push('</g>');
    if (a.label) {
      if (horizontal) {
        const y = side === 'top' ? baseline - topAxis + fs + 5 : baseline + bottomAxis - 8;
        text(left + pw / 2, y, a.label, 'middle', fs + 1, 'data-axis-title="true"');
      } else {
        const x = side === 'left' ? left - margin('left') + fs + 2 + (overlay?.titlePadding ?? 0) : baseline + rightAxis - fs - 2,
          y = top + ph / 2, rotation = side === 'left' ? -90 : 90;
        text(x, y, a.label, 'middle', fs + 1, `data-axis-title="true" transform="rotate(${rotation} ${x} ${y})"`);
      }
    }
    out.push('</g>');
  }
  if (data.annotation) text(left + 15, top + 25, data.annotation, 'start', fs);
  if (hasLegend) {
    const legendStyle = legendTypography(style);
    const legendAttributes = style.legendFontFamily ? `font-family="${escapeXML(chartFontStack(legendStyle))}"` : '';
    let legendX = 0,
      legendY = 0;
    if (style.legend === 'right') {
      legendX = left + pw + rightAxis + 28;
      legendY = top + 20;
    } else if (style.legend === 'bottom') {
      legendX = left;
      legendY = H - (legendRows - 1) * legendRow - 25;
    } else if (style.legend === 'top') {
      legendX = left;
      legendY = style.title ? fs + 37 : fs + 8;
    } else {
      const contentWidth = 31 + legendWidth,
        contentHeight = (legendItems.length - 1) * legendRow,
        desiredX = (Number.isFinite(style.legendX) ? Number(style.legendX) : 0.72) * W,
        desiredY = (Number.isFinite(style.legendY) ? Number(style.legendY) : 0.1) * H;
      legendX = Math.max(6, Math.min(W - contentWidth - 6, desiredX));
      legendY = Math.max(legendFontSize + 6, Math.min(H - contentHeight - 8, desiredY));
    }
    out.push(
      `<g data-legend="true" data-legend-x="${(legendX / W).toFixed(6)}" data-legend-y="${(legendY / H).toFixed(6)}" style="cursor:move;touch-action:none"><title>拖动图例可自由移动</title>`,
    );
    legendItems.forEach((s, i) => {
      const x =
          style.legend === 'right' || style.legend === 'free'
            ? legendX
            : left + ((i % 3) * pw) / 3,
        y =
          style.legend === 'right' || style.legend === 'free'
            ? legendY + i * legendRow
            : legendY + Math.floor(i / 3) * legendRow;
      const itemWidth = (s.kind === 'bar' ? 22 : 31) + labelWidth(s.name, legendFontSize);
      // Transparent hit area so the whole row can start a drag, not only glyphs.
      out.push(
        `<rect x="${x - 3}" y="${y - legendFontSize}" width="${itemWidth + 6}" height="${legendFontSize + 8}" fill="none" pointer-events="all"/>`,
      );
      if (s.kind === 'bar') {
        out.push(
          `<rect x="${x}" y="${y - legendFontSize + 2}" width="14" height="${legendFontSize}" rx="2" fill="${s.color}"/>`,
        );
        text(x + 22, y, s.name, 'start', legendFontSize, legendAttributes, legendStyle);
      } else {
        line(x, y - 5, x + 23, y - 5, s.color, style.lineWidth, s.dashed);
        text(x + 31, y, s.name, 'start', legendFontSize, legendAttributes, legendStyle);
      }
    });
    out.push('</g>');
  }
  if (overlay) out.push(overlay.render({ left, top, width: pw, height: ph, sx, sy }));
  out.push('</svg>');
  return out.join('');
}
