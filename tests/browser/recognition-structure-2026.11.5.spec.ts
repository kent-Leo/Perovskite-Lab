import { test, expect, type Page } from '@playwright/test';

const STORAGE_KEY = 'perovskite-lab-workspace-v1';

const menuOf = (page: Page) => page.getByRole('menu', { name: '工作表行列操作', exact: true });
const columnHeader = (page: Page, letter: string) =>
  page.getByLabel(`选择 ${letter} 列`, { exact: true });
const probeNames = (page: Page) =>
  page.locator('.recognition-probes input').evaluateAll((elements) =>
    (elements as HTMLInputElement[]).filter((element) => element.type === 'text').map((element) => element.value),
  );
const headers = (page: Page) => page.getByRole('columnheader').allInnerTexts();

test.beforeEach(async ({ page }) => {
  await page.goto('/#recognition');
  await expect(page.getByRole('group', { name: '工作表标签' })).toBeVisible();
});

test('多探针：添加探针、右键插入与删除探针列、撤销恢复', async ({ page }) => {
  // 初始 3 个探针列（A/B/C 为必需列，最后一列为删除操作列）。
  expect(await headers(page)).toEqual([
    '▦',
    'A(Label)',
    'B(Label)',
    'C(Meta)',
    'D(Y)',
    'E(Y)',
    'F(Y)',
    'G',
  ]);

  // 页面按钮添加探针
  await page.getByRole('button', { name: '添加探针', exact: true }).click();
  expect((await headers(page)).length).toBe(9);

  // 右键第一个探针列，在右侧插入一个新探针列
  await columnHeader(page, 'D').click({ button: 'right' });
  const menu = menuOf(page);
  await menu.getByRole('menuitem', { name: '插入列', exact: true }).click();
  await menu.getByRole('menuitem', { name: '在右侧插入 1 列', exact: true }).click();
  expect((await headers(page)).length).toBe(10);

  // 录入猝灭率：第 1 行第 4 列（D1）与第 5 列（E1）
  const cell = (row: number, column: number) =>
    page.getByLabel(`猝灭率 第 ${row} 行第 ${column} 列`, { exact: true });
  await cell(1, 4).fill('0.5');
  await cell(1, 5).fill('0.75');

  // 删除 E 列（刚插入的探针），探针定义、数值与分析输入同步更新
  await columnHeader(page, 'E').click({ button: 'right' });
  await menuOf(page).getByRole('menuitem', { name: '删除 1 列', exact: true }).click();
  expect((await headers(page)).length).toBe(9);
  await expect(cell(1, 4)).toHaveValue('0.5');
  // 原第 6 列（旧探针 3）左移到第 5 列，值不受影响
  await expect(cell(1, 5)).toHaveValue('');

  // 撤销恢复被删除的探针列与数值
  await page.getByLabel('撤销工作表修改', { exact: true }).click();
  expect((await headers(page)).length).toBe(10);
  await expect(cell(1, 5)).toHaveValue('0.75');

  // 重做再次删除
  await page.getByLabel('重做工作表修改', { exact: true }).click();
  expect((await headers(page)).length).toBe(9);

  await page.waitForTimeout(700);
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) || '{}'),
    STORAGE_KEY,
  );
  console.log('PROBES', JSON.stringify(saved.recognition?.probes?.map((p: { name: string }) => p.name)));
  console.log('ROW_KEYS', JSON.stringify(Object.keys(saved.recognition?.rows?.[0]?.values ?? {})));
  expect(saved.recognition.probes.length).toBe(4);
  // 被删除探针的猝灭率不再残留在分析输入里
  expect(Object.keys(saved.recognition.rows[0].values).length).toBe(4);
  expect(await probeNames(page)).toHaveLength(4);
});

test('多探针：必需列与操作列受保护，行结构可增删', async ({ page }) => {
  await columnHeader(page, 'A').click({ button: 'right' });
  const menu = menuOf(page);
  const deleteColumn = menu.getByRole('menuitem', { name: /删除 1 列/ });
  await expect(deleteColumn).toBeDisabled();
  await expect(deleteColumn).toContainText('必需列');
  // 行号菜单只给行操作
  await expect(menu.getByRole('menuitem', { name: /删除 \d+ 行/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 先录入一行样本，再在下方插入一行
  await page.getByLabel('猝灭率 第 1 行第 1 列', { exact: true }).fill('样本 1');
  const rowHeader = page.getByLabel('选择第 1 行', { exact: true });
  await rowHeader.click({ button: 'right' });
  await menuOf(page).getByRole('menuitem', { name: '插入行', exact: true }).click();
  await menuOf(page).getByRole('menuitem', { name: '在下方插入 1 行', exact: true }).click();
  await expect(page.getByLabel('猝灭率 第 1 行第 1 列', { exact: true })).toHaveValue('样本 1');
  await expect(page.getByLabel('猝灭率 第 2 行第 1 列', { exact: true })).toHaveValue('');

  // 最后一条「删除行」操作列不能删除
  await columnHeader(page, 'G').click({ button: 'right' });
  const lastColumn = menuOf(page).getByRole('menuitem', { name: /删除 1 列/ });
  await expect(lastColumn).toBeDisabled();
  await expect(lastColumn).toContainText('操作列');
});
