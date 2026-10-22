import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SHOT_DIR = path.resolve('验证截图-v0.5.5-2026.10.22');
mkdirSync(SHOT_DIR, { recursive: true });
const shot = (name: string) => path.join(SHOT_DIR, `${name}-v0.5.5-2026.10.22.png`);

const STORAGE_KEY = 'perovskite-lab-workspace-v1';

/** Paste a rectangular TSV block into a worksheet cell (same approach as the older specs). */
async function paste(cell: Locator, text: string) {
  await cell.evaluate((input, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

const sheetTab = (page: Page, name: string) =>
  page.getByRole('group', { name: '工作表标签' }).getByRole('button', { name, exact: true });

const rawCell = (page: Page, row: number, column: number) =>
  page.getByLabel(`原始数据第 ${row} 行第 ${column} 列`, { exact: true });

const gotoPage = async (page: Page, label: string) => {
  await page.getByRole('link', { name: label, exact: true }).click();
};

/** Focused element info: aria-label, value and selection range. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as (HTMLInputElement & HTMLElement) | null;
    return {
      label: el?.getAttribute?.('aria-label') ?? '',
      value: typeof el?.value === 'string' ? el.value : '',
      start: el?.selectionStart ?? -1,
      end: el?.selectionEnd ?? -1,
    };
  });

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

test('光谱工作台: 方向键导航、全选键入、逐字 Backspace 与 Delete/多选清空', async ({ page }) => {
  await pasteRaw(page);
  const grid = page.getByRole('grid').first();

  // Clicking a cell selects all of its text: typing replaces it directly.
  await rawCell(page, 2, 2).click();
  expect(await focused(page)).toMatchObject({
    label: '原始数据第 2 行第 2 列',
    value: '10',
    start: 0,
    end: 2,
  });

  // Arrow navigation moves the active cell and selects the target text.
  await page.keyboard.press('ArrowRight');
  expect(await focused(page)).toMatchObject({
    label: '原始数据第 2 行第 3 列',
    value: '30',
    start: 0,
    end: 2,
  });
  await page.keyboard.type('99');
  await expect(rawCell(page, 2, 3)).toHaveValue('99');
  // Typing keeps navigation mode: arrows still move cells.
  await page.keyboard.press('ArrowDown');
  expect(await focused(page)).toMatchObject({
    label: '原始数据第 3 行第 3 列',
    value: '40',
  });

  // Backspace deletes one character at a time (navigation mode stays active).
  await rawCell(page, 2, 1).click();
  expect(await focused(page)).toMatchObject({ value: '500', start: 0, end: 3 });
  await page.keyboard.press('Backspace');
  await expect(rawCell(page, 2, 1)).toHaveValue('50');
  await page.screenshot({
    path: shot('逐字删除与方向键导航'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.keyboard.press('Backspace');
  await expect(rawCell(page, 2, 1)).toHaveValue('5');
  await page.keyboard.press('Backspace');
  await expect(rawCell(page, 2, 1)).toHaveValue('');
  // Still in navigation mode after the character-by-character deletion.
  await page.keyboard.press('ArrowUp');
  expect((await focused(page)).label).toBe('原始数据第 1 行第 1 列');

  // Delete clears the whole cell.
  await rawCell(page, 3, 2).click();
  await page.keyboard.press('Delete');
  await expect(rawCell(page, 3, 2)).toHaveValue('');
  expect((await focused(page)).label).toBe('原始数据第 3 行第 2 列');

  // Multi-cell selection: Shift+Arrow extends, Delete clears the whole range.
  await rawCell(page, 3, 1).click();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByLabel('工作表当前选区')).toHaveText('A3:B3');
  await page.keyboard.press('Delete');
  await expect(rawCell(page, 3, 1)).toHaveValue('');
  await expect(rawCell(page, 3, 2)).toHaveValue('');
  await expect(grid).toBeVisible();
});

test('光谱工作台: 任意位置插入行/列、列映射与重绘、刷新持久化', async ({ page }) => {
  await pasteRaw(page);
  const grid = page.getByRole('grid').first();
  const panel = page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });

  // ---- Insert a column to the left of the active cell (column B, 0-based 1). ----
  const columnsBefore = Number(await grid.getAttribute('aria-colcount'));
  await rawCell(page, 2, 2).click();
  await page.getByLabel('插入列', { exact: true }).click();
  await expect(grid).toHaveAttribute('aria-colcount', String(columnsBefore + 1));
  await expect(rawCell(page, 1, 1)).toHaveValue('nm');
  await expect(rawCell(page, 1, 2)).toHaveValue('');
  await expect(rawCell(page, 1, 3)).toHaveValue('A');
  await expect(rawCell(page, 1, 4)).toHaveValue('B');
  await expect(rawCell(page, 2, 2)).toHaveValue('');
  await expect(rawCell(page, 2, 3)).toHaveValue('10');
  await expect(rawCell(page, 2, 4)).toHaveValue('30');
  // The wavelength/intensity mapping moved together with the data.
  await expect(panel).toContainText('可绘制 2 条光谱 · 4 个数据点');
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: shot('任意位置插入列后的光谱表'),
    fullPage: true,
    animations: 'disabled',
  });

  // Persisted mapping and column→spectrum keys shifted by one, data unchanged.
  await page.waitForTimeout(700);
  const shifted = (await savedWorkspace(page)) as unknown as {
    rawSheet: { grid: string[][]; mapping: { x: number; ys: number[] } };
    rawColumnSpectra: Record<string, string>;
    rawSpectra: { id: string; name: string; points: { x: number; y: number }[] }[];
  };
  expect(shifted.rawSheet.mapping.x).toBe(0);
  expect(shifted.rawSheet.mapping.ys).toEqual([2, 3]);
  expect(Object.keys(shifted.rawColumnSpectra).sort()).toEqual(['raw-2', 'raw-3']);
  const pointsOf = (column: string) => {
    const id = shifted.rawColumnSpectra[column];
    return shifted.rawSpectra.find((spectrum) => spectrum.id === id);
  };
  expect(pointsOf('raw-2')).toMatchObject({ name: 'A' });
  expect(pointsOf('raw-2')?.points).toEqual([
    { x: 500, y: 10 },
    { x: 510, y: 20 },
  ]);
  expect(pointsOf('raw-3')).toMatchObject({ name: 'B' });
  expect(pointsOf('raw-3')?.points).toEqual([
    { x: 500, y: 30 },
    { x: 510, y: 40 },
  ]);

  // ---- Insert a row above the active cell (middle of the data). ----
  const rowsBefore = Number(await grid.getAttribute('aria-rowcount'));
  await rawCell(page, 3, 1).click();
  await page.getByLabel('插入行', { exact: true }).click();
  await expect(grid).toHaveAttribute('aria-rowcount', String(rowsBefore + 1));
  await expect(rawCell(page, 3, 1)).toHaveValue('');
  await expect(rawCell(page, 4, 1)).toHaveValue('510');
  await expect(rawCell(page, 4, 3)).toHaveValue('20');
  await expect(panel).toContainText('可绘制 2 条光谱');
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);

  // ---- Insert a row above the header: the header/start row moves down. ----
  await rawCell(page, 1, 1).click();
  await page.getByLabel('插入行', { exact: true }).click();
  await expect(rawCell(page, 1, 1)).toHaveValue('');
  await expect(rawCell(page, 2, 1)).toHaveValue('nm');
  await expect(rawCell(page, 3, 1)).toHaveValue('500');
  await expect(panel).toContainText('可绘制 2 条光谱 · 4 个数据点');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: shot('光谱工作台插入行'),
    fullPage: true,
    animations: 'disabled',
  });
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);

  // ---- Everything survives a refresh and can be replotted without duplicates. ----
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByRole('group', { name: '工作表标签' })).toBeVisible();
  await expect(grid).toHaveAttribute('aria-colcount', String(columnsBefore + 1));
  await expect(rawCell(page, 1, 1)).toHaveValue('');
  await expect(rawCell(page, 2, 1)).toHaveValue('nm');
  await expect(rawCell(page, 4, 1)).toHaveValue('');
  await expect(rawCell(page, 5, 1)).toHaveValue('510');
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await expect(panel).toContainText('可绘制 2 条光谱');
  const restored = (await savedWorkspace(page)) as unknown as {
    rawSheet: { grid: string[][]; mapping: { start: number } };
  };
  expect(restored.rawSheet.mapping.start).toBe(2);
  expect(restored.rawSheet.grid[0]).toEqual(['', '', '', '']);
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
});

test('对象筛选: 任意位置插入行、图表恢复与切 sheet/刷新保留', async ({ page }) => {
  await gotoPage(page, '对象筛选');
  // Fixed-column pages only offer row insertion.
  await expect(page.getByLabel('插入行', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel('插入列', { exact: true })).toHaveCount(0);

  await page.getByLabel('对象名称 2', { exact: true }).click();
  await page.getByLabel('插入行', { exact: true }).click();
  await expect(page.getByLabel('对象名称 1', { exact: true })).toHaveValue('Blank');
  await expect(page.getByLabel('对象名称 2', { exact: true })).toHaveValue('对象 7');
  await expect(page.getByLabel('对象强度 2', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('对象名称 3', { exact: true })).toHaveValue('Object A');
  await expect(page.getByLabel('对象强度 3', { exact: true })).toHaveValue('11750');

  // A blank draft pauses the chart until the new object has an intensity.
  await expect(page.getByRole('alert')).toContainText('对象 7 的强度不是有效数值');
  await page.getByLabel('对象强度 2', { exact: true }).fill('5000');
  await expect(page.getByTestId('screening-chart')).toBeVisible();
  await page.screenshot({
    path: shot('对象筛选插入行'),
    fullPage: true,
    animations: 'disabled',
  });

  // Survives switching sheets and reloading.
  await page.getByLabel('新建 sheet', { exact: true }).click();
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');
  await sheetTab(page, '分析对象').click();
  await expect(page.getByLabel('对象名称 2', { exact: true })).toHaveValue('对象 7');
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByLabel('对象名称 2', { exact: true })).toHaveValue('对象 7');
  await expect(page.getByLabel('对象强度 2', { exact: true })).toHaveValue('5000');
  await expect(page.getByLabel('对象名称 3', { exact: true })).toHaveValue('Object A');
});

test('校准与检出限: 任意位置插入行、拟合恢复与切 sheet/刷新保留', async ({ page }) => {
  await gotoPage(page, '校准与检出限');
  await expect(page.getByLabel('插入行', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel('插入列', { exact: true })).toHaveCount(0);

  await page.getByLabel('校准浓度 2', { exact: true }).click();
  await page.getByLabel('插入行', { exact: true }).click();
  await expect(page.getByLabel('校准浓度 1', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('校准浓度 2', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('校准强度 2', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('拟合点 2', { exact: true })).toBeChecked();
  await expect(page.getByLabel('校准浓度 3', { exact: true })).toHaveValue('1');
  await expect(page.getByRole('alert').first()).toContainText('无效浓度或强度');

  // Fill the inserted point so the fit and chart come back.
  await page.getByLabel('校准浓度 2', { exact: true }).fill('0.5');
  await page.getByLabel('校准强度 2', { exact: true }).fill('11000');
  await expect(page.getByTestId('calibration-chart')).toBeVisible();
  await expect(page.getByTestId('calibration-chart').locator('circle')).not.toHaveCount(0);
  await page.screenshot({
    path: shot('校准插入行'),
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByLabel('新建 sheet', { exact: true }).click();
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');
  await sheetTab(page, '校准数据').click();
  await expect(page.getByLabel('校准浓度 2', { exact: true })).toHaveValue('0.5');
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByLabel('校准浓度 2', { exact: true })).toHaveValue('0.5');
  await expect(page.getByLabel('校准强度 2', { exact: true })).toHaveValue('11000');
  await expect(page.getByLabel('校准浓度 3', { exact: true })).toHaveValue('1');
});

test('浓度梯度: 插入行（含首行前导空行）与切 sheet/刷新保留', async ({ page }) => {
  await gotoPage(page, '浓度梯度');
  await expect(page.getByLabel('插入行', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel('插入列', { exact: true })).toHaveCount(0);
  const targets = page.getByLabel('目标浓度', { exact: true });
  await expect(targets).toHaveValue('0, 0.1, 0.5, 1, 2, 5, 10');

  // Insert in the middle of the target rows.
  await page.getByLabel('梯度目标浓度 2', { exact: true }).click();
  await page.getByLabel('插入行', { exact: true }).click();
  await expect(page.getByLabel('梯度目标浓度 1', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('梯度目标浓度 2', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('梯度目标浓度 3', { exact: true })).toHaveValue('0.1');
  await expect(targets).toHaveValue('0\n\n0.1\n0.5\n1\n2\n5\n10');
  await page.screenshot({
    path: shot('浓度梯度插入行'),
    fullPage: true,
    animations: 'disabled',
  });

  // Fill the draft row, then insert above the first row: a leading blank row is kept.
  await page.getByLabel('梯度目标浓度 2', { exact: true }).fill('0.2');
  await page.getByLabel('梯度目标浓度 1', { exact: true }).click();
  await page.getByLabel('插入行', { exact: true }).click();
  await expect(page.getByLabel('梯度目标浓度 1', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('梯度目标浓度 2', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('梯度目标浓度 3', { exact: true })).toHaveValue('0.2');
  await expect(targets).toHaveValue('\n0\n0.2\n0.1\n0.5\n1\n2\n5\n10');

  // The leading blank row survives a sheet switch and a reload.
  await page.getByLabel('新建 sheet', { exact: true }).click();
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');
  await sheetTab(page, '梯度配液').click();
  await expect(page.getByLabel('梯度目标浓度 1', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('梯度目标浓度 3', { exact: true })).toHaveValue('0.2');
  await page.waitForTimeout(700);
  await page.reload();
  await expect(sheetTab(page, '梯度配液')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('梯度目标浓度 1', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('梯度目标浓度 2', { exact: true })).toHaveValue('0');
  await expect(targets).toHaveValue('\n0\n0.2\n0.1\n0.5\n1\n2\n5\n10');
});

test('390px 手机端: 插入行列按钮换行且不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('插入行', { exact: true })).toBeVisible();
  await expect(page.getByLabel('插入列', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBe(true);

  // A wider raw table scrolls inside the worksheet, not the page.
  await pasteRaw(page);
  await rawCell(page, 2, 2).click();
  await page.getByLabel('插入列', { exact: true }).click();
  await expect(page.getByRole('grid').first()).toHaveAttribute('aria-colcount', '5');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBe(true);

  // Fixed-column pages expose the row button as well, still without page overflow.
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await page.getByRole('link', { name: '对象筛选', exact: true }).click();
  await expect(page.getByLabel('插入行', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBe(true);
});
