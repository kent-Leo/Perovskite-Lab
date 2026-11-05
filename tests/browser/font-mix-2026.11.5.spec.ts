import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import {
  SONG_FONT_FAMILY,
  TIMES_FONT_FAMILY,
  TIMES_SUBSTITUTE_FAMILY,
} from '../../src/domain/chart-fonts-2026.11.3';

const evidence = path.resolve(process.env.LAB_EVIDENCE_DIR || 'docs/验收-中西文字体-2026.11.5');
const workspaceStyle = (page: Page, kind = 'spectra') =>
  page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1') || '{}').styles?.[key] ?? {},
    kind,
  );
/** 工作区在挂载 500ms 后才写入 localStorage，先等到首帧落盘再断言或改写。 */
const waitSaved = (page: Page) =>
  page.waitForFunction(() => !!localStorage.getItem('perovskite-lab-workspace-v1'));

async function download(page: Page, format: 'PNG' | 'SVG' | 'PDF', name: string) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: format, exact: true }).click();
  const file = path.join(evidence, name);
  await (await event).saveAs(file);
  return readFileSync(file);
}

/** 读取每个文本运行段实际使用的系统字体，确认中西文分别落到不同字体。 */
async function platformFonts(page: Page, selector: string) {
  const client = await page.context().newCDPSession(page);
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const doc = await client.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await client.send('DOM.querySelectorAll', {
    nodeId: doc.root.nodeId,
    selector,
  });
  const result: { text: string; fonts: { familyName: string; glyphCount: number }[] }[] = [];
  for (const nodeId of nodeIds) {
    const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
    const { outerHTML } = await client.send('DOM.getOuterHTML', { nodeId });
    const text = outerHTML
      .replace(/^<[^>]*>|<\/[^>]*>$/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    result.push({ text, fonts });
  }
  await client.detach();
  return result;
}

test('宋体 + Times New Roman 预设让中西文分别使用独立字体并持久化', async ({ page }) => {
  await page.goto('/');
  await waitSaved(page);
  await page.getByRole('button', { name: '宋体 + Times New Roman' }).click();
  await expect.poll(async () => (await workspaceStyle(page)).cjkFontFamily).toBe(SONG_FONT_FAMILY);
  await expect.poll(async () => (await workspaceStyle(page)).latinFontFamily).toBe(
    TIMES_FONT_FAMILY,
  );
  await page.reload();
  await expect(page.getByLabel('中文字体', { exact: true })).toHaveValue(SONG_FONT_FAMILY);
  await expect(page.getByLabel('西文字体', { exact: true })).toHaveValue(TIMES_FONT_FAMILY);

  const title = 'CsPbBr3钙钛矿量子点荧光强度 Intensity (a.u.)';
  await page.getByLabel('图表标题', { exact: true }).fill(title);
  await page.getByRole('button', { name: '坐标', exact: true }).click();
  await page.getByRole('button', { name: '左轴', exact: true }).click();
  await page.getByLabel('左轴名称', { exact: true }).fill('浓度 Concentration (μmol/L)');
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);

  const chart = page.getByTestId('spectra-chart');
  await expect(chart.locator('svg')).toHaveAttribute('font-family', /Perovskite Lab Song/);
  await expect(chart.locator('svg')).toHaveAttribute('font-family', /Times New Roman/);
  const titleText = chart.locator('text').first();
  await expect(titleText.locator('tspan')).toHaveCount(3);
  await expect(titleText).toContainText('CsPbBr3');
  await expect(titleText).toContainText('钙钛矿量子点荧光强度');
  await expect(titleText).toContainText('Intensity (a.u.)');

  const fonts = await platformFonts(page, '[data-testid="spectra-chart"] text tspan');
  const latin = fonts.filter((run) => /[A-Za-z]/.test(run.text));
  const chinese = fonts.filter((run) => /[\u4e00-\u9fff]/.test(run.text));
  expect(latin.length).toBeGreaterThan(0);
  expect(chinese.length).toBeGreaterThan(0);
  for (const run of chinese)
    expect(run.fonts.map((font) => font.familyName)).toEqual([SONG_FONT_FAMILY]);
  for (const run of latin)
    expect([TIMES_FONT_FAMILY, TIMES_SUBSTITUTE_FAMILY]).toContain(
      run.fonts[0].familyName,
    );
  // 旋转的左轴标题同样区分中西文。
  const rotated = chart.locator('text[transform^="rotate"]');
  await expect(rotated.locator('tspan')).toHaveCount(2);

  mkdirSync(evidence, { recursive: true });
  await page.locator('.chart-layout').first().screenshot({
    path: path.join(evidence, '中西文混排预览-2026.11.5.png'),
    animations: 'disabled',
  });
});

test('修改中文字体不覆盖西文设置，反之亦然，且实时预览同步', async ({ page }) => {
  await page.goto('/');
  await waitSaved(page);
  await page.getByRole('button', { name: '宋体 + Times New Roman' }).click();
  await page.getByLabel('中文字体', { exact: true }).selectOption('Perovskite Lab Sans');
  await expect.poll(async () => (await workspaceStyle(page)).latinFontFamily).toBe(
    TIMES_FONT_FAMILY,
  );
  await expect.poll(async () => (await workspaceStyle(page)).cjkFontFamily).toBe(
    'Perovskite Lab Sans',
  );
  await page.getByLabel('西文字体', { exact: true }).selectOption('Arial');
  await expect.poll(async () => (await workspaceStyle(page)).cjkFontFamily).toBe(
    'Perovskite Lab Sans',
  );
  const preview = page.getByTestId('font-mix-preview');
  const families = await preview.locator('span').evaluateAll((spans) =>
    spans.map((span) => getComputedStyle(span).fontFamily),
  );
  expect(families.some((family) => family.includes('Perovskite Lab Sans'))).toBe(true);
  expect(families.some((family) => family.includes('Arial'))).toBe(true);
  await expect(page.getByTestId('font-mix-note')).toContainText('Perovskite Lab Sans');
  await expect(page.getByTestId('font-mix-note')).toContainText('Arial');
  // 基础字体切换会重设整套排版，避免中西文选择被静默忽略。
  await page.getByLabel('字体', { exact: true }).selectOption('Perovskite Lab Serif');
  await expect.poll(async () => (await workspaceStyle(page)).cjkFontFamily).toBeUndefined();
});

test('旧工作区没有中西文独立配置时保持原字体效果', async ({ page }) => {
  await page.goto('/');
  await waitSaved(page);
  await page.evaluate(() => {
    const key = 'perovskite-lab-workspace-v1';
    const stored = JSON.parse(localStorage.getItem(key) || '{}');
    if (stored.styles?.spectra) {
      delete stored.styles.spectra.cjkFontFamily;
      delete stored.styles.spectra.latinFontFamily;
      stored.styles.spectra.fontFamily = 'Perovskite Lab Serif';
    }
    localStorage.setItem(key, JSON.stringify(stored));
  });
  await page.reload();
  const chart = page.getByTestId('spectra-chart');
  await expect(chart.locator('svg')).toHaveAttribute(
    'font-family',
    'Perovskite Lab Serif, Perovskite Lab Song, serif',
  );
  await expect(chart.locator('tspan')).toHaveCount(0);
});

test('SVG、PNG、PDF 导出保持同一套中西文字体组合', async ({ page }, info) => {
  await page.goto('/');
  await waitSaved(page);
  await page.getByRole('button', { name: '宋体 + Times New Roman' }).click();
  await page.getByLabel('图表标题', { exact: true }).fill('CsPbBr3钙钛矿量子点 Intensity (a.u.)');
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(evidence, { recursive: true });
  const stamp = info.project.name ? `-${info.project.name}` : '';
  const png = await download(page, 'PNG', `中西文混排${stamp}-2026.11.5.png`);
  const svg = (await download(page, 'SVG', `中西文混排${stamp}-2026.11.5.svg`)).toString();
  const faces = [...svg.matchAll(/@font-face\{font-family:'([^']+)'/g)].map((match) => match[1]);
  expect(faces).toEqual([TIMES_SUBSTITUTE_FAMILY, SONG_FONT_FAMILY]);
  expect(svg).toContain('<tspan font-family=');
  expect(svg).toContain(SONG_FONT_FAMILY);
  const pdf = await PDFDocument.load(await download(page, 'PDF', `中西文混排${stamp}-2026.11.5.pdf`));
  const fonts = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  const names = fonts
    .keys()
    .map((key) => fonts.lookup(key, PDFDict).get(PDFName.of('BaseFont'))!.toString())
    .join(' ');
  expect(names).toContain('Tinos');
  expect(names).toContain('PerovskiteLabSong');

  // PNG 与 SVG 在同一浏览器内渲染结果一致（字形、宽度、基线）。
  const difference = await page.evaluate(
    async ({ svgText, pngBase64 }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
      try {
        const [actual, expected] = await Promise.all([
          load(`data:image/png;base64,${pngBase64}`),
          load(url),
        ]);
        const canvas = document.createElement('canvas');
        canvas.width = actual.width;
        canvas.height = actual.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(actual, 0, 0);
        const a = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(expected, 0, 0, canvas.width, canvas.height);
        const b = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let changed = 0;
        for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 2) changed++;
        return changed / a.length;
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    { svgText: svg, pngBase64: png.toString('base64') },
  );
  expect(difference).toBeLessThan(0.00001);
});
