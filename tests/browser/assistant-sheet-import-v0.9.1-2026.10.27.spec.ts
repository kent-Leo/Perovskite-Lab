import { test, expect } from '@playwright/test';
import { sheetSnapshots, type RawSheetPayload } from '../../src/domain/workbook';

for (const mode of ['combined', 'separate']) {
  test(`only selected processed spectra are imported (${mode})`, async ({ page }) => {
    await page.goto('/#assistant');
    const region = page.getByRole('region', { name: 'AI 光谱助手', exact: true });
    const files = ['样品A.TXT', '样品B.TXT', '未选择.TXT'];
    await region.getByLabel('上传 F-7100 TXT 光谱').setInputFiles(files.map((name, index) => ({
      name, mimeType: 'text/plain', buffer: Buffer.from('nm\tData\n' + Array.from({ length: 101 }, (_, i) => {
        const x = 450 + i + index;
        return `${x}\t${10 + (index + 1) * 500 * Math.exp(-0.5 * ((x - 520) / 8) ** 2)}`;
      }).join('\n')),
    })));
    await expect(region.getByRole('tab')).toHaveCount(3);
    await region.getByLabel(/确认处理后自动同步/).uncheck();
    await region.getByLabel('多文件导入方式').selectOption(mode);
    const importButton = region.getByRole('button', { name: '导入所选文件到 Sheet', exact: true });
    await expect(importButton).toBeDisabled();
    for (const name of files.slice(0, 2)) {
      await region.getByRole('tab', { name: new RegExp(name) }).click();
      await region.getByRole('button', { name: '确认处理结果', exact: true }).click();
    }
    await expect(importButton).toBeDisabled();
    await region.getByLabel('批量选择 未选择.TXT').uncheck();
    await importButton.click();
    const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!));
    await expect.poll(async () => (await state()).workbooks.raw.tabs.length).toBe(mode === 'combined' ? 2 : 3);
    const imported = sheetSnapshots(await state(), 'raw').slice(1);
    expect(imported.map(s => (s.payload as RawSheetPayload).spectra.length)).toEqual(mode === 'combined' ? [2] : [1, 1]);
    expect(imported.flatMap(s => (s.payload as RawSheetPayload).spectra.map(s => s.name))).toEqual(files.slice(0, 2));
    for (const sheet of imported) {
      const payload = sheet.payload as RawSheetPayload;
      expect(payload.grid[0].filter(Boolean)).toEqual(['波长 / nm', ...payload.spectra.map(s => s.name)]);
      expect(payload.rawSpectra).toHaveLength(payload.spectra.length);
      expect(payload.mapping.ys).toHaveLength(payload.spectra.length);
    }
    if (mode === 'combined') {
      const payload = imported[0].payload as RawSheetPayload;
      expect(payload.grid.find(row => row[0] === '450')?.[2]).toBe('');
      expect(payload.grid.find(row => row[0] === '551')?.[1]).toBe('');
      // Re-sync one member while keeping the other member intact.
      await region.getByRole('button', { name: '更新已同步 Sheet', exact: true }).click();
      await expect.poll(async () => (await state()).spectra.length).toBe(2);
      expect((await state()).rawSheet.grid).toEqual(payload.grid);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(region.getByLabel('多文件导入方式')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/多文件导入-${mode}-2026.10.26.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1050 });
    await region.getByRole('button', { name: /前往光谱工作台查看/ }).click();
    const replot = page.getByRole('button', { name: '根据表格绘图', exact: true });
    await expect(replot).toBeEnabled();
    await replot.click();
    await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(mode === 'combined' ? 2 : 1);
    await page.screenshot({ path: `test-results/处理后光谱-${mode}-2026.10.26.png`, fullPage: true });
  });
}
