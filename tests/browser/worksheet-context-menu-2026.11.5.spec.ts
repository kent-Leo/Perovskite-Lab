import { test, expect, type Locator, type Page } from '@playwright/test';

const STORAGE_KEY = 'perovskite-lab-workspace-v1';

async function paste(cell: Locator, text: string) {
  await cell.evaluate((input, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

const gotoPage = async (page: Page, label: string) => {
  await page.getByRole('link', { name: label, exact: true }).click();
};

const rawCell = (page: Page, row: number, column: number) =>
  page.getByLabel(`原始数据第 ${row} 行第 ${column} 列`, { exact: true });

const rowHeader = (page: Page, row: number) =>
  page.getByLabel(`选择第 ${row} 行`, { exact: true });

const columnHeader = (page: Page, letter: string) =>
  page.getByLabel(`选择 ${letter} 列`, { exact: true });

const menuOf = (page: Page) => page.getByRole('menu', { name: '工作表行列操作', exact: true });

const savedWorkspace = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) || '{}') as Record<string, never>,
    STORAGE_KEY,
  );

const pasteRaw = async (page: Page) => {
  const panel = page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
  await paste(
    panel.getByLabel('原始数据第 1 行第 1 列', { exact: true }),
    'nm\tA\tB\n500\t10\t30\n510\t20\t40',
  );
  await expect(panel).toContainText('可绘制 2 条光谱');
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('group', { name: '工作表标签' })).toBeVisible();
});

test('右键行号：插入行、批量删除行、撤销与重做', async ({ page }) => {
  await pasteRaw(page);
  const grid = page.getByRole('grid').first();
  const rowCount = async () => Number(await grid.getAttribute('aria-rowcount'));
  const before = await rowCount();

  // 右键行号打开菜单，插入行子菜单在下方插入一行。
  await rowHeader(page, 2).click({ button: 'right' });
  const menu = menuOf(page);
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: '插入行', exact: true }).click();
  await menu.getByRole('menuitem', { name: '在下方插入 1 行', exact: true }).click();
  await expect(grid).toHaveAttribute('aria-rowcount', String(before + 1));
  await expect(rawCell(page, 2, 1)).toHaveValue('500');
  await expect(rawCell(page, 3, 1)).toHaveValue('');
  await expect(rawCell(page, 4, 1)).toHaveValue('510');

  // 结构操作进入撤销历史：撤销恢复行数，重做再次删除。
  await page.getByLabel('撤销工作表修改', { exact: true }).click();
  await expect(grid).toHaveAttribute('aria-rowcount', String(before));
  await expect(rawCell(page, 3, 1)).toHaveValue('510');
  await page.getByLabel('重做工作表修改', { exact: true }).click();
  await expect(rawCell(page, 3, 1)).toHaveValue('');

  // 连选多行后右键，菜单保留选区并批量插入 / 删除。
  await rowHeader(page, 2).click();
  await rowHeader(page, 3).click({ modifiers: ['Shift'] });
  await expect(page.getByLabel('工作表当前选区')).toHaveText('A2:C3');
  await rowHeader(page, 3).click({ button: 'right' });
  await expect(page.getByLabel('工作表当前选区')).toHaveText('A2:C3');
  await menu.getByRole('menuitem', { name: '插入行', exact: true }).click();
  await menu.getByRole('menuitem', { name: '在上方插入 2 行', exact: true }).click();
  await expect(grid).toHaveAttribute('aria-rowcount', String(before + 3));

  // 批量删除 2 行：作为一次撤销记录。
  await rowHeader(page, 2).click();
  await rowHeader(page, 3).click({ modifiers: ['Shift'] });
  await rowHeader(page, 2).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '删除 2 行', exact: true }).click();
  await expect(grid).toHaveAttribute('aria-rowcount', String(before + 1));
  await page.getByLabel('撤销工作表修改', { exact: true }).click();
  await expect(grid).toHaveAttribute('aria-rowcount', String(before + 3));
});

test('右键列标：删除强度列同步更新映射与光谱', async ({ page }) => {
  await pasteRaw(page);
  const grid = page.getByRole('grid').first();
  const panel = page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
  const columnsBefore = Number(await grid.getAttribute('aria-colcount'));

  await columnHeader(page, 'B').click({ button: 'right' });
  const menu = menuOf(page);
  await expect(menu.getByRole('menuitem', { name: '删除 1 列', exact: true })).toBeEnabled();
  await menu.getByRole('menuitem', { name: '删除 1 列', exact: true }).click();
  await expect(grid).toHaveAttribute('aria-colcount', String(columnsBefore - 1));
  await expect(rawCell(page, 1, 1)).toHaveValue('nm');
  await expect(rawCell(page, 1, 2)).toHaveValue('B');
  await expect(rawCell(page, 2, 2)).toHaveValue('30');

  // 删除强度列同时移除对应光谱；撤销恢复列、映射与光谱，重做再次删除。
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(1);
  await page.getByLabel('撤销工作表修改', { exact: true }).click();
  await expect(grid).toHaveAttribute('aria-colcount', String(columnsBefore));
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await page.getByLabel('重做工作表修改', { exact: true }).click();
  await expect(grid).toHaveAttribute('aria-colcount', String(columnsBefore - 1));

  // 波长列受保护：菜单项的禁用原因直接显示在菜单里。
  await columnHeader(page, 'A').click({ button: 'right' });
  const wavelength = menuOf(page).getByRole('menuitem', { name: /删除 1 列/ });
  await expect(wavelength).toBeDisabled();
  await expect(wavelength).toContainText('波长列是绘图的必需列');

  // 删除后的映射写入工作区，重绘只剩一条光谱。
  await page.waitForTimeout(700);
  const saved = (await savedWorkspace(page)) as unknown as {
    rawSheet: { mapping: { x: number; ys: number[] } };
    spectra: { id: string }[];
  };
  expect(saved.rawSheet.mapping.x).toBe(0);
  expect(saved.rawSheet.mapping.ys).toEqual([1]);
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(1);
});

test('右键单元格：保留 / 更新选区，Esc 关闭菜单', async ({ page }) => {
  await pasteRaw(page);

  // 单击 A2 后再右键 A2：选区不变。
  await rawCell(page, 2, 1).click();
  await rawCell(page, 2, 1).click({ button: 'right' });
  await expect(page.getByLabel('工作表当前选区')).toHaveText('A2');
  await expect(menuOf(page)).toBeVisible();

  // Esc 关闭菜单。
  await page.keyboard.press('Escape');
  await expect(menuOf(page)).toBeHidden();

  // 右键选区外：选中目标更新为该单元格。
  await rawCell(page, 3, 2).click({ button: 'right' });
  await expect(page.getByLabel('工作表当前选区')).toHaveText('B3');
  await expect(menuOf(page)).toBeVisible();
  await page.keyboard.press('Escape');
});

test('固定列页面禁用删除列并提示原因，行号菜单只给行操作', async ({ page }) => {
  await gotoPage(page, '对象筛选');
  const objects = page.getByRole('grid').first();
  const rowsBefore = Number(await objects.getAttribute('aria-rowcount'));

  await columnHeader(page, 'A').click({ button: 'right' });
  const menu = menuOf(page);
  const deleteColumn = menu.getByRole('menuitem', { name: /删除 1 列/ });
  await expect(deleteColumn).toBeDisabled();
  await expect(deleteColumn).toContainText('列固定');
  await expect(menu.getByRole('menuitem', { name: '插入列', exact: true })).toBeDisabled();
  // 列标菜单不混入行操作。
  await expect(menu.getByRole('menuitem', { name: /删除 \d+ 行/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 行号菜单仍然可以插入 / 删除行，并进入撤销历史。
  await expect(page.getByLabel('对象名称 2', { exact: true })).toHaveValue('Object A');
  await rowHeader(page, 2).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: /删除 1 行/ }).click();
  await expect(page.getByLabel('对象名称 2', { exact: true })).toHaveValue('Object B');
  await page.getByLabel('撤销工作表修改', { exact: true }).click();
  await expect(page.getByLabel('对象名称 2', { exact: true })).toHaveValue('Object A');
  expect(Number(await objects.getAttribute('aria-rowcount'))).toBe(rowsBefore);
});
