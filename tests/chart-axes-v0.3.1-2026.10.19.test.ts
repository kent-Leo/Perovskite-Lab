import { describe, it, expect } from 'vitest';
import { chartSVG } from '../src/domain/chart';
import { defaultStyle, chartAxes, type PlotData } from '../src/domain/types';
const data: PlotData = { series: [{ name: 'sample', color: '#157c65', points: [{ x: 0, y: 0 }, { x: 10, y: 100 }] }] };
describe('four-sided axes', () => {
  it('renders legacy workspaces using bottom/left defaults without mutating the style', () => {
    const style = defaultStyle('spectra');
    const svg = chartSVG(data, style);
    expect(svg).toContain('data-axis="bottom"');
    expect(svg).toContain('data-axis="left"');
    expect(svg).not.toContain('data-axis="top"');
    expect(svg).not.toContain('data-axis="right"');
    expect(style.axes).toBeUndefined();
    expect(chartAxes({ ...style, xLabel: 'changed' }).bottom.label).toBe('changed');
  });
  it('renders each side independently and escapes titles', () => {
    const style = defaultStyle('spectra');
    style.axes = { bottom: { visible: false }, left: { ticks: 'none', tickLabels: false },
      top: { visible: true, label: '<top & label>', divisions: 4 },
      right: { visible: true, label: 'right', ticks: 'both', divisions: 2, tickLength: 10, tickWidth: 3 } };
    const svg = chartSVG(data, style);
    expect(svg).not.toContain('data-axis="bottom"');
    expect(svg).toContain('&lt;top &amp; label&gt;');
    const right = svg.split('data-axis="right"')[1].split('</g></g>')[0];
    expect(right.match(/stroke-width="3"/g)).toHaveLength(3);
    const left = svg.split('data-axis="left"')[1].split('</g></g>')[0];
    expect(left).toContain('<g data-axis-ticks="true"></g>');
    expect(left).toContain('<g data-axis-tick-labels="true"></g>');
  });
  it('honors category names and filters ticks outside the chosen range', () => {
    const svg = chartSVG({ series: [{ ...data.series[0], kind: 'bar', points: [{ x: 0, y: 5 }, { x: 1, y: 10 }] }], categories: ['A', 'B'] },
      { ...defaultStyle('screening'), xMin: '0.5', axes: { top: { visible: true } } });
    const top = svg.split('data-axis="top"')[1].split('data-axis="left"')[0];
    expect(top).not.toContain('>A</text>');
    expect(top).toContain('>B</text>');
    expect(top).not.toContain('NaN');
  });
  it('rejects unbounded or invalid tick settings', () => {
    for (const divisions of [0, -1, 1.5, 21, Infinity])
      expect(() => chartSVG(data, { ...defaultStyle('spectra'), axes: { bottom: { divisions } } })).toThrow('刻度分段数');
    expect(() => chartSVG(data, { ...defaultStyle('spectra'), axes: { top: { tickLength: NaN } } })).toThrow('刻度长度');
  });
});
