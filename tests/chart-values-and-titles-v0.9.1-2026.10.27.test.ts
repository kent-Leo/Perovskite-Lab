import { describe, it, expect } from 'vitest';
import { chartSVG } from '../src/domain/chart';
import {
  defaultStyle,
  type ChartStyle,
  type PlotData,
  type WorkbookTab,
} from '../src/domain/types';
import { fmt } from '../src/domain/math';
import {
  seedSheetChartTitles,
  setActiveSheetChartTitle,
  sheetChartTitle,
  type WorkbookHost,
  type WorkbookState,
} from '../src/domain/workbook';

const styleWith = (overrides: Partial<ChartStyle> = {}): ChartStyle => ({
  ...defaultStyle('spectra'),
  ...overrides,
});

const lineData: PlotData = {
  series: [
    { name: 'sample', color: '#157c65', points: [{ x: 500, y: 12.34 }, { x: 510, y: 56.78 }] },
  ],
};

/** Every rendered data-point value label, with its SVG position. */
function pointValueLabels(svg: string) {
  return [...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*data-point-value="true"[^>]*>([^<]*)<\/text>/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));
}

function circles(svg: string) {
  return [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)"/g)]
    .map((m) => ({ cx: Number(m[1]), cy: Number(m[2]) }));
}

function rects(svg: string) {
  return [...svg.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) }));
}

function hostWith(tabs: WorkbookTab[]): WorkbookHost {
  const workbook: WorkbookState = { tabs, activeId: tabs[0].id, store: {} };
  return { workbooks: { raw: workbook } } as unknown as WorkbookHost;
}

describe('per-sheet chart titles', () => {
  it('uses a sheet own title and never appends the sheet name', () => {
    expect(sheetChartTitle({ id: 'raw', name: '原始光谱' }, '荧光光谱')).toBe('荧光光谱');
    expect(
      sheetChartTitle({ id: 'raw-2', name: 'Sheet 2', chartTitle: '  CsPbCl3响应图 ' }, '荧光光谱'),
    ).toBe('CsPbCl3响应图');
    expect(sheetChartTitle({ id: 'raw-2', name: 'Sheet 2', chartTitle: '   ' }, '荧光光谱')).toBe(
      '荧光光谱',
    );
  });

  it('stores a title on the active sheet only, leaving other sheets untouched', () => {
    const tabs: WorkbookTab[] = [
      { id: 'raw', name: '原始光谱' },
      { id: 'raw-2', name: 'Sheet 2', chartTitle: 'Sheet 2 标题' },
    ];
    const patch = setActiveSheetChartTitle(hostWith(tabs), 'raw', '  CsPbCl3响应图  ');
    const next = patch.workbooks!.raw!;
    expect(next.tabs[0].chartTitle).toBe('CsPbCl3响应图');
    expect(next.tabs[1].chartTitle).toBe('Sheet 2 标题');
    expect(next.activeId).toBe('raw');
  });

  it('clears a sheet title so it falls back to the page default', () => {
    const tabs: WorkbookTab[] = [{ id: 'raw', name: '原始光谱', chartTitle: '旧标题' }];
    const patch = setActiveSheetChartTitle(hostWith(tabs), 'raw', '   ');
    expect(patch.workbooks!.raw!.tabs[0].chartTitle).toBeUndefined();
    expect(sheetChartTitle(patch.workbooks!.raw!.tabs[0], '荧光光谱')).toBe('荧光光谱');
  });

  it('migrates a legacy shared title to sheets without their own title', () => {
    const workbook = hostWith([
      { id: 'raw', name: '原始光谱' },
      { id: 'raw-2', name: 'Sheet 2', chartTitle: '已有标题' },
    ]).workbooks!.raw!;
    const seeded = seedSheetChartTitles(workbook, '  CsPbCl3响应图  ');
    expect(seeded!.tabs[0].chartTitle).toBe('CsPbCl3响应图');
    expect(seeded!.tabs[1].chartTitle).toBe('已有标题');
    // Nothing left to seed / blank legacy title: keep the workbook untouched.
    expect(seedSheetChartTitles(seeded!, '另一个标题')).toBeNull();
    expect(seedSheetChartTitles(workbook, '   ')).toBeNull();
  });
});

describe('显示数据点数值 (pointValues)', () => {
  it('is off by default, including for styles saved before v0.9.1', () => {
    expect(defaultStyle('spectra').pointValues).toBe(false);
    const { pointValues: _omitted, ...legacy } = defaultStyle('spectra');
    const svg = chartSVG(lineData, legacy);
    expect(svg).not.toContain('data-point-value');
    expect(pointValueLabels(svg)).toHaveLength(0);
  });

  it('labels every line/scatter point with fmt(y, 4) and not the legend or axes', () => {
    const svg = chartSVG(lineData, styleWith({ pointValues: true }));
    expect(pointValueLabels(svg).map((l) => l.text)).toEqual([
      fmt(12.34, 4),
      fmt(56.78, 4),
    ]);
    expect(pointValueLabels(svg).map((l) => l.text)).toEqual(['12.34', '56.78']);
    // Labels never join the axis or legend groups.
    for (const group of svg.split('<g data-axis=').slice(1))
      expect(group.slice(0, group.indexOf('</g>'))).not.toContain('data-point-value');
    const legend = svg.split('data-legend="true"')[1]?.split('</g>')[0] ?? '';
    expect(legend).not.toContain('data-point-value');
  });

  it('labels scatter points too and scales the label font from the chart font size', () => {
    const scatter: PlotData = {
      series: [{ name: 'fit', color: '#b6873f', kind: 'scatter', points: [{ x: 1, y: 2.5 }] }],
    };
    const svg = chartSVG(scatter, styleWith({ pointValues: true, fontSize: 20 }));
    const [label] = pointValueLabels(svg);
    expect(label.text).toBe('2.5');
    // max(9, fs * 0.75) = 15 for a 20px chart font.
    expect(svg).toMatch(/data-point-value="true"[^>]*>|font-size="15"[^>]*data-point-value/);
    expect(svg).toContain('font-size="15"');
  });

  it('places line labels below points near the top and above points near the bottom', () => {
    const data: PlotData = {
      series: [{ name: 's', color: '#157c65', points: [{ x: 0, y: 10 }, { x: 10, y: 0 }] }],
    };
    const svg = chartSVG(
      data,
      styleWith({ pointValues: true, points: true, xMin: '0', xMax: '10', yMin: '0', yMax: '10' }),
    );
    const labels = pointValueLabels(svg), pts = circles(svg);
    expect(labels.map((l) => l.text)).toEqual(['10', '0']);
    expect(pts).toHaveLength(2);
    // Matched by x: the top point labels below, the bottom point labels above.
    for (const point of pts) {
      const label = labels.find((l) => Math.abs(l.x - point.cx) < 10)!;
      expect(label).toBeTruthy();
      const value = Number(label.text);
      if (value === 10) expect(label.y).toBeGreaterThan(point.cy);
      else expect(label.y).toBeLessThan(point.cy);
    }
  });

  it('places bar values above positive bars and below negative bars', () => {
    const data: PlotData = {
      categories: ['Up', 'Down'],
      series: [
        {
          name: 'bars',
          color: '#258873',
          kind: 'bar',
          points: [{ x: 0, y: 2.5 }, { x: 1, y: -1.5 }],
        },
      ],
    };
    const svg = chartSVG(data, styleWith({ pointValues: true }));
    const labels = pointValueLabels(svg), bars = rects(svg);
    expect(labels.map((l) => l.text)).toEqual(['2.5', '-1.5']);
    const positive = labels.find((l) => l.text === '2.5')!,
      negative = labels.find((l) => l.text === '-1.5')!,
      positiveBar = bars.find((r) => Math.abs(r.x + r.width / 2 - positive.x) < 1)!,
      negativeBar = bars.find((r) => Math.abs(r.x + r.width / 2 - negative.x) < 1)!;
    expect(positiveBar).toBeTruthy();
    expect(negativeBar).toBeTruthy();
    // Positive: label baseline above the bar's top edge.
    expect(positive.y).toBeLessThan(positiveBar.y);
    // Negative: label baseline below the bar's bottom edge.
    expect(negative.y).toBeGreaterThan(negativeBar.y + negativeBar.height);
  });

  it('skips derived series such as a calibration fit line', () => {
    const data: PlotData = {
      series: [
        { name: '测量值', color: '#258873', kind: 'scatter', points: [{ x: 1, y: 2 }] },
        {
          name: '线性拟合',
          color: '#b6873f',
          showPointValues: false,
          points: [{ x: 0, y: 1 }, { x: 2, y: 3 }],
        },
      ],
    };
    const labels = pointValueLabels(chartSVG(data, styleWith({ pointValues: true })));
    expect(labels.map((l) => l.text)).toEqual(['2']);
  });

  it('escapes XML in a per-sheet title', () => {
    const style = styleWith({ pointValues: true });
    const svg = chartSVG(lineData, { ...style, title: '<荧光 & 光谱>' });
    expect(svg).toContain('&lt;荧光 &amp; 光谱&gt;');
    expect(svg).not.toContain('<荧光');
  });

  it('does not choke on many points', () => {
    const data: PlotData = {
      series: [
        {
          name: 'dense',
          color: '#157c65',
          points: Array.from({ length: 500 }, (_, i) => ({ x: i, y: 10 + Math.sin(i) * 5 })),
        },
      ],
    };
    const svg = chartSVG(data, styleWith({ pointValues: true }));
    expect(pointValueLabels(svg)).toHaveLength(500);
    expect(svg).not.toContain('NaN');
  });
});
