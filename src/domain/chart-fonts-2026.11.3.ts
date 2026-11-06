export const SONG_FONT_FAMILY = 'Perovskite Lab Song';
export const SONG_FONT_FILE = 'PerovskiteLabSong-Regular-2026.11.3';
export const SERIF_FONT_FAMILY = 'Perovskite Lab Serif';
export const SERIF_FONT_FILE = 'PerovskiteLabSerif-Regular-2026.11.3';
export const SANS_FONT_FAMILY = 'Perovskite Lab Sans';
export const SANS_FONT_FILE = 'PerovskiteLabSans-Regular';
export const ARIAL_FONT_FAMILY = 'Arial';
export const TIMES_FONT_FAMILY = 'Times New Roman';
/**
 * Times New Roman 受授权限制不能随项目分发，浏览器也无法读取系统字体文件。
 * 导出使用度量兼容、可嵌入的 Tinos（SIL OFL 1.1），界面明确标注实际字体。
 */
export const TIMES_SUBSTITUTE_FAMILY = 'Tinos';
export const TIMES_SUBSTITUTE_FILE = 'Tinos-Regular-2026.11.5';

/** 所有科研图件共用的排版字段。 */
export type ChartTypography = {
  fontFamily: string;
  /** 中文字体；未设置时沿用 fontFamily，旧工作区保持原样。 */
  cjkFontFamily?: string;
  /** 西文字体；未设置时沿用 fontFamily，旧工作区保持原样。 */
  latinFontFamily?: string;
  legendFontFamily?: string;
};

export function legendTypography(style: ChartTypography): ChartTypography {
  if (!style.legendFontFamily) return style;
  const family = style.legendFontFamily;
  return { fontFamily: family, latinFontFamily: family,
    cjkFontFamily: family === SANS_FONT_FAMILY || family === ARIAL_FONT_FAMILY ? SANS_FONT_FAMILY : SONG_FONT_FAMILY };
}
type EmbeddableFont = { family: string; file: string };

export const CJK_FONT_OPTIONS = [
  { value: SONG_FONT_FAMILY, label: '宋体（Noto Serif SC）' },
  { value: SANS_FONT_FAMILY, label: '黑体（Noto Sans SC）' },
  { value: SERIF_FONT_FAMILY, label: '衬线（中文回退宋体）' },
] as const;

export const LATIN_FONT_OPTIONS = [
  { value: TIMES_FONT_FAMILY, label: 'Times New Roman' },
  { value: ARIAL_FONT_FAMILY, label: 'Arial' },
  { value: SERIF_FONT_FAMILY, label: 'Perovskite Lab Serif（衬线）' },
  { value: SANS_FONT_FAMILY, label: 'Perovskite Lab Sans（无衬线）' },
  { value: SONG_FONT_FAMILY, label: 'Perovskite Lab Song（宋体拉丁）' },
] as const;

export function chartFontFamily(fontFamily: string): string {
  return fontFamily === SERIF_FONT_FAMILY
    ? `${SERIF_FONT_FAMILY}, ${SONG_FONT_FAMILY}, serif`
    : `${fontFamily}, Perovskite Lab Sans, sans-serif`;
}

/** 中西文分别设置后的字体对；mixed 为 false 时完全沿用旧逻辑。 */
export function effectiveFonts(style: ChartTypography) {
  const mixed = !!(style.cjkFontFamily || style.latinFontFamily);
  const latin = style.latinFontFamily || style.fontFamily;
  const cjk = style.cjkFontFamily || style.fontFamily;
  return { latin, cjk, mixed };
}

/** 西文字体的浏览器 / SVG 回退链，末项为通用族。 */
export function latinFamilies(family: string): string[] {
  if (family === TIMES_FONT_FAMILY) return [TIMES_FONT_FAMILY, TIMES_SUBSTITUTE_FAMILY, 'serif'];
  if (family === SERIF_FONT_FAMILY || family === SONG_FONT_FAMILY)
    return [family, SANS_FONT_FAMILY, 'serif'];
  if (!family) return [SANS_FONT_FAMILY, 'sans-serif'];
  return [family, SANS_FONT_FAMILY, 'sans-serif'];
}

/** 中文字体的回退链：首选字体缺字时仍能拿到中日韩字形。 */
export function cjkFamilies(family: string): string[] {
  if (family === SANS_FONT_FAMILY) return [SANS_FONT_FAMILY, SONG_FONT_FAMILY, 'sans-serif'];
  if (family === SERIF_FONT_FAMILY) return [SERIF_FONT_FAMILY, SONG_FONT_FAMILY, 'serif'];
  return [SONG_FONT_FAMILY, 'serif'];
}

/** 家族名带空格或中文时加引号，通用族保持裸写。 */
export function cssFontList(families: string[]): string {
  const seen = new Set<string>();
  return families
    .filter((family) => !!family && !seen.has(family) && !!seen.add(family))
    .map((family) => (/^[a-z-]+$/.test(family) ? family : `'${family.replace(/'/g, '\u2019')}'`))
    .join(', ');
}

/** 预览与 SVG 根节点的 font-family；未启用中西文分离时保持 v0.9.3 的输出。 */
export function chartFontStack(style: ChartTypography): string {
  const { latin, cjk, mixed } = effectiveFonts(style);
  if (!mixed) return chartFontFamily(style.fontFamily);
  const latinList = latinFamilies(latin),
    generic = latinList.at(-1)!,
    cjkList = cjkFamilies(cjk).filter((family) => !/^[a-z-]+$/.test(family));
  return cssFontList([...latinList.slice(0, -1), ...cjkList, generic]);
}

/** 单个西文 / 中文运行段的 font-family。 */
export function latinFontStack(family: string): string {
  return cssFontList(latinFamilies(family));
}
export function cjkFontStack(family: string): string {
  return cssFontList(cjkFamilies(family));
}

/**
 * CJK 表意文字、扩展/兼容区、中日韩标点与全角形式。
 * 其余字符（英文、数字、希腊字母、数学符号）按西文字体渲染。
 */
const CJK_PATTERN =
  /[\u2e80-\u2fdf\u3000-\u303f\u3040-\u30ff\u31c0-\u31ef\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/u;

export type FontRun = { text: string; cjk: boolean };

/** 按 Unicode 类别切分中文 / 西文运行段，不改变任何原始字符。 */
export function fontRuns(value: string, style: ChartTypography): FontRun[] {
  const { mixed } = effectiveFonts(style);
  if (!mixed) return value ? [{ text: value, cjk: false }] : [];
  const runs: FontRun[] = [];
  for (const char of value) {
    const cjk = CJK_PATTERN.test(char),
      last = runs.at(-1);
    if (last && last.cjk === cjk) last.text += char;
    else runs.push({ text: char, cjk });
  }
  return runs;
}

const escapeText = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
/** 双引号属性值里的单引号无需转义，字体名可以保持可读。 */
const escapeAttr = (value: string) =>
  value.replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!,
  );

/**
 * `<text>` 的内容：启用中西文分离且确实混排时才切成 `<tspan font-family>`；
 * 纯中文或纯西文仍是一次文本节点，由根节点 font-family 统一决定。
 */
export function svgFontRuns(value: string, style: ChartTypography): string {
  const { latin, cjk, mixed } = effectiveFonts(style);
  if (!mixed || !value) return escapeText(value);
  const runs = fontRuns(value, style);
  if (runs.length < 2) return escapeText(value);
  return runs
    .map(
      (run) =>
        `<tspan font-family="${escapeAttr(run.cjk ? cjkFontStack(cjk) : latinFontStack(latin))}">${escapeText(run.text)}</tspan>`,
    )
    .join('');
}

/** 预览用的文本分段，React 直接渲染 span，字体栈与 SVG 完全一致。 */
export function previewRuns(value: string, style: ChartTypography) {
  const { latin, cjk, mixed } = effectiveFonts(style);
  if (!mixed) return [{ text: value, family: chartFontFamily(style.fontFamily), cjk: false }];
  return fontRuns(value, style).map((run) => ({
    text: run.text,
    family: run.cjk ? cjkFontStack(cjk) : latinFontStack(latin),
    cjk: run.cjk,
  }));
}

function bundledFont(family: string): EmbeddableFont[] {
  if (family === SONG_FONT_FAMILY) return [{ family: SONG_FONT_FAMILY, file: SONG_FONT_FILE }];
  if (family === SERIF_FONT_FAMILY) return [{ family: SERIF_FONT_FAMILY, file: SERIF_FONT_FILE }];
  if (family === SANS_FONT_FAMILY) return [{ family: SANS_FONT_FAMILY, file: SANS_FONT_FILE }];
  if (family === TIMES_SUBSTITUTE_FAMILY)
    return [{ family: TIMES_SUBSTITUTE_FAMILY, file: TIMES_SUBSTITUTE_FILE }];
  return [];
}

/** 体积很大的中文字体只在图件确实含中文时才内嵌，避免英文图无谓增大。 */
const LARGE_CJK_FONTS = new Set<string>([SONG_FONT_FAMILY, SANS_FONT_FAMILY]);

/** SVG / PNG 导出需要内嵌的字体，顺序与根节点 font-family 完全一致。 */
export function svgExportFonts(style: ChartTypography, hasWideText = true): EmbeddableFont[] {
  const { latin, cjk, mixed } = effectiveFonts(style);
  const families = mixed
    ? [...latinFamilies(latin), ...cjkFamilies(cjk)]
    : style.fontFamily === SERIF_FONT_FAMILY
      ? [SERIF_FONT_FAMILY, SONG_FONT_FAMILY]
      : [style.fontFamily, SANS_FONT_FAMILY];
  const seen = new Set<string>();
  return families
    .flatMap(bundledFont)
    .filter((font) => (hasWideText || !LARGE_CJK_FONTS.has(font.family)))
    .filter((font) => !seen.has(font.family) && !!seen.add(font.family));
}

/**
 * PDF 只能嵌入字体文件本身：系统字体（Times New Roman / Arial）用同许可、
 * 度量兼容的内置字体代替。西文字体排在前面，逐字符选择时西文优先。
 */
export function pdfFonts(style: ChartTypography): EmbeddableFont[] {
  const { latin, cjk } = effectiveFonts(style);
  const embed = (family: string): EmbeddableFont[] => {
    if (family === TIMES_FONT_FAMILY)
      return [{ family: TIMES_SUBSTITUTE_FAMILY, file: TIMES_SUBSTITUTE_FILE }];
    // 衬线字体本身没有中文，逐字符选择依赖宋体作为后备。
    if (family === SERIF_FONT_FAMILY)
      return [
        { family: SERIF_FONT_FAMILY, file: SERIF_FONT_FILE },
        { family: SONG_FONT_FAMILY, file: SONG_FONT_FILE },
      ];
    const bundled = bundledFont(family);
    return bundled.length ? bundled : [{ family: SANS_FONT_FAMILY, file: SANS_FONT_FILE }];
  };
  const seen = new Set<string>();
  return [...embed(latin), ...embed(cjk)].filter(
    (font) => !seen.has(font.family) && !!seen.add(font.family),
  );
}

/** 界面提示：导出时实际使用的西文字体，与所选不同即说明替代关系。 */
export function latinExportNote(family: string): string {
  if (family === TIMES_FONT_FAMILY)
    return `PDF / SVG 嵌入 ${TIMES_SUBSTITUTE_FAMILY}（Times New Roman 的度量兼容开源替代），未安装 Times New Roman 的设备排版仍然一致`;
  if (family === ARIAL_FONT_FAMILY) return `PDF 嵌入 ${SANS_FONT_FAMILY} 代替系统 Arial`;
  return `PDF / SVG 嵌入 ${family}`;
}
