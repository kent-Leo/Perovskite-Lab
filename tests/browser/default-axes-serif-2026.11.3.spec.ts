import { test, expect, type Locator } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { SERIF_FONT_FAMILY, SERIF_FONT_FILE, SONG_FONT_FAMILY } from '../../src/domain/chart-fonts-2026.11.3';

const evidence = path.resolve('docs/验收-四边轴与衬线字体-2026.11.3');
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
async function assertDefaultAxes(chart: Locator) {
  await expect(chart.locator('[data-axis]')).toHaveCount(4);
  for (const side of ['top', 'right']) {
    const axis = chart.locator(`[data-axis="${side}"]`);
    await expect(axis.locator('line')).toHaveCount(1);
    await expect(axis.locator('text')).toHaveCount(0);
  }
  for (const side of ['bottom', 'left']) {
    const axis = chart.locator(`[data-axis="${side}"]`);
    await expect(axis.locator('[data-axis-tick-labels] text')).not.toHaveCount(0);
    const lengths = await axis.evaluate((node, side) => {
      const key = side === 'bottom' ? 'y' : 'x';
      const baseline = Number(node.querySelector('line')!.getAttribute(`${key}1`));
      return [...node.querySelectorAll('[data-axis-ticks] line')].map((tick) => [
        Number(tick.getAttribute(`${key}1`)) - baseline,
        Number(tick.getAttribute(`${key}2`)) - baseline,
      ]);
    }, side);
    expect(lengths.length).toBeGreaterThan(0);
    for (const [inside, outside] of lengths) {
      expect(inside).toBeCloseTo(side === 'bottom' ? -5 : 5, 8);
      expect(outside).toBeCloseTo(0, 8);
    }
  }
}

for (const kind of ['spectra', 'screening', 'calibration']) {
  test(`${kind} defaults to a four-sided frame and preserves deliberate overrides on reload`, async ({ page }) => {
    await page.goto(`/#${kind}`);
    const chart = page.getByTestId(`${kind}-chart`);
    await assertDefaultAxes(chart);
    const values = await chart.locator('polyline, [data-point]').evaluateAll((elements) => elements.map((el) => el.outerHTML));
    await page.getByRole('button', { name: '坐标', exact: true }).click();
    await expect(page.getByLabel('下轴刻度线', { exact: true })).toHaveValue('in');
    await page.getByLabel('下轴刻度线', { exact: true }).selectOption('out');
    await page.getByRole('button', { name: '上轴', exact: true }).click();
    await expect(page.getByLabel('上轴刻度线', { exact: true })).toHaveValue('none');
    await expect(page.getByLabel('显示上轴刻度标签', { exact: true })).not.toBeChecked();
    await page.getByLabel('显示上轴', { exact: true }).uncheck();
    await expect.poll(() => page.evaluate((kind) => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1') || '{}').styles?.[kind]?.axes?.top?.visible, kind)).toBe(false);
    await page.reload();
    await expect(chart.locator('[data-axis="top"]')).toHaveCount(0);
    await page.getByRole('button', { name: '坐标', exact: true }).click();
    await expect(page.getByLabel('下轴刻度线', { exact: true })).toHaveValue('out');
    expect(await chart.locator('polyline, [data-point]').count()).toBe(values.length);
  });
}

test('PCA respects the same default axes and exposes all four axis controls', async ({ page }) => {
  await page.goto('/#recognition');
  await page.getByRole('button', { name: '载入演示数据', exact: true }).click();
  const chart = page.getByTestId('recognition-scores-chart');
  await assertDefaultAxes(chart);
  await page.getByRole('button', { name: '坐标', exact: true }).click();
  await page.getByRole('button', { name: '右轴', exact: true }).click();
  await expect(page.getByLabel('右轴刻度线', { exact: true })).toHaveValue('none');
  await page.getByLabel('显示右轴', { exact: true }).uncheck();
  await expect(chart.locator('[data-axis="right"]')).toHaveCount(0);
  await expect(chart.locator('[data-point]')).toHaveCount(6);
});

test('Claude-style serif keeps mixed Chinese/scientific text in portable SVG, PNG and PDF', async ({ page }, info) => {
  await page.goto('/');
  const title = 'Fluorescence · 河水样品 Fe³⁺ / F₀';
  await page.getByLabel('字体', { exact: true }).selectOption(SERIF_FONT_FAMILY);
  await page.getByLabel('图表标题', { exact: true }).fill(title);
  await page.getByRole('button', { name: '坐标', exact: true }).click();
  await page.getByRole('button', { name: '左轴', exact: true }).click();
  await page.getByLabel('左轴名称', { exact: true }).fill('荧光响应 Intensity / a.u.');
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1') || '{}').styles?.spectra?.fontFamily)).toBe(SERIF_FONT_FAMILY);
  await page.reload();
  await expect(page.getByLabel('字体', { exact: true })).toHaveValue(SERIF_FONT_FAMILY);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px "Perovskite Lab Serif"', 'Fluorescence'))).toBe(true);
  expect(await page.evaluate(() => document.fonts.check('16px "Perovskite Lab Song"', '河水样品'))).toBe(true);
  await assertDefaultAxes(page.getByTestId('spectra-chart'));
  await expect(page.getByTestId('spectra-chart').locator('svg')).toHaveAttribute('font-family', `${SERIF_FONT_FAMILY}, ${SONG_FONT_FAMILY}, serif`);
  mkdirSync(evidence, { recursive: true });
  await page.locator('.chart-layout').screenshot({ path: path.join(evidence, '四边轴与衬线预览-2026.11.3.png') });

  async function download(format: 'PNG' | 'SVG' | 'PDF') {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: format, exact: true }).click();
    const file = info.outputPath(`衬线图表-2026.11.3.${format.toLowerCase()}`);
    await (await event).saveAs(file);
    return readFileSync(file);
  }
  const png = await download('PNG'); // Exercise the first raster before any SVG download warms it.
  const svg = (await download('SVG')).toString();
  const faces = [...svg.matchAll(/@font-face\{font-family:'([^']+)';src:url\('data:font\/woff;base64,([^']+)'/g)];
  expect(faces.map((match) => match[1])).toEqual([SERIF_FONT_FAMILY, SONG_FONT_FAMILY]);
  expect(hash(Buffer.from(faces[0][2], 'base64'))).toBe(hash(readFileSync(`public/fonts/${SERIF_FONT_FILE}.woff`)));
  const pdf = await PDFDocument.load(await download('PDF'));
  const fonts = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  const fontNames = fonts.keys().map((key) => fonts.lookup(key, PDFDict).get(PDFName.of('BaseFont'))!.toString()).join(' ');
  expect(fontNames).toContain('PerovskiteLabSerif');
  expect(fontNames).toContain('PerovskiteLabSong');
  const difference = await page.evaluate(async ({ svg, png }) => {
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src;
    });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const [actual, expected] = await Promise.all([load(`data:image/png;base64,${png}`), load(url)]);
      const canvas = document.createElement('canvas'); canvas.width = actual.width; canvas.height = actual.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(actual, 0, 0);
      const a = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(expected, 0, 0, canvas.width, canvas.height);
      const b = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let changed = 0;
      for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 2) changed++;
      return changed / a.length;
    } finally { URL.revokeObjectURL(url); }
  }, { svg, png: png.toString('base64') });
  expect(difference).toBeLessThan(0.00001);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10000 });
  await page.locator('.chart-layout').screenshot({ path: path.join(evidence, '手机衬线图表-2026.11.3.png'), animations: 'disabled' });
});
