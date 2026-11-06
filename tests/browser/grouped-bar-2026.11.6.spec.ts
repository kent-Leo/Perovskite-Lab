import { test, expect, type Locator, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';

const key = 'perovskite-lab-workspace-v1';
const state = (page: Page) => page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey) || '{}'), key);
const chart = (page: Page) => page.getByTestId('grouped-screening-chart');
const dataPanel = (page: Page) => page.getByTestId('grouped-data');
async function paste(cell: Locator, text: string) {
  await cell.evaluate((input, value) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', value);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text);
}
async function grouped(page: Page) {
  await page.goto('/');
  await page.getByRole('link', { name: '对象筛选', exact: true }).click();
  await page.getByLabel('绘图类型', { exact: true }).selectOption('grouped');
}

test('15 分类三系列粘贴、缺失与零值、单系列回归、按 Sheet 保存和全部图表', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: '对象筛选', exact: true }).click();
  const original = await page.getByTestId('screening-chart').innerHTML();
  await page.getByLabel('绘图类型', { exact: true }).selectOption('grouped');
  const ions = ['Cd²⁺', 'Ca²⁺', 'Mn²⁺', 'Cr²⁺', 'Ni²⁺', 'Cu²⁺', 'Zn²⁺', 'Fe³⁺', 'Pb²⁺', 'Hg²⁺', 'Mg²⁺', 'Na⁺', 'K⁺', 'Co²⁺', 'Al³⁺'];
  await paste(page.getByLabel('分组对象 1', { exact: true }), ions.map((name, i) => `${name}\t${i ? '' : '520'}\t${i ? i * 10 : '700'}\t${i === 1 ? 0 : 680}`).join('\n'));
  await expect(chart(page).locator('[data-grouped-bar]')).toHaveCount(31);
  expect((await page.locator('.grouped-chart').boundingBox())!.height).toBeLessThan(800);
  const boxes = await chart(page).locator('[data-category-index="0"][data-grouped-bar] > rect').evaluateAll((rects) => rects.map((rect) => ({ x: Number(rect.getAttribute('x')), width: Number(rect.getAttribute('width')) })));
  expect(boxes[0].x + boxes[0].width).toBeLessThan(boxes[1].x);
  expect(boxes[1].x + boxes[1].width).toBeLessThan(boxes[2].x);
  await page.getByLabel('绘图类型', { exact: true }).selectOption('single');
  expect(await page.getByTestId('screening-chart').innerHTML()).toBe(original);
  await page.getByLabel('绘图类型', { exact: true }).selectOption('grouped');
  await page.getByLabel('柱宽', { exact: true }).fill('38');
  await page.getByLabel('新建 sheet', { exact: true }).click();
  await expect(page.getByLabel('绘图类型')).toHaveValue('single');
  await page.getByLabel('绘图类型').selectOption('grouped');
  await paste(page.getByLabel('分组对象 1', { exact: true }), 'M²⁺\t-10\t0\t20');
  await expect(page.getByLabel('柱宽', { exact: true })).toHaveValue('28');
  await page.getByRole('button', { name: '绘图 sheet 分析对象', exact: true }).click();
  await expect(page.getByLabel('柱宽', { exact: true })).toHaveValue('38');
  await expect(chart(page).locator('[data-grouped-bar]')).toHaveCount(31);
  await page.getByRole('button', { name: '全部 sheet', exact: true }).click();
  await expect(page.locator('.sheet-gallery [data-grouped-bar]')).toHaveCount(34);
  await expect.poll(async () => (await state(page)).groupedScreening?.categories.length).toBe(15);
  await page.reload();
  await expect(chart(page).locator('[data-grouped-bar]')).toHaveCount(31);
});

test('重复测量统计、n < 2 不画误差、手动误差与撤销', async ({ page }) => {
  await grouped(page);
  await page.getByLabel('分组数据输入').selectOption('replicates');
  await page.getByLabel('误差棒', { exact: true }).selectOption('sd');
  await paste(page.getByLabel('分组对象 1', { exact: true }), 'Cd²⁺\t1;;2;3\t0\t-3;-1;1');
  await expect(chart(page).locator('[data-error-bar]')).toHaveCount(2);
  await dataPanel(page).getByText('统计结果（Mean / SD / SEM / n）', { exact: true }).click();
  const cells = dataPanel(page).locator('.grouped-statistics tbody tr').first().locator('td');
  await expect(cells.nth(2)).toHaveText('2'); await expect(cells.nth(3)).toHaveText('1'); await expect(cells.nth(5)).toHaveText('3');
  await page.getByLabel('误差棒', { exact: true }).selectOption('sem');
  await expect(cells.nth(6)).toHaveText('0.57735027');
  await page.getByLabel('误差棒', { exact: true }).selectOption('manual');
  await page.getByLabel('分组误差 1 2', { exact: true }).fill('0.5');
  await expect(chart(page).locator('[data-error-bar]')).toHaveCount(1);
  await page.getByLabel('撤销工作表修改', { exact: true }).first().click();
  await expect(chart(page).locator('[data-error-bar]')).toHaveCount(0);
  await page.getByLabel('重做工作表修改', { exact: true }).first().click();
  await expect(chart(page).locator('[data-error-bar]')).toHaveCount(1);
  await page.getByLabel('分组数据输入').selectOption('statistics');
  await expect(page.getByLabel('分组数值 1 1', { exact: true })).toHaveValue('');
  await page.getByLabel('分组数据输入').selectOption('replicates');
  await expect(page.getByLabel('分组数值 1 1', { exact: true })).toHaveValue('1;;2;3');
});

test('填写或清空误差不会删除尾部空误差行的分类名称', async ({ page }) => {
  await grouped(page);
  await paste(page.getByLabel('分组对象 1', { exact: true }), 'Cd²⁺\t1\t2\t3\nCa²⁺\t4\t5\t6');
  await page.getByLabel('误差棒', { exact: true }).selectOption('sd');
  await page.getByLabel('分组误差 1 1', { exact: true }).fill('0.2');
  await expect(page.getByLabel('分组对象 2', { exact: true })).toHaveValue('Ca²⁺');
  await expect(chart(page).locator('[data-grouped-bar]')).toHaveCount(6);
  await page.getByLabel('分组误差 1 1', { exact: true }).fill('');
  await expect(page.getByLabel('分组对象 1', { exact: true })).toHaveValue('Cd²⁺');
  await expect(page.getByLabel('分组对象 2', { exact: true })).toHaveValue('Ca²⁺');
  await expect(chart(page).locator('[data-grouped-bar]')).toHaveCount(6);
});

test('系列改名、显隐和重排；右键插删行列能撤销恢复', async ({ page }) => {
  await grouped(page);
  await paste(page.getByLabel('分组对象 1', { exact: true }), 'Cd²⁺\t1\t2\t3\nCa²⁺\t4\t5\t6');
  await page.getByLabel('系列名称 2', { exact: true }).fill('探针 M²⁺');
  await page.getByLabel('上移系列 2', { exact: true }).click();
  await expect(page.getByLabel('分组数值 1 1', { exact: true })).toHaveValue('2');
  await page.getByLabel('显示系列 1', { exact: true }).uncheck();
  await expect(chart(page).locator('[data-grouped-bar]')).toHaveCount(4);
  await page.getByLabel('显示系列 1', { exact: true }).check();
  await page.getByLabel('选择 B 列', { exact: true }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '工作表行列操作', exact: true });
  await menu.getByRole('menuitem', { name: '删除 1 列', exact: true }).click();
  await expect(page.getByLabel('分组数值 1 1', { exact: true })).toHaveValue('1');
  await page.getByLabel('撤销工作表修改', { exact: true }).click();
  await expect(page.getByLabel('系列名称 1', { exact: true })).toHaveValue('探针 M²⁺');
  await expect(page.getByLabel('分组数值 1 1', { exact: true })).toHaveValue('2');
  await page.getByLabel('选择第 2 行', { exact: true }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '插入行', exact: true }).click();
  await menu.getByRole('menuitem', { name: '在上方插入 1 行', exact: true }).click();
  await expect(page.getByLabel('分组对象 2', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('分组对象 3', { exact: true })).toHaveValue('Ca²⁺');
  await page.getByLabel('撤销工作表修改', { exact: true }).click();
  await expect(page.getByLabel('分组对象 2', { exact: true })).toHaveValue('Ca²⁺');
});

for (const extension of ['csv', 'xlsx']) test(`${extension} 宽表导入到新 Sheet 并保留旧数据`, async ({ page }) => {
  await grouped(page);
  await paste(page.getByLabel('分组对象 1', { exact: true }), '原数据\t99');
  const rows = [['离子', 'A', 'B'], ['Cd²⁺', 520, 680], ['Ca²⁺', '', 0]];
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '导入条件');
  const buffer = extension === 'csv' ? Buffer.from(rows.map((row) => row.join(',')).join('\n')) : XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  await page.getByLabel('分组数据文件').setInputFiles({ name: `分组导入-2026.11.6.${extension}`, mimeType: extension === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await page.getByRole('button', { name: '导入到新 Sheet', exact: true }).click();
  await expect(chart(page).locator('[data-grouped-bar]')).toHaveCount(3);
  await expect(page.getByLabel('分组数值 2 1', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('分组数值 2 2', { exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: '绘图 sheet 分析对象', exact: true }).click();
  await expect(page.getByLabel('分组数值 1 1', { exact: true })).toHaveValue('99');
});
