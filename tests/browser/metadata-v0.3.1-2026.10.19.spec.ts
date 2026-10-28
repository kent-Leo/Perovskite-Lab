import { test, expect } from '@playwright/test';

const sheets = [
  { page: 'spectra', name: '原始光谱', id: 'raw', count: 3 },
  { page: 'screening', name: '分析对象', id: 'screening', count: 8 },
  { page: 'calibration', name: '校准数据', id: 'calibration', count: 5 },
  { page: 'gradient', name: '梯度配液', id: 'gradient', count: 7 },
] as const;

test('every column supports persistent name, unit and comment edits across all four worksheets', async ({ page }, info) => {
  await page.goto('/');
  await page.waitForTimeout(650);
  const before = await page.evaluate(() => {
    const w = JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!);
    return { spectra: w.spectra, objects: w.objects, calibration: w.calibration, gradient: w.gradient };
  });
  for (const sheet of sheets) {
    await page.getByRole('link', { name: { spectra: '光谱工作台', screening: '对象筛选', calibration: '校准与检出限', gradient: '浓度梯度' }[sheet.page], exact: true }).click();
    const grid = page.getByRole('grid', { name: `${sheet.name} 数据表`, exact: true });
    const headers = grid.locator('.worksheet-label-row');
    for (let field = 0; field < 3; field++) {
      const inputs = headers.nth(field).locator('input');
      await expect(inputs).toHaveCount(sheet.count);
      for (let column = 0; column < sheet.count; column++) {
        await inputs.nth(column).fill(`${sheet.id}-${column}-${['名称', 'μM', '备注'][field]}`);
      }
    }
    if (sheet.id === 'screening') {
      await page.locator('.worksheet').screenshot({ path: info.outputPath('名称单位备注可编辑-v0.3.1-2026.10.19.png') });
    }
  }
  await page.waitForTimeout(650);
  await page.reload();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!));
  expect({ spectra: after.spectra, objects: after.objects, calibration: after.calibration, gradient: after.gradient }).toEqual(before);
  expect(Object.keys(after.sheetMetadata).sort()).toEqual(sheets.map((s) => s.id).sort());
  for (const sheet of sheets) {
    await page.getByRole('link', { name: { spectra: '光谱工作台', screening: '对象筛选', calibration: '校准与检出限', gradient: '浓度梯度' }[sheet.page], exact: true }).click();
    const grid = page.getByRole('grid', { name: `${sheet.name} 数据表`, exact: true });
    for (let field = 0; field < 3; field++) {
      const inputs = grid.locator('.worksheet-label-row').nth(field).locator('input');
      for (let column = 0; column < sheet.count; column++) {
        await expect(inputs.nth(column)).toHaveValue(`${sheet.id}-${column}-${['名称', 'μM', '备注'][field]}`);
      }
    }
  }
});

test('metadata edits preserve data undo, computed cells and defaults on newly added columns', async ({ page }) => {
  await page.goto('/#calibration');
  await page.getByLabel('校准浓度 2', { exact: true }).fill('1.5');
  await page.getByLabel('校准数据 第 1 列名称', { exact: true }).fill('浓度自定义');
  await page.getByLabel('校准数据 第 4 列备注', { exact: true }).fill('计算结果说明');
  await page.getByRole('button', { name: '撤销工作表修改', exact: true }).click();
  await expect(page.getByLabel('校准浓度 2', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('校准数据 第 1 列名称', { exact: true })).toHaveValue('浓度自定义');
  await expect(page.getByLabel('校准响应 2', { exact: true })).not.toHaveAttribute('type', 'text');
  await expect(page.getByRole('gridcell').filter({ has: page.getByLabel('校准响应 2', { exact: true }) })).toHaveAttribute('aria-readonly', 'true');
  await page.getByRole('link', { name: '光谱工作台', exact: true }).click();
  await page.getByLabel('原始光谱 第 2 列名称', { exact: true }).fill('测试发射');
  await page.getByRole('button', { name: '添加强度列', exact: true }).click();
  await expect(page.getByLabel('原始光谱 第 2 列名称', { exact: true })).toHaveValue('测试发射');
  await expect(page.getByLabel('原始光谱 第 4 列名称', { exact: true })).toHaveValue('光谱 4');
  await page.getByLabel('原始光谱 第 2 列名称', { exact: true }).fill('');
  await page.waitForTimeout(650);
  await page.reload();
  await expect(page.getByLabel('原始光谱 第 2 列名称', { exact: true })).toHaveValue('');
});
