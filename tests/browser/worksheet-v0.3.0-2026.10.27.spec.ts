import { test, expect } from '@playwright/test';

const demo = '/worksheet-v0.3.0-2026.10.27.html';
test.beforeEach(async ({ page }) => {
  await page.goto(demo);
  await expect(page.getByRole('grid')).toBeVisible();
});

test('displays version, edits data and restores derived results with undo/redo', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { level: 1 })).toContainText('v0.3.0');
  await page.getByRole('textbox', { name: 'Sheet1 B1', exact: true }).fill('120');
  await expect(page.getByLabel('Sheet1 D1', { exact: true })).toHaveText('80');
  await page.getByRole('button', { name: '撤销工作表修改', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Sheet1 B1', exact: true })).toHaveValue('100');
  await expect(page.getByLabel('Sheet1 D1', { exact: true })).toHaveText('60');
  await page.getByRole('button', { name: '重做工作表修改', exact: true }).click();
  await expect(page.getByLabel('Sheet1 D1', { exact: true })).toHaveText('80');
});

test('pastes rectangular data atomically, clears missing readings and protects result columns', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Sheet1 A1', exact: true });
  const paste = async (text: string) =>
    input.evaluate((el, value) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', value);
      el.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }),
      );
    }, text);
  await paste('520\t12\n530');
  await expect(page.getByRole('textbox', { name: 'Sheet1 B2', exact: true })).toHaveValue('');
  await expect(page.getByLabel('工作表当前选区')).toHaveText('A1:B2');
  await paste('540\t30\n550\tbad');
  await expect(page.getByRole('textbox', { name: 'Sheet1 A1', exact: true })).toHaveValue('520');
  await expect(page.locator('.worksheet-status')).toContainText('只接受数值');
  await paste('540\t30\t20\t999');
  await expect(page.locator('.worksheet-status')).toContainText('只读计算列');
  await expect(page.getByLabel('Sheet1 D1', { exact: true })).toHaveText('-28');
});

test('copies column ranges, clears editable ranges and preserves metadata keyboard editing', async ({
  page,
}) => {
  const header = page.getByRole('button', { name: '选择 A 列', exact: true });
  await header.click();
  const copied = await header.evaluate((el) => {
    const clipboardData = new DataTransfer();
    el.dispatchEvent(
      new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData }),
    );
    return clipboardData.getData('text/plain');
  });
  expect(copied.split('\n').slice(0, 3)).toEqual(['500', '510', '520']);
  const metadata = page.getByRole('textbox', { name: 'Sheet1 第 1 列名称', exact: true });
  await metadata.fill('波长nm');
  await metadata.press('End');
  await metadata.press('Backspace');
  await expect(metadata).toHaveValue('波长n');
  await expect(metadata).toBeFocused();
  const input = page.getByRole('textbox', { name: 'Sheet1 A1', exact: true });
  await input.focus();
  await input.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByLabel('工作表当前选区')).toHaveText('B1:B2');
  await page.keyboard.press('Delete');
  await expect(page.getByRole('textbox', { name: 'Sheet1 B1', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Sheet1 C1', exact: true })).toHaveValue('40');
});

test('navigates continuously beyond row 20 and adds a separately named sample column', async ({ page }) => {
  await page.getByRole('button', { name: '行', exact: true }).click();
  await page.getByRole('button', { name: '行', exact: true }).click();
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toHaveCount(0);
  await expect(page.getByRole('grid').locator('tbody tr')).toHaveCount(26);
  const cell = page.locator('[data-cell="19:3"]');
  await cell.focus();
  await cell.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Sheet1 A21', exact: true })).toBeFocused();
  await expect(page.locator('[data-cell="20:0"]').locator('..')).toHaveAttribute(
    'aria-rowindex',
    '25',
  );
  await page.getByRole('button', { name: '列', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Sheet1 第 5 列名称', exact: true })).toHaveValue(
    'Sample 3',
  );
});

test('keeps the worksheet inside a horizontally scrollable region on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    await page.locator('.worksheet-scroll').evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true);
});
