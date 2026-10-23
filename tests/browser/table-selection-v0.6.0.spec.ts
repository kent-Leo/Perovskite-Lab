import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Regression coverage for the Windows-only drag-to-select problems (v0.6.0):
 *
 * 1. After typing into a cell its input is focused / select-all. On Windows a
 *    mousedown inside such an input starts the browser's native text drag
 *    (dragstart + pointercancel), so td onPointerEnter never fires and drag-to-
 *    select silently dies.
 * 3. Fast drags can skip td onPointerEnter entirely, so only some cells update.
 *
 * The fix cancels native text drag/selection for cell bodies, focuses the input
 * manually, and adds a window-level elementFromPoint pointermove fallback. The
 * component demo page is used because it exposes the same shared Worksheet that
 * all four application pages render.
 */

const demo = '/worksheet-v0.2.0-2026.10.19.html';

const cellAt = (page: Page, row: number, column: number) =>
  page.locator(`[data-cell="${row}:${column}"]`);

const boxCenter = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('cell is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Press on `from`, move to `to` (optionally in one step), then release. */
async function dragBetween(
  page: Page,
  from: [number, number],
  to: [number, number],
  steps = 8,
  via?: { x: number; y: number },
) {
  const start = await boxCenter(cellAt(page, ...from));
  const end = await boxCenter(cellAt(page, ...to));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  if (via) await page.mouse.move(via.x, via.y);
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
}

/** Paste a rectangular TSV block into a cell (same technique as older specs). */
async function paste(cell: Locator, text: string) {
  await cell.evaluate((input, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

test.beforeEach(async ({ page }) => {
  await page.goto(demo);
  await expect(page.getByRole('grid')).toBeVisible();
});

test('输入数据后从该单元格拖动仍能框选“工作表当前选区”（问题 1）', async ({ page }) => {
  // Fill the sheet first: this is the "already has data" state from the report.
  await paste(
    page.getByRole('textbox', { name: 'Sheet1 A1', exact: true }),
    '1\t2\t3\n4\t5\t6\n7\t8\t9',
  );
  await expect(page.getByRole('textbox', { name: 'Sheet1 C3', exact: true })).toHaveValue('9');

  // Click + type: the input keeps focus with its text selected, exactly like the
  // Windows scenario where the next mousedown used to start a native text drag.
  const b1 = page.getByRole('textbox', { name: 'Sheet1 B1', exact: true });
  await b1.click();
  await page.keyboard.type('20');
  await expect(b1).toHaveValue('20');

  await dragBetween(page, [0, 1], [2, 3]);
  await expect(page.getByLabel('工作表当前选区')).toHaveText('B1:D3');
  for (const [row, column] of [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 1],
    [2, 2],
    [2, 3],
  ]) {
    await expect(cellAt(page, row, column)).toHaveAttribute('aria-selected', 'true');
  }

  // Shift+click still extends the existing selection.
  await cellAt(page, 0, 1).click();
  await cellAt(page, 1, 3).click({ modifiers: ['Shift'] });
  await expect(page.getByLabel('工作表当前选区')).toHaveText('B1:D2');
});

test('从已聚焦单元格直接按下拖动（未先移动）仍能框选（问题 1）', async ({ page }) => {
  const b2 = page.getByRole('textbox', { name: 'Sheet1 B2', exact: true });
  // The click leaves the pointer resting on B2 and its input focused/select-all.
  await b2.click();

  // Do NOT move before pressing: the press itself must start the drag.
  const start = await boxCenter(cellAt(page, 1, 1));
  const end = await boxCenter(cellAt(page, 2, 2));
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 2); // tiny move inside the same cell
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByLabel('工作表当前选区')).toHaveText('B2:C3');
  await expect(cellAt(page, 2, 2)).toHaveAttribute('aria-selected', 'true');
});

test('快速一步跨多格 / 指针离开表格再回来仍选中完整矩形（问题 3）', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Sheet1 A1', exact: true }).click();

  // A single pointermove straight to D4 (as produced by a very fast drag).
  await dragBetween(page, [0, 0], [3, 3], 1);
  await expect(page.getByLabel('工作表当前选区')).toHaveText('A1:D4');

  // Leave the table (over the page header) and come back: the last valid cell
  // stays selected and returning to the grid keeps extending correctly.
  const start = await boxCenter(cellAt(page, 0, 0));
  const end = await boxCenter(cellAt(page, 2, 2));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 10);
  await page.mouse.move(20, 20); // outside the worksheet entirely
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByLabel('工作表当前选区')).toHaveText('A1:C3');
});

test('单元格输入不产生原生 dragstart，行号仍可继续作为拖拽源（问题 1）', async ({ page }) => {
  const b1 = page.getByRole('textbox', { name: 'Sheet1 B1', exact: true });
  // draggable={false} on the cell input, plus CSS -webkit-user-drag: none.
  await expect(b1).toHaveAttribute('draggable', 'false');

  const preventedForCell = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[data-cell="0:1"] input');
    if (!input) throw new Error('cell input missing');
    const event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(preventedForCell).toBe(true);

  // A dragstart from the row-number button (outside [data-cell]) is not blocked,
  // so the row reordering drag source keeps working.
  const preventedForRow = await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('tbody th button');
    if (!button) throw new Error('row button missing');
    const event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(preventedForRow).toBe(false);
});

test('双击与 F2 仍进入编辑模式，单击仍全选单元格文本', async ({ page }) => {
  const c2 = page.getByRole('textbox', { name: 'Sheet1 C2', exact: true });
  // Single click: focused input with all text selected (typing replaces it).
  await c2.click();
  const selectionRange = await c2.evaluate((input: HTMLInputElement) => ({
    focused: document.activeElement === input,
    start: input.selectionStart,
    end: input.selectionEnd,
    length: input.value.length,
  }));
  // C2 is "90" in the demo sheet.
  expect(selectionRange).toEqual({ focused: true, start: 0, end: 2, length: 2 });

  // F2 enters edit mode.
  await page.keyboard.press('F2');
  await expect(cellAt(page, 1, 2)).toHaveClass(/is-editing/);
  await page.keyboard.press('Escape');

  // Double click enters edit mode as before.
  await c2.dblclick();
  await expect(cellAt(page, 1, 2)).toHaveClass(/is-editing/);
});
