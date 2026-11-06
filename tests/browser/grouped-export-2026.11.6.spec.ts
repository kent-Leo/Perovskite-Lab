import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { importGroupedTable, editGroupedGrid } from '../../src/domain/grouped-bar-2026.11.6';

const evidence = path.resolve(process.env.LAB_EVIDENCE_DIR || 'test-results/grouped-export-2026.11.6');
const chart = (page: Page) => page.getByTestId('grouped-screening-chart');
async function seed(page: Page) {
  const ions = ['Cd²⁺', 'Ca²⁺', 'Mn²⁺', 'Cr²⁺', 'Ni²⁺', 'Cu²⁺', 'Zn²⁺', 'Fe³⁺', 'Pb²⁺', 'Hg²⁺', 'Mg²⁺', 'Na⁺', 'K⁺', 'Co²⁺', 'Al³⁺'];
  let group = importGroupedTable([['离子', '探针 A', '探针 B', '探针 C'], ...ions.map((name, i) => [name, i === 1 ? '' : 500 - i * 10, 700 - i * 15, i === 1 ? -80 : 680 - i * 5])], true, 'statistics');
  group = editGroupedGrid(group, ions.map((name) => [name, '15', '20', '25']), 'sd');
  group.options = { ...group.options, errorMode: 'sd', fill: 'gradient', borderWidth: 1 };
  group.style = { ...group.style, pointValues: true, fontFamily: 'Perovskite Lab Sans', fontSize: 16, legendFontFamily: 'Perovskite Lab Song', legendFontSize: 18, widthCm: 18, dpi: 300 };
  await page.goto('/');
  await page.waitForFunction(() => !!localStorage.getItem('perovskite-lab-workspace-v1'));
  await page.evaluate((groupedScreening) => {
    const key = 'perovskite-lab-workspace-v1', saved = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...saved, screeningChartType: 'grouped', groupedScreening }));
  }, group);
  await page.reload();
  await page.getByRole('link', { name: '对象筛选', exact: true }).click();
  await expect(chart(page).locator('[data-error-bar]')).toHaveCount(44);
  await page.evaluate(() => document.fonts.ready);
  return group;
}

async function download(page: Page, label: string, name: string) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const file = await event;
  expect(file.suggestedFilename()).toMatch(/\d{4}\.\d{1,2}\.\d{1,2}\./);
  mkdirSync(evidence, { recursive: true });
  const target = path.join(evidence, name);
  await file.saveAs(target);
  return readFileSync(target);
}

test('SVG / 300 与 600 dpi PNG / PDF / Excel 导出对应同一份分组数据与样式', async ({ page }) => {
  await seed(page);
  const svg = (await download(page, 'SVG', '分组柱状图-2026.11.6.svg')).toString();
  expect(svg.match(/data-grouped-bar="true"/g)).toHaveLength(44);
  expect(svg.match(/data-error-bar="true"/g)).toHaveLength(44);
  expect(svg).toContain('Perovskite Lab Song');
  expect(svg).not.toContain('<image');
  const png = await download(page, 'PNG', '分组柱状图-300dpi-2026.11.6.png');
  expect(png.readUInt32BE(16)).toBe(Math.round(18 / 2.54 * 300));
  const physical = png.indexOf('pHYs');
  expect(png.readUInt32BE(physical + 4)).toBe(Math.round(300 / 0.0254));
  const different = await page.evaluate(async ({ svgText, pngData }) => {
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    try {
      const [actual, expected] = await Promise.all([load(`data:image/png;base64,${pngData}`), load(url)]);
      const canvas = document.createElement('canvas'); canvas.width = actual.width; canvas.height = actual.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(actual, 0, 0);
      const a = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(expected, 0, 0, canvas.width, canvas.height);
      const b = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return a.reduce((count, value, index) => count + (Math.abs(value - b[index]) > 2 ? 1 : 0), 0) / a.length;
    } finally { URL.revokeObjectURL(url); }
  }, { svgText: svg, pngData: png.toString('base64') });
  expect(different).toBeLessThan(0.00001);
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByLabel('PNG 分辨率', { exact: true }).selectOption('600');
  const high = await download(page, 'PNG', '分组柱状图-600dpi-2026.11.6.png');
  expect(high.readUInt32BE(16)).toBe(Math.round(18 / 2.54 * 600));
  expect(high.readUInt32BE(high.indexOf('pHYs') + 4)).toBe(Math.round(600 / 0.0254));
  const bytes = await download(page, 'PDF', '分组柱状图-2026.11.6.pdf');
  const pdfDocument = await PDFDocument.load(bytes), pdfPage = pdfDocument.getPage(0);
  expect(pdfDocument.getPageCount()).toBe(1);
  expect(pdfPage.getWidth()).toBeCloseTo(18 / 2.54 * 72);
  const fonts = pdfPage.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  const names = fonts.keys().map((font) => fonts.lookup(font, PDFDict).get(PDFName.of('BaseFont'))!.toString()).join(' ');
  expect(names).toContain('PerovskiteLabSong'); expect(names).toContain('PerovskiteLabSans');
  expect(pdfPage.node.Resources()!.lookup(PDFName.of('Shading'), PDFDict).keys()).toHaveLength(3);
  const contents = pdfPage.node.Contents() as PDFArray;
  const commands = Array.from({ length: contents.size() }, (_, i) => Buffer.from(decodePDFRawStream(contents.lookup(i, PDFRawStream)).decode()).toString()).join('\n');
  expect((commands.match(/\sl\s/g) ?? []).length).toBeGreaterThanOrEqual(44 * 3);
  const workbook = XLSX.read(await download(page, '导出分组数据 Excel', '分组数据-2026.11.6.xlsx'), { type: 'buffer' });
  expect(workbook.SheetNames).toContain('原始重复测量');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['统计结果'], { header: 1, defval: null });
  expect(rows).toHaveLength(46);
  expect(rows[4][4]).toBeNull(); expect(rows[1].slice(4)).toEqual([500, 15, null, null, 'sd', 15]);
  await chart(page).screenshot({ path: path.join(evidence, '分组预览-2026.11.6.png') });
});

test('长标签和不同角度、四种图例位置都位于导出画布内', async ({ page }) => {
  await seed(page);
  await page.getByLabel('分组对象 15', { exact: true }).fill('Al³⁺ 选择性实验中的长离子名称');
  await page.getByLabel('系列名称 3', { exact: true }).fill('多探针实验条件 C / M²⁺');
  for (const angle of [-90, -30, 0, 30, 90]) {
    await page.getByLabel('分类标签角度', { exact: true }).fill(String(angle));
    for (const position of ['right', 'top', 'bottom', 'free']) {
      await page.getByLabel('图例位置', { exact: true }).selectOption(position);
      const clipped = await chart(page).locator('svg').evaluate((svg) => {
        const bounds = svg.getBoundingClientRect();
        return Array.from(svg.querySelectorAll('text')).filter((text) => {
          const box = text.getBoundingClientRect();
          return box.left < bounds.left - 1 || box.right > bounds.right + 1 || box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1;
        }).map((text) => text.textContent);
      });
      expect(clipped, `${angle} / ${position}`).toEqual([]);
    }
  }
});
