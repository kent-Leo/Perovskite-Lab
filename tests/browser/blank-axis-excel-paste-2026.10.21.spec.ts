import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { PDFDocument } from 'pdf-lib';

for (const header of [false, true]) {
  test(`Excel paste draws 11 spectra after reloading unnamed top/right axes (header=${header})`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('button', { name: '坐标', exact: true }).click();
    for (const axis of ['上轴', '右轴']) {
      await page.getByRole('button', { name: axis, exact: true }).click();
      await page.getByLabel(`显示${axis}`, { exact: true }).check();
      await expect(page.getByLabel(`${axis}名称`, { exact: true })).toHaveValue('');
    }
    await page.waitForTimeout(650);
    await page.reload();
    await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(6);

    const names = ['Ca', 'Cd', 'Co', 'Fe2+', 'Fe3+', 'K', 'Mg', 'Na', 'Ni', 'Zn', '点+水'];
    let rows: unknown[][] = Array.from({ length: 301 }, (_, i) => [400 + i,
      ...names.map((_, c) => 5 + (1000 + c * 100) * Math.exp(-0.5 * ((400 + i - 516) / 12) ** 2))]);
    // Optional local fixture exercises the user's Excel values without committing their data.
    if (process.env.LAB_SPECTRA_XLSX) {
      const book = XLSX.read(await readFile(process.env.LAB_SPECTRA_XLSX));
      rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['光谱数据(去杂峰)'], { header: 1 }).slice(201, 502);
    }
    const tsv = [...(header ? [['波长 (nm)', ...names]] : []), ...rows].map((r) => r.join('\t')).join('\n');
    await page.getByLabel('原始数据第 1 行第 1 列', { exact: true }).evaluate((el, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    }, tsv);
    await page.getByRole('button', { name: '根据表格绘图', exact: true }).click();
    const chart = page.getByTestId('spectra-chart');
    await expect(chart.locator('polyline')).toHaveCount(11);
    await expect(chart.locator('[data-axis="top"]')).toHaveCount(1);
    await expect(chart.locator('[data-axis="right"]')).toHaveCount(1);
    await expect(page.getByText('undefined is not iterable', { exact: false })).toHaveCount(0);
    await chart.screenshot({ path: info.outputPath(`Excel粘贴绘图-${header ? '含列名' : '纯数值'}-2026.10.21.png`) });
    if (header) {
      for (const format of ['SVG', 'PNG', 'PDF']) {
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: format, exact: true }).click();
        const file = await download;
        const output = info.outputPath(`Excel粘贴绘图-2026.10.21.${format.toLowerCase()}`);
        await file.saveAs(output);
        const bytes = await readFile(output);
        if (format === 'SVG') expect(bytes.toString().match(/<polyline/g)).toHaveLength(11);
        if (format === 'PNG') expect(bytes.subarray(1, 4).toString()).toBe('PNG');
        if (format === 'PDF') expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
      }
    }
    await page.waitForTimeout(650);
    await page.reload();
    await expect(chart.locator('polyline')).toHaveCount(11);
    expect(errors).toEqual([]);
  });
}
