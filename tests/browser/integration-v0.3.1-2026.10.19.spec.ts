import { test, expect, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { APP_VERSION } from '../../src/version-v0.7.0-2026.10.24';

async function paste(cell: Locator, value: string) {
  await cell.evaluate((el, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', value);
    el.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }),
    );
  }, value);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('all four pages use worksheets and the application displays its version', async ({
  page,
}, info) => {
  await expect(page).toHaveTitle(`Perovskite Lab v${APP_VERSION} · 科研工作台`);
  await expect(page.locator('.sidebar')).toContainText(`v${APP_VERSION}`);
  await expect(page.locator('.version-label')).toHaveText(`PEROVSKITE LAB / v${APP_VERSION}`);
  for (const [name, count] of [
    ['光谱工作台', 1],
    ['对象筛选', 1],
    ['校准与检出限', 1],
    ['浓度梯度', 1],
  ] as const) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('grid')).toHaveCount(count);
    await expect(page.getByRole('grid').first()).toContainText('名称');
    await expect(page.getByRole('grid').first()).toContainText('单位');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath(`${name}-v0.5.5-2026.10.19.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await page
      .locator('.worksheet')
      .first()
      .screenshot({
        path: info.outputPath(`${name}-工作表-v0.5.5-2026.10.19.png`),
        animations: 'disabled',
      });
  }
});

test('raw spectrum paste expands columns, updates plotted data and supports undo', async ({
  page,
}) => {
  const sheet = page.getByLabel('光谱工作台 原始光谱 工作表', { exact: true });
  await paste(
    page.getByLabel('原始数据第 1 行第 1 列', { exact: true }),
    'nm\tBlank\tA\tB\n500\t100\t50\t25\n510\t200\t100\t50',
  );
  await expect(page.getByRole('button', { name: '根据表格绘图', exact: true })).toBeEnabled();
  await expect(page.getByLabel('原始数据第 3 行第 4 列', { exact: true })).toHaveValue('50');
  await page.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(3);
  await page.getByLabel('原始数据第 3 行第 4 列', { exact: true }).fill('80');
  await sheet.getByRole('button', { name: '撤销工作表修改', exact: true }).click();
  await expect(page.getByLabel('原始数据第 3 行第 4 列', { exact: true })).toHaveValue('50');
  await sheet.getByRole('button', { name: '重做工作表修改', exact: true }).click();
  await expect(page.getByLabel('原始数据第 3 行第 4 列', { exact: true })).toHaveValue('80');
  const samples = page.getByLabel('光谱工作台 原始光谱 工作表', { exact: true });
  const nameInput = page.getByLabel('原始光谱 第 2 列名称', { exact: true });
  await nameInput.fill('实际水样');
  await nameInput.evaluate((el) => {
    el.blur();
    el.focus();
  });
  expect(await nameInput.evaluate((el) => [el.selectionStart, el.selectionEnd])).toEqual([0, 4]);
  await paste(nameInput, 'A\tB\tC');
  await expect(page.getByLabel('原始光谱 第 2 列名称', { exact: true })).toHaveValue('A');
  await expect(page.getByLabel('原始光谱 第 3 列名称', { exact: true })).toHaveValue('B');
  await expect(page.getByLabel('原始光谱 第 4 列名称', { exact: true })).toHaveValue('C');
  await expect(samples.locator('.worksheet-status')).toContainText('已粘贴 3 列名称');
});

test('screening recalculates responses, protects results and preserves ordering and storage', async ({
  page,
}) => {
  await page.getByRole('link', { name: '对象筛选', exact: true }).click();
  const sheet = page.getByLabel('对象筛选 分析对象 工作表', { exact: true });
  await paste(
    page.getByLabel('对象名称 1', { exact: true }),
    'Blank\t空白\t0\tµmol/L\t100\t参考\n实际水样\t目标物\t1\tµmol/L\t25\t河水',
  );
  await expect(page.getByLabel('对象响应 2', { exact: true })).toHaveText('0.25');
  await expect(page.getByTestId('screening-chart')).toContainText('实际水样');
  await paste(page.getByLabel('对象响应 2', { exact: true }), '999');
  await expect(sheet.locator('.worksheet-status')).toContainText('只读计算列');
  await expect(page.getByLabel('对象响应 2', { exact: true })).toHaveText('0.25');
  await paste(page.getByLabel('对象强度 2', { exact: true }), '40');
  await expect(page.getByLabel('对象响应 2', { exact: true })).toHaveText('0.4');
  await sheet.getByRole('button', { name: '撤销工作表修改', exact: true }).click();
  await expect(page.getByLabel('对象响应 2', { exact: true })).toHaveText('0.25');
  await sheet
    .getByRole('button', { name: '选择第 2 行', exact: true })
    .dragTo(sheet.getByRole('button', { name: '选择第 1 行', exact: true }));
  await expect(
    page.getByLabel('空白参考 F₀', { exact: true }).locator('option:checked'),
  ).toHaveText('Blank');
  await page.waitForTimeout(650);
  await page.reload();
  await expect(page.getByLabel('对象名称 1', { exact: true })).toHaveValue('实际水样');
  await expect(page.getByLabel('对象响应 1', { exact: true })).toHaveText('0.25');
});

test('calibration appends pasted points, defaults new points to included, and undoes exclusion', async ({
  page,
}) => {
  await page.getByRole('link', { name: '校准与检出限', exact: true }).click();
  const sheet = page.getByLabel('校准与检出限 校准数据 工作表', { exact: true });
  await page.getByLabel('响应方式', { exact: true }).selectOption('F');
  await sheet.getByRole('button', { name: '行', exact: true }).click();
  await paste(page.getByLabel('校准浓度 7', { exact: true }), '9\t2500\n10\t1500');
  await expect(page.getByLabel('拟合点 7', { exact: true })).toBeChecked();
  await expect(page.getByTestId('calibration-chart').locator('circle')).toHaveCount(8);
  await page.getByLabel('拟合点 7', { exact: true }).uncheck();
  await expect(page.getByTestId('calibration-chart').locator('circle')).toHaveCount(7);
  await sheet.getByRole('button', { name: '撤销工作表修改', exact: true }).click();
  await expect(page.getByTestId('calibration-chart').locator('circle')).toHaveCount(8);
  await expect(page.locator('.lod-results')).toBeVisible();
  await paste(page.getByLabel('校准浓度 1', { exact: true }), '1\tbad');
  await expect(sheet.locator('.worksheet-status')).toContainText('只接受数值');
  await expect(page.getByLabel('校准浓度 1', { exact: true })).toHaveValue('0');
  await paste(page.getByLabel('校准响应 1', { exact: true }), '123');
  await expect(sheet.locator('.worksheet-status')).toContainText('只读计算列');
});

test('gradient stays editable on errors, recalculates, undoes changes and exports versioned data', async ({
  page,
}, info) => {
  await page.getByRole('link', { name: '浓度梯度', exact: true }).click();
  const sheet = page.getByLabel('浓度梯度 梯度配液 工作表', { exact: true });
  await page.getByLabel('固定添加体积 / mL', { exact: true }).fill('1');
  await page.getByLabel('梯度目标浓度 2', { exact: true }).fill('2');
  await expect(page.getByLabel('梯度母液体积 2', { exact: true })).toHaveText('200');
  await expect(page.getByLabel('梯度预计溶剂 2', { exact: true })).toHaveText('8.8');
  await sheet.getByRole('button', { name: '撤销工作表修改', exact: true }).click();
  await expect(page.getByLabel('梯度目标浓度 2', { exact: true })).toHaveValue('0.1');
  await page.getByLabel('梯度目标浓度 2', { exact: true }).fill('200');
  await expect(page.getByRole('alert')).toContainText('目标浓度');
  await expect(sheet).toBeVisible();
  await expect(page.getByRole('button', { name: '导出 Excel', exact: true })).toBeDisabled();
  await page.getByLabel('梯度目标浓度 2', { exact: true }).fill('2');
  await paste(page.getByLabel('梯度母液体积 2', { exact: true }), '999');
  await expect(sheet.locator('.worksheet-status')).toContainText('只读计算列');
  await expect(page.getByLabel('梯度母液体积 2', { exact: true })).toHaveText('200');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/-v0\.8\.1-\d{4}\.\d{1,2}\.\d{1,2}\.xlsx$/);
  const path = info.outputPath('梯度-v0.7.0-2026.10.24.xlsx');
  await file.saveAs(path);
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    XLSX.read(await readFile(path)).Sheets.Data,
  );
  expect(records[1]['目标浓度']).toBe(2);
  expect(records[1]['预计补加溶剂_mL']).toBe(8.8);
  await page.getByLabel('梯度目标浓度 3', { exact: true }).fill('');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('梯度目标浓度 4', { exact: true })).toHaveValue('1');
  await page.getByLabel('梯度目标浓度 3', { exact: true }).fill('0.5');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
