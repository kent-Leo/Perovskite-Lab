import { describe, expect, it } from 'vitest';
import { chartSVG, groupedBarLayout } from '../src/domain/chart';
import { defaultGroupedBar, emptyGroupedCell, groupedPlotData } from '../src/domain/grouped-bar-2026.11.6';

function fixture() {
  const sheet = defaultGroupedBar();
  sheet.series.forEach((series, index) => { series.name = `探针 ${String.fromCharCode(65 + index)}`; });
  sheet.categories = Array.from({ length: 15 }, (_, index) => ({
    id: `ion-${index}`, name: index ? `Ion ${index}²⁺` : 'Cd²⁺',
    cells: Object.fromEntries(sheet.series.map((series, seriesIndex) => [series.id, {
      ...emptyGroupedCell(), mean: index === 1 && seriesIndex === 1 ? '' : String(index === 0 ? [10, -4, 0][seriesIndex] : index + seriesIndex),
      sd: index === 0 ? '2' : '',
    }])),
  }));
  sheet.options.errorMode = 'sd';
  return sheet;
}

function bar(svg: string, series: number, category: number) {
  const match = svg.match(new RegExp(`<g data-grouped-bar="true" data-series-index="${series}" data-category-index="${category}"><rect x="([\\d.]+)" y="([\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`));
  if (!match) throw new Error('bar missing');
  return { x: +match[1], y: +match[2], width: +match[3], height: +match[4] };
}

describe('分组柱状图绘制', () => {
  it('计算各系列独立位置，15 组数据中的缺失值保持空白，零值保留', () => {
    const sheet = fixture();
    const svg = chartSVG(groupedPlotData(sheet), sheet.style);
    expect(svg.match(/data-grouped-bar="true"/g)).toHaveLength(44);
    const first = [0, 1, 2].map((i) => bar(svg, i, 0));
    expect(first[0].x + first[0].width).toBeLessThan(first[1].x);
    expect(first[1].x + first[1].width).toBeLessThan(first[2].x);
    expect(svg).not.toContain('data-series-index="1" data-category-index="1"');
    expect(bar(svg, 2, 0).height).toBeGreaterThan(0);
    expect(svg).toContain('Cd²⁺');
    expect(svg).toContain('探针 A');
    const slot0 = groupedBarLayout(100, 0, 3, 150, sheet.options);
    const slot1 = groupedBarLayout(100, 1, 3, 150, sheet.options);
    expect(slot1.x - slot0.x - slot0.width).toBeCloseTo(sheet.options.innerGap);
  });

  it('误差棒以均值为中心，并被自动范围完整容纳', () => {
    const sheet = fixture();
    const svg = chartSVG(groupedPlotData(sheet), sheet.style);
    const b = bar(svg, 0, 0);
    const match = svg.match(/<g data-error-bar="true" data-series-index="0" data-category-index="0"><line x1="([\d.]+)" y1="([\d.]+)" x2="[\d.]+" y2="([\d.]+)"/)!;
    expect(+match[1]).toBeCloseTo(b.x + b.width / 2);
    const unit = b.height / 10;
    expect(+match[2]).toBeCloseTo(b.y - 2 * unit);
    expect(+match[3]).toBeCloseTo(b.y + 2 * unit);
    const clip = svg.match(/<clipPath id="[^"]+"><rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/)!;
    expect(+match[2]).toBeGreaterThanOrEqual(+clip[1]);
    expect(+match[3]).toBeLessThanOrEqual(+clip[1] + +clip[2]);
  });

  it('系列显隐改变布局和图例，渐变与误差仍保持 SVG 矢量', () => {
    const sheet = fixture();
    sheet.series[1].visible = false;
    sheet.options.fill = 'gradient';
    sheet.options.borderWidth = 1;
    sheet.options.categoryAngle = 0;
    sheet.style.legend = 'top';
    const svg = chartSVG(groupedPlotData(sheet), sheet.style);
    expect(svg.match(/data-grouped-bar="true"/g)).toHaveLength(30);
    expect(svg).not.toContain('探针 B');
    expect(svg).toContain('data-error-bar="true"');
    expect(svg).toContain('stroke-width="1"');
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('rotate(-30');
  });

  it('多 Sheet 使用不同的裁剪与渐变定义；异常尺寸和溢出端点明确报错', () => {
    const a = fixture(), b = fixture();
    a.options.fill = b.options.fill = 'gradient';
    b.series[0].color = '#ee6644'; b.options.barWidth = 55;
    const svgA = chartSVG(groupedPlotData(a), a.style), svgB = chartSVG(groupedPlotData(b), b.style);
    expect(svgA.match(/<linearGradient id="([^"]+)/)![1]).not.toBe(svgB.match(/<linearGradient id="([^"]+)/)![1]);
    expect(svgA.match(/<clipPath id="([^"]+)/)![1]).not.toBe(svgB.match(/<clipPath id="([^"]+)/)![1]);
    a.options.innerGap = NaN;
    expect(() => chartSVG(groupedPlotData(a), a.style)).toThrow('尺寸');
    const data = groupedPlotData(b); data.series[0].points[0] = { x: 0, y: 1e308, error: 1e308 };
    expect(() => chartSVG(data, b.style)).toThrow('端点');
  });

  it('相近的大数值不会让相邻柱顶标签和宽端帽重叠', () => {
    const sheet = fixture();
    sheet.categories = [sheet.categories[0]];
    sheet.series.forEach((series, index) => { sheet.categories[0].cells[series.id].mean = String(123456 + index); });
    sheet.style.pointValues = true; sheet.options.errorCapWidth = 60;
    const svg = chartSVG(groupedPlotData(sheet), sheet.style);
    const boxes = [0, 1, 2].map((i) => bar(svg, i, 0));
    expect(boxes[1].x - boxes[0].x).toBeGreaterThan(60);
    expect(boxes[2].x - boxes[1].x).toBeGreaterThan(60);
    expect(svg.match(/text-anchor="middle" data-point-value="true"/g)).toHaveLength(3);
  });
});
