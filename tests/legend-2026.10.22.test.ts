import { describe, expect, it } from 'vitest';
import { chartSVG } from '../src/domain/chart';
import { defaultStyle, type ChartStyle, type PlotData } from '../src/domain/types';

function legendOf(svg: string) {
  return svg.match(/<g data-legend="true"[^>]*>([\s\S]*?)<\/g>/);
}
const lineData: PlotData = {
  series: [
    { name: 'Blank', color: '#157c65', points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] },
    { name: 'Sample A', color: '#5984c7', points: [{ x: 0, y: 2 }, { x: 1, y: 3 }] },
  ],
};
const style = (patch: Partial<ChartStyle> = {}): ChartStyle => ({
  ...defaultStyle('spectra'),
  ...patch,
});

describe('movable chart legend', () => {
  it('renders a free legend at the stored relative position with its own font size', () => {
    const svg = chartSVG(
      lineData,
      style({ legend: 'free', legendX: 0.42, legendY: 0.31, legendFontSize: 22 }),
    );
    const legend = legendOf(svg);
    expect(legend).not.toBeNull();
    expect(legend![0]).toContain('data-legend-x="0.420000"');
    expect(legend![0]).toContain('data-legend-y="0.310000"');
    expect(legend![1]).toContain('font-size="22"');
    expect(legend![1]).toContain('Blank');
    expect(legend![1]).toContain('Sample A');
  });

  it('keeps the legend inside the canvas and falls back to the axis font size', () => {
    const svg = chartSVG(lineData, style({ legend: 'free', legendX: 1, legendY: 1 }));
    const legend = legendOf(svg)!;
    const x = Number(legend[0].match(/data-legend-x="([\d.]+)"/)![1]),
      y = Number(legend[0].match(/data-legend-y="([\d.]+)"/)![1]);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(1);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(1);
    expect(legend[1]).toContain(`font-size="${defaultStyle('spectra').fontSize}"`);
  });

  it('draws legend swatches for screening bars and keeps right/bottom modes draggable', () => {
    const svg = chartSVG(
      {
        categories: ['Blank', '目标物'],
        series: [
          { name: 'Blank', color: '#a7b8b3', kind: 'bar', points: [{ x: 0, y: 1 }] },
          { name: '目标物', color: '#b6873f', kind: 'bar', points: [{ x: 1, y: 0.3 }] },
        ],
      },
      { ...defaultStyle('screening'), legend: 'free', legendFontSize: 18 },
    );
    const legend = legendOf(svg)!;
    expect(legend[1]).toContain('<rect');
    expect(legend[1]).toContain('font-size="18"');
    for (const mode of ['right', 'bottom'] as const) {
      const fixed = legendOf(chartSVG(lineData, style({ legend: mode, legendFontSize: 20 })));
      expect(fixed).not.toBeNull();
      expect(fixed![1]).toContain('font-size="20"');
    }
  });
});
