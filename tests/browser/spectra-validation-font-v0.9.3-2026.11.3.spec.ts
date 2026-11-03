import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { SONG_FONT_FAMILY } from '../../src/domain/chart-fonts-2026.11.3';

const evidence = path.resolve(process.env.LAB_EVIDENCE_DIR || 'docs/验收-绘图校验与宋体-v0.9.3-2026.11.3');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const panel = (page: Page) => page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
const cell = (page: Page, row: number, column: number) =>
  panel(page).getByLabel(`原始数据第 ${row} 行第 ${column} 列`, { exact: true });
async function paste(page: Page, text: string) {
  await cell(page, 1, 1).evaluate((input, text) => {
    const data = new DataTransfer(); data.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}
async function expectRed(input: Locator) {
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input.locator('..')).toHaveCSS('background-color', 'rgb(255, 240, 238)');
  await expect(input).toHaveCSS('color', 'rgb(170, 73, 60)');
}

test('invalid spectrum cells stay visibly red when selected, edited, undone and corrected', async ({ page }) => {
  await page.goto('/');
  await paste(page, 'nm\tF\n500\t10\n510\tbad\n520\t30');
  const input = cell(page, 3, 2);
  await input.click();
  await expectRed(input);
  await expect(panel(page).getByRole('button', { name: '根据表格绘图', exact: true })).toBeDisabled();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(6);
  await expect(cell(page, 1, 2)).not.toHaveAttribute('aria-invalid');
  mkdirSync(evidence, { recursive: true });
  await panel(page).screenshot({ path: path.join(evidence, '无效数值标红-v0.9.3-2026.11.3.png') });
  await input.fill('20');
  await expect(input).not.toHaveAttribute('aria-invalid');
  await panel(page).getByRole('button', { name: '撤销工作表修改', exact: true }).click();
  await expectRed(input);
  await panel(page).getByRole('button', { name: '重做工作表修改', exact: true }).click();
  await expect(input).not.toHaveAttribute('aria-invalid');
  await panel(page).getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(1);
});

test('duplicate wavelengths and one-point spectra identify the cells that prevent plotting', async ({ page }) => {
  await page.goto('/');
  await paste(page, 'nm\tF\n500\t10\n5e2\t20');
  await expectRed(cell(page, 2, 1));
  await expectRed(cell(page, 3, 1));
  await expect(panel(page).getByRole('alert')).toContainText('重复波长');
  await cell(page, 3, 1).fill('510');
  await expect(cell(page, 2, 1)).not.toHaveAttribute('aria-invalid');
  await expect(cell(page, 3, 1)).not.toHaveAttribute('aria-invalid');
  await panel(page).getByRole('button', { name: '清空表格', exact: true }).click();
  await paste(page, 'nm\tF\n500\t10');
  await expectRed(cell(page, 2, 2));
  await expect(panel(page).getByRole('alert')).toContainText('少于 2');
  await cell(page, 3, 1).fill('510');
  await expectRed(cell(page, 3, 2));
  await cell(page, 3, 2).fill('-20');
  await expect(panel(page).locator('[aria-invalid="true"]')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: '根据表格绘图', exact: true })).toBeEnabled();
});

test('mobile mapping excludes unused text columns from red errors and preserves sheet validation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await paste(page, 'nm\tF\t备注\n500\t10\t样本一\n510\t20\t样本二');
  await expectRed(cell(page, 2, 3));
  await panel(page).getByLabel('第 3 列作为强度', { exact: true }).uncheck();
  await expect(panel(page).locator('[aria-invalid="true"]')).toHaveCount(0);
  await cell(page, 2, 2).fill('错误');
  await expectRed(cell(page, 2, 2));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1') || '{}').rawSheet?.grid?.[1]?.[1])).toBe('错误');
  await page.reload();
  await expectRed(cell(page, 2, 2));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  mkdirSync(evidence, { recursive: true });
  await panel(page).screenshot({ path: path.join(evidence, '手机标红-v0.9.3-2026.11.3.png') });
});

test('Song font persists, embeds in SVG and PDF, and renders the same PNG after font switching', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.goto('/');
  const title = '宋体荧光光谱 · Fe³⁺ / F₀';
  await page.getByLabel('图表标题', { exact: true }).fill(title);
  await page.getByLabel('字体', { exact: true }).selectOption(SONG_FONT_FAMILY);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByTestId('spectra-chart').locator('svg')).toHaveAttribute('font-family', /^Perovskite Lab Song,/);
  expect(await page.evaluate(() => document.fonts.check('16px "Perovskite Lab Song"', '宋体F₀'))).toBe(true);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1') || '{}').styles?.spectra?.fontFamily)).toBe(SONG_FONT_FAMILY);
  await page.reload();
  await expect(page.getByLabel('字体', { exact: true })).toHaveValue(SONG_FONT_FAMILY);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(evidence, { recursive: true });
  await page.locator('.chart-layout').screenshot({ path: path.join(evidence, '宋体图表-v0.9.3-2026.11.3.png') });

  async function download(format: 'SVG' | 'PNG' | 'PDF', stem: string) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: format, exact: true }).click();
    const result = await pending;
    expect(result.suggestedFilename()).toMatch(/-v0\.9\.3-\d{4}\.\d{1,2}\.\d{1,2}\./);
    const file = info.outputPath(`${stem}-2026.11.3.${format.toLowerCase()}`);
    await result.saveAs(file);
    return readFileSync(file);
  }
  const svg = (await download('SVG', '宋体图表')).toString('utf8');
  expect(svg).toContain(title);
  expect(svg).toContain("@font-face{font-family:'Perovskite Lab Song'");
  const embedded = svg.match(/data:font\/woff;base64,([^']+)/)![1];
  expect(hash(Buffer.from(embedded, 'base64'))).toBe(hash(readFileSync('public/fonts/PerovskiteLabSong-Regular-2026.11.3.woff')));
  const png = await download('PNG', '宋体图表');
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  const pdf = await PDFDocument.load(await download('PDF', '宋体图表'));
  expect(pdf.getPageCount()).toBe(1);
  const fonts = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  expect(fonts.keys().map((key) => fonts.lookup(key, PDFDict).get(PDFName.of('BaseFont'))!.toString()).join(' ')).toContain('PerovskiteLabSong');
  await page.getByLabel('字体', { exact: true }).selectOption('Perovskite Lab Sans');
  const sans = await download('PNG', '无衬线图表');
  expect(sans.equals(png)).toBe(false);
  await page.getByLabel('字体', { exact: true }).selectOption(SONG_FONT_FAMILY);
  expect(hash(await download('PNG', '宋体切换后图表'))).toBe(hash(png));
});

test('shared chart settings expose Song in recognition and page demo notices contain no generation claims', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.workspace-status')).toContainText('示例工作区');
  await expect(page.locator('body')).not.toContainText('人工生成');
  await page.getByRole('button', { name: '载入示例', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已载入示例数据' })).toBeVisible();
  await page.getByRole('link', { name: '多探针识别分析', exact: true }).click();
  const module = page.getByTestId('recognition-module');
  await module.getByRole('button', { name: '载入演示数据', exact: true }).click();
  await expect(module.locator('.recognition-demo')).toHaveText('演示数据 · 仅用于验证操作流程。');
  await module.getByLabel('字体', { exact: true }).selectOption(SONG_FONT_FAMILY);
  await expect(page.getByTestId('recognition-scores-chart').locator('svg')).toHaveAttribute('font-family', /^Perovskite Lab Song,/);
});
