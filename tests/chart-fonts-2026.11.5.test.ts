import { describe, expect, it } from 'vitest';
import {
  SANS_FONT_FAMILY,
  SERIF_FONT_FAMILY,
  SONG_FONT_FAMILY,
  TIMES_FONT_FAMILY,
  TIMES_SUBSTITUTE_FAMILY,
  chartFontFamily,
  chartFontStack,
  cjkFamilies,
  effectiveFonts,
  fontRuns,
  latinExportNote,
  latinFamilies,
  pdfFonts,
  previewRuns,
  svgExportFonts,
  svgFontRuns,
} from '../src/domain/chart-fonts-2026.11.3';
import { chartSVG } from '../src/domain/chart';
import { defaultStyle, type ChartStyle, type PlotData } from '../src/domain/types';

/** 宋体 + Times New Roman：Word 式中西文独立排版。 */
const songTimes: ChartStyle = {
  ...defaultStyle('spectra'),
  fontFamily: 'Arial',
  cjkFontFamily: SONG_FONT_FAMILY,
  latinFontFamily: TIMES_FONT_FAMILY,
};
const mixedRuns = (value: string) =>
  fontRuns(value, songTimes).map((run) => [run.text, run.cjk] as const);

describe('中西文字体独立设置', () => {
  it('两个设置互不覆盖，未设置时沿用基础字体', () => {
    const onlyCjk = { ...songTimes, latinFontFamily: undefined };
    expect(effectiveFonts(onlyCjk)).toEqual({
      latin: 'Arial',
      cjk: SONG_FONT_FAMILY,
      mixed: true,
    });
    const onlyLatin = { ...songTimes, cjkFontFamily: undefined };
    expect(effectiveFonts(onlyLatin)).toMatchObject({ latin: TIMES_FONT_FAMILY, cjk: 'Arial' });
    expect(effectiveFonts({ fontFamily: SERIF_FONT_FAMILY }).mixed).toBe(false);
  });

  it('旧工作区没有独立配置时完全保持原字体效果', () => {
    const legacy = { fontFamily: SERIF_FONT_FAMILY };
    expect(chartFontStack(legacy)).toBe(
      `${SERIF_FONT_FAMILY}, ${SONG_FONT_FAMILY}, serif`,
    );
    expect(chartFontStack(legacy)).toBe(chartFontFamily(SERIF_FONT_FAMILY));
    expect(svgFontRuns('荧光强度 Intensity', legacy)).toBe('荧光强度 Intensity');
    expect(pdfFonts(legacy)).toEqual([
      { family: SERIF_FONT_FAMILY, file: 'PerovskiteLabSerif-Regular-2026.11.3' },
      { family: SONG_FONT_FAMILY, file: 'PerovskiteLabSong-Regular-2026.11.3' },
    ]);
  });
});

describe('中英文自动混排', () => {
  it('按 Unicode 类别切分英文、中文与单位', () => {
    expect(mixedRuns('CsPbBr3钙钛矿量子点荧光强度 Intensity (a.u.)')).toEqual([
      ['CsPbBr3', false],
      ['钙钛矿量子点荧光强度', true],
      [' Intensity (a.u.)', false],
    ]);
    expect(mixedRuns('波长 Wavelength (nm)')).toEqual([
      ['波长', true],
      [' Wavelength (nm)', false],
    ]);
    expect(mixedRuns('荧光强度 Intensity (a.u.)')).toEqual([
      ['荧光强度', true],
      [' Intensity (a.u.)', false],
    ]);
  });

  it('浓度单位、上下标与多离子检测仍然分段正确', () => {
    expect(mixedRuns('浓度 Concentration (μmol/L)')).toEqual([
      ['浓度', true],
      [' Concentration (μmol/L)', false],
    ]);
    expect(mixedRuns('R² = 0.9987')).toEqual([['R² = 0.9987', false]]);
    expect(mixedRuns('Pb²⁺、Cd²⁺和Cu²⁺检测')).toEqual([
      ['Pb²⁺', false],
      ['、', true],
      ['Cd²⁺', false],
      ['和', true],
      ['Cu²⁺', false],
      ['检测', true],
    ]);
  });

  it('中文标点与全角字符跟随中文字体', () => {
    expect(mixedRuns('（样品）：Blank')).toEqual([
      ['（样品）：', true],
      ['Blank', false],
    ]);
  });

  it('切分不改变原始字符串', () => {
    for (const sample of [
      'CsPbBr3钙钛矿量子点',
      '波长 Wavelength (nm)',
      '荧光强度 Intensity (a.u.)',
      '浓度 Concentration (μmol/L)',
      'R² = 0.9987',
      'Pb²⁺、Cd²⁺和Cu²⁺检测',
    ])
      expect(fontRuns(sample, songTimes).map((run) => run.text).join('')).toBe(sample);
  });

  it('纯中文或纯西文只产生一个运行段', () => {
    expect(mixedRuns('钙钛矿量子点')).toEqual([['钙钛矿量子点', true]]);
    expect(mixedRuns('CsPbBr3')).toEqual([['CsPbBr3', false]]);
  });

  it('渲染时按运行段写入独立字体，并保证缺字回退', () => {
    expect(svgFontRuns('波长 Wavelength', songTimes)).toBe(
      `<tspan font-family="'Perovskite Lab Song', serif">波长</tspan>` +
        `<tspan font-family="'Times New Roman', 'Tinos', serif"> Wavelength</tspan>`,
    );
    expect(latinFamilies(TIMES_FONT_FAMILY)).toContain(TIMES_SUBSTITUTE_FAMILY);
    expect(cjkFamilies(SONG_FONT_FAMILY)).toContain(SONG_FONT_FAMILY);
    expect(chartFontStack(songTimes)).toBe(
      `'Times New Roman', 'Tinos', 'Perovskite Lab Song', serif`,
    );
  });

  it('预览分段与 SVG 运行段使用同一套字体栈', () => {
    const runs = previewRuns('波长 Wavelength', songTimes);
    expect(runs.map((run) => run.text)).toEqual(['波长', ' Wavelength']);
    expect(runs[0].family).toBe(`'Perovskite Lab Song', serif`);
    expect(runs[1].family).toBe(`'Times New Roman', 'Tinos', serif`);
  });

  it('转义特殊字符，保持原始文本', () => {
    expect(svgFontRuns('A<B>&"C" 中文', songTimes)).toContain('&lt;');
    expect(svgFontRuns('A<B>&"C" 中文', songTimes)).toContain('中文');
  });
});

describe('科研图表应用中西文混排', () => {
  const data: PlotData = {
    series: [
      {
        name: 'Sample A',
        color: '#258873',
        points: [
          { x: 1, y: 2 },
          { x: 2, y: 4 },
        ],
      },
    ],
  };
  it('图表标题与轴标题同时区分中西文字体', () => {
    const svg = chartSVG(data, {
      ...songTimes,
      title: 'CsPbBr3钙钛矿量子点',
      xLabel: '波长 Wavelength (nm)',
      yLabel: '荧光强度 Intensity (a.u.)',
    });
    expect(svg).toContain('font-family="&apos;Times New Roman&apos;, &apos;Tinos&apos;');
    expect(svg).toContain(`<tspan font-family="'Perovskite Lab Song', serif">钙钛矿量子点</tspan>`);
    expect(svg).toContain(`<tspan font-family="'Times New Roman', 'Tinos', serif">CsPbBr3</tspan>`);
    expect(svg).toContain(`<tspan font-family="'Times New Roman', 'Tinos', serif"> Wavelength (nm)</tspan>`);
    // 中英混排不改变原始字符串。
    expect(svg).toContain('波长');
  });

  it('未启用中西文分离时图表输出保持旧结构（无 tspan）', () => {
    const svg = chartSVG(data, {
      ...defaultStyle('spectra'),
      title: '波长 Wavelength',
      fontFamily: 'Arial',
    });
    expect(svg).toContain('>波长 Wavelength</text>');
    expect(svg).not.toContain('<tspan');
  });
});

describe('导出字体选择', () => {
  it('PDF 用度量兼容的 Tinos 代替 Times New Roman', () => {
    expect(pdfFonts(songTimes)).toEqual([
      { family: TIMES_SUBSTITUTE_FAMILY, file: 'Tinos-Regular-2026.11.5' },
      { family: SONG_FONT_FAMILY, file: 'PerovskiteLabSong-Regular-2026.11.3' },
    ]);
    expect(pdfFonts({ fontFamily: 'Arial' })).toEqual([
      { family: SANS_FONT_FAMILY, file: 'PerovskiteLabSans-Regular' },
    ]);
  });

  it('SVG 内嵌中西文两套字体，纯西文图不内嵌大体积中文字体', () => {
    expect(svgExportFonts(songTimes).map((font) => font.family)).toEqual([
      TIMES_SUBSTITUTE_FAMILY,
      SONG_FONT_FAMILY,
    ]);
    expect(svgExportFonts(songTimes, false).map((font) => font.family)).toEqual([
      TIMES_SUBSTITUTE_FAMILY,
    ]);
  });

  it('提示文字直说实际字体，不冒充 Times New Roman', () => {
    const note = latinExportNote(TIMES_FONT_FAMILY);
    expect(note).toContain(TIMES_SUBSTITUTE_FAMILY);
    expect(note).toContain('度量兼容');
  });
});
