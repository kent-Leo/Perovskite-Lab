import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

test.beforeEach(async ({ page }) => { await page.goto('/#gradient'); });

test('independent units preserve recipes, synchronize export and survive refresh', async ({ page }, info) => {
  const stockUnit = page.getByLabel('母液浓度单位', { exact: true });
  const targetUnit = page.getByLabel('配制后溶液浓度单位', { exact: true });
  await expect(stockUnit).toHaveValue('µmol/L');
  await expect(targetUnit).toHaveValue('µmol/L');
  await stockUnit.selectOption('mmol/L');
  await expect(page.getByLabel('母液浓度', { exact: true })).toHaveValue('0.1');
  await expect(page.getByLabel('梯度母液体积 4', { exact: true })).toHaveText('100');
  await targetUnit.selectOption('nmol/L');
  await expect(page.getByLabel('梯度目标浓度 4', { exact: true })).toHaveValue('1000');
  await expect(page.getByLabel('梯度母液体积 4', { exact: true })).toHaveText('100');
  await expect(page.locator('.worksheet thead tr').nth(2).locator('input').first()).toHaveValue('nmol/L');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-v0\.7\.0-\d{4}\.\d{1,2}\.\d{1,2}\.xlsx$/);
  const path = info.outputPath('浓度梯度-v0.7.0-2026.10.24.xlsx');
  await file.saveAs(path);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.read(await readFile(path)).Sheets.Data);
  expect(rows[3]).toMatchObject({ 目标浓度: 1000, 浓度单位: 'nmol/L', 母液浓度: 0.1, 母液浓度单位: 'mmol/L', 母液体积_μL: 100 });
  await page.waitForTimeout(650);
  await page.reload();
  await expect(stockUnit).toHaveValue('mmol/L');
  await expect(targetUnit).toHaveValue('nmol/L');
  await targetUnit.selectOption('µmol/L');
  await expect(page.getByLabel('梯度目标浓度 4', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('梯度母液体积 4', { exact: true })).toHaveText('100');
  await page.screenshot({ path: info.outputPath('浓度梯度-v0.5.5-2026.10.20.png'), fullPage: true, animations: 'disabled' });
});

test('invalid draft rows stay in place and incompatible units do not mutate data', async ({ page }) => {
  await page.getByLabel('目标浓度', { exact: true }).fill('0\n\n1\n10');
  await page.getByLabel('配制后溶液浓度单位', { exact: true }).selectOption('nmol/L');
  await expect(page.getByLabel('梯度目标浓度 2', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('梯度目标浓度 3', { exact: true })).toHaveValue('1000');
  await expect(page.getByRole('button', { name: '导出 Excel', exact: true })).toBeDisabled();
  await page.getByLabel('配制后溶液浓度单位', { exact: true }).selectOption('mg/L');
  await expect(page.locator('.toast')).toContainText('不能直接混用');
  await expect(page.getByLabel('配制后溶液浓度单位', { exact: true })).toHaveValue('nmol/L');
  await page.getByLabel('梯度目标浓度 2', { exact: true }).fill('100');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('legacy storage migrates and the gradient fits a mobile screen', async ({ page }, info) => {
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    const key = 'perovskite-lab-workspace-v1';
    const w = JSON.parse(localStorage.getItem(key)!);
    w.gradient = { stock: '100', volume: '10', fixed: '0', targets: '0,1,10', unit: 'μM' };
    w.sheetMetadata = { gradient: { target: { unit: 'μM' } } };
    localStorage.setItem(key, JSON.stringify(w));
  });
  await page.reload();
  await expect(page.getByLabel('母液浓度单位', { exact: true })).toHaveValue('µmol/L');
  await expect(page.getByLabel('配制后溶液浓度单位', { exact: true })).toHaveValue('µmol/L');
  await expect(page.getByLabel('梯度母液体积 2', { exact: true })).toHaveText('100');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('浓度梯度手机-v0.5.5-2026.10.20.png'), fullPage: true, animations: 'disabled' });
});
