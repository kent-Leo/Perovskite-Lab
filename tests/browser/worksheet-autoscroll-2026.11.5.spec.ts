import { test, expect, type Page } from '@playwright/test';

const panel = (page: Page) =>
  page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
const cell = (page: Page, row: number, column: number) =>
  panel(page).getByLabel(`原始数据第 ${row} 行第 ${column} 列`, { exact: true });
const scrollBox = (page: Page) => panel(page).locator('.worksheet-scroll');
const cellTd = (page: Page, row: number, column: number) =>
  panel(page).locator(`[data-cell="${row - 1}:${column - 1}"]`);
const selectionLabel = (page: Page) => page.getByLabel('工作表当前选区');
/** 选区文本形如 A2:C12，末行号用于判断自动滚动时选区是否继续扩展。 */
const lastRowOf = (label: string) => Number(/(\d+)$/.exec(label.trim().split(':').pop() ?? '')?.[1] ?? 0);

async function pasteAtFirstCell(page: Page, text: string) {
  await cell(page, 1, 1).evaluate((input, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

/** 行数 / 列数都超过可视区域的数据块，用于自动滚动与整块复制。 */
async function seedTable(page: Page, rows: number, columns: number) {
  const header = Array.from({ length: columns }, (_, c) => `C${c + 1}`).join('\t');
  const body = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: columns }, (_, c) => String((r + 1) * 10 + c)).join('\t'),
  );
  await pasteAtFirstCell(page, [header, ...body].join('\n'));
}

async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
}

test('正向拖到 D10 与反向拖到 A1 得到同一个矩形选区', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1500 });
  await page.goto('/');
  await seedTable(page, 10, 4);
  const a1 = (await cell(page, 1, 1).boundingBox())!;
  const d10 = (await cell(page, 10, 4).boundingBox())!;
  expect(d10).not.toBeNull();

  await dragBetween(
    page,
    { x: a1.x + 12, y: a1.y + 12 },
    { x: d10.x + 12, y: d10.y + 12 },
  );
  await expect(selectionLabel(page)).toHaveText('A1:D10');
  await expect(cellTd(page, 10, 4)).toHaveClass(/is-active/);
  await page.mouse.up();

  await cell(page, 10, 4).click();
  await dragBetween(
    page,
    { x: d10.x + 12, y: d10.y + 12 },
    { x: a1.x + 12, y: a1.y + 12 },
  );
  await expect(selectionLabel(page)).toHaveText('A1:D10');
  await page.mouse.up();

  // 矩形外框与活动单元格高亮同时存在。
  await expect(cellTd(page, 1, 1)).toHaveClass(/is-range-top/);
  await expect(cellTd(page, 1, 1)).toHaveClass(/is-range-left/);
  await expect(cellTd(page, 10, 4)).toHaveClass(/is-range-bottom/);
  await expect(cellTd(page, 10, 4)).toHaveClass(/is-range-right/);
  await expect(cellTd(page, 5, 2)).not.toHaveClass(/is-range-top|is-range-left/);
  // 反向拖动后活动单元格是落点 A1，矩形范围不变。
  await expect(cellTd(page, 1, 1)).toHaveClass(/is-active/);
  const border = await cellTd(page, 1, 1).evaluate((node) => getComputedStyle(node).boxShadow);
  expect(border).toContain('inset');
});

test('拖到可视区域底部自动纵向滚动，继续扩展选区，松开立即停止', async ({ page }) => {
  await page.goto('/');
  await seedTable(page, 80, 3);
  await cell(page, 2, 1).click();
  const scroll = scrollBox(page);
  await scroll.evaluate((el) => {
    el.scrollTop = 0;
  });
  const box = (await scroll.boundingBox())!;
  const start = (await cell(page, 2, 1).boundingBox())!;
  await dragBetween(
    page,
    { x: start.x + 20, y: start.y + 10 },
    { x: box.x + box.width - 60, y: Math.min(box.y + box.height - 3, 1040) },
  );
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollTop), { timeout: 5000 })
    .toBeGreaterThan(150);
  const firstRow = lastRowOf((await selectionLabel(page).textContent()) ?? '');
  expect(firstRow).toBeGreaterThan(2);
  await expect
    .poll(async () => {
      const label = (await selectionLabel(page).textContent()) ?? '';
      return lastRowOf(label) > firstRow;
    }, { timeout: 5000 })
    .toBe(true);
  await page.mouse.up();
  const released = await scroll.evaluate((el) => el.scrollTop);
  await page.waitForTimeout(400);
  expect(await scroll.evaluate((el) => el.scrollTop)).toBe(released);
});

test('拖到右边缘自动横向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 1000 });
  await page.goto('/');
  // 列数足够多时表格才出现横向滚动条。
  await seedTable(page, 12, 12);
  await cell(page, 2, 1).click();
  const scroll = scrollBox(page);
  const metrics = await scroll.evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  await scroll.evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
  const box = (await scroll.boundingBox())!;
  const start = (await cell(page, 2, 1).boundingBox())!;
  await dragBetween(
    page,
    { x: start.x + 12, y: start.y + 10 },
    { x: Math.min(box.x + box.width - 3, 699), y: start.y + 10 },
  );
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollLeft), { timeout: 5000 })
    .toBeGreaterThan(60);
  await page.mouse.up();
  const released = await scroll.evaluate((el) => el.scrollLeft);
  await page.waitForTimeout(300);
  expect(await scroll.evaluate((el) => el.scrollLeft)).toBe(released);
});

test('复制矩形选区为 TSV，粘贴到单元格按左上角展开', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1500 });
  await page.goto('/');
  await seedTable(page, 8, 4);
  await cell(page, 1, 1).click();
  const a1 = (await cell(page, 1, 1).boundingBox())!;
  const b3 = (await cell(page, 3, 2).boundingBox())!;
  await dragBetween(page, { x: a1.x + 12, y: a1.y + 12 }, { x: b3.x + 12, y: b3.y + 12 });
  await page.mouse.up();
  await expect(selectionLabel(page)).toHaveText('A1:B3');
  const copied = await cell(page, 2, 2).evaluate((node) => {
    const data = new DataTransfer();
    node.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData('text/plain');
  });
  expect(copied.split('\n')).toHaveLength(3);
  expect(copied.split('\n')[0].split('\t')).toHaveLength(2);

  // 反向选区粘贴：起点同样是选区左上角。
  await cell(page, 8, 4).click();
  await cell(page, 8, 4).evaluate((input, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, copied);
  await expect(cell(page, 8, 4)).toHaveValue(copied.split('\n')[0].split('\t')[0]);
  await expect(cell(page, 9, 5)).toHaveValue(copied.split('\n')[1].split('\t')[1]);
  await expect(cell(page, 10, 5)).toHaveValue(copied.split('\n')[2].split('\t')[1]);

  // 真实 Ctrl+V 落在活动单元格（正向框选的右下角），起点仍是选区左上角。
  await cell(page, 6, 1).click();
  const a6 = (await cell(page, 6, 1).boundingBox())!;
  const b8 = (await cell(page, 8, 2).boundingBox())!;
  await dragBetween(page, { x: a6.x + 12, y: a6.y + 12 }, { x: b8.x + 12, y: b8.y + 12 });
  await page.mouse.up();
  await expect(selectionLabel(page)).toHaveText('A6:B8');
  await cell(page, 8, 2).evaluate((input) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'X\tY\n1\t2');
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(cell(page, 6, 1)).toHaveValue('X');
  await expect(cell(page, 6, 2)).toHaveValue('Y');
  await expect(cell(page, 7, 1)).toHaveValue('1');
  await expect(cell(page, 7, 2)).toHaveValue('2');
  await expect(selectionLabel(page)).toHaveText('A6:B7');
});

test('粘贴无效数值整批失败，原表格不变', async ({ page }) => {
  await page.goto('/#screening');
  const grid = page.getByRole('grid');
  const conc = (row: number) => page.getByLabel(`对象浓度 ${row}`, { exact: true });
  const name = (row: number) => page.getByLabel(`对象名称 ${row}`, { exact: true });
  await expect(grid).toBeVisible();
  const before = await conc(1).inputValue();
  const nameBefore = await name(1).inputValue();
  await conc(1).click();
  // 浓度列是数值列：整块数据里有一个非法值时必须整体拒绝。
  await conc(1).evaluate((input) => {
    const data = new DataTransfer();
    data.setData('text/plain', '12\nabc');
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.locator('.worksheet-status')).toContainText('只接受数值');
  await expect(name(1)).toHaveValue(nameBefore);
  await expect(conc(1)).toHaveValue(before);
});

test('单元格编辑的撤销与重做保持数据与图表一致', async ({ page }) => {
  await page.goto('/');
  await seedTable(page, 6, 3);
  const chart = page.getByTestId('spectra-chart');
  const before = await chart.locator('polyline').count();
  expect(before).toBeGreaterThan(0);
  await cell(page, 2, 2).click();
  await cell(page, 2, 2).fill('20');
  await expect(cell(page, 2, 2)).toHaveValue('20');
  await page.keyboard.press('Control+z');
  await expect(cell(page, 2, 2)).not.toHaveValue('20');
  await page.keyboard.press('Control+y');
  await expect(cell(page, 2, 2)).toHaveValue('20');
  await page.keyboard.press('Control+z');
  await expect(cell(page, 2, 2)).not.toHaveValue('20');
  await page.keyboard.press('Control+Shift+z');
  await expect(cell(page, 2, 2)).toHaveValue('20');
  // 撤销 / 重做只改数据，不破坏绘图管线。
  await expect(chart.locator('polyline')).toHaveCount(before);
});
