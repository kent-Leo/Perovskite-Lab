import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../../src/version-v0.7.0-2026.10.24';
import { dateStamp } from '../../src/services/download';

/**
 * v0.6.0 release verification screenshots.
 *
 * They are produced by the normal browser suite so the README images always
 * match the shipped build: per-sheet chart titles, optional data-point values
 * and the repaired drag-to-select behaviour.
 */
const SHOT_DIR = path.resolve(`验证截图-v${APP_VERSION}-${dateStamp()}`);
mkdirSync(SHOT_DIR, { recursive: true });
const shot = (name: string) => path.join(SHOT_DIR, `${name}-v${APP_VERSION}-${dateStamp()}.png`);

const paste = async (cell: Locator, text: string) => {
  await cell.evaluate((input, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
};

const gotoPage = async (page: Page, label: string) => {
  await page.getByRole('link', { name: label, exact: true }).click();
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('group', { name: '工作表标签' })).toBeVisible();
});

test('数据点数值：对象筛选 / 校准曲线 / 单条光谱', async ({ page }) => {
  // 对象筛选：6 根柱子的数值标在柱顶。
  await gotoPage(page, '对象筛选');
  await expect(page.getByTestId('chart-title')).toHaveText('分析对象筛选');
  await page.getByLabel('显示数据点数值', { exact: true }).check();
  await expect(page.getByTestId('screening-chart').locator('[data-point-value]')).toHaveCount(6);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot('数据点数值-对象筛选'), fullPage: true, animations: 'disabled' });

  // 校准与检出限：只标测量点，不标线性拟合线端点。
  await gotoPage(page, '校准与检出限');
  await page.getByLabel('显示数据点数值', { exact: true }).check();
  await expect(page.getByTestId('calibration-chart').locator('[data-point-value]')).toHaveCount(6);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot('数据点数值-校准曲线'), fullPage: true, animations: 'disabled' });

  // 单条光谱：数值标在每个数据点旁（演示数据每条 161 点，单条更易读）。
  await gotoPage(page, '光谱工作台');
  await page.getByRole('button', { name: '单条光谱', exact: true }).click();
  await page.getByLabel('显示数据点数值', { exact: true }).check();
  await expect(page.getByTestId('spectra-chart').locator('[data-point-value]')).toHaveCount(161);
  await page.locator('.chart-card').screenshot({
    path: shot('数据点数值-单条光谱'),
    animations: 'disabled',
  });

  // 切到其他页面再回来，勾选状态随样式保留。
  await gotoPage(page, '对象筛选');
  await expect(page.getByLabel('显示数据点数值', { exact: true })).toBeChecked();
});

test('每个 sheet 的图表标题独立：按 sheet 保存且不带 sheet 名', async ({ page }) => {
  // 原始光谱 sheet 使用页面默认标题，标题中不出现 sheet 名。
  await expect(page.getByTestId('chart-title')).toHaveText('荧光光谱');
  await expect(page.getByTestId('spectra-chart')).not.toContainText('原始光谱');

  // 给当前 sheet 一个自定义标题，只影响它自己。
  await page.getByLabel('图表标题', { exact: true }).fill('CsPbCl3响应图');
  await expect(page.getByTestId('chart-title')).toHaveText('CsPbCl3响应图');

  // 新建 Sheet 2 并粘贴两条光谱绘图：先回到默认标题，再设置自己的标题。
  await page.getByRole('button', { name: '新建 sheet', exact: true }).click();
  await expect(page.getByTestId('chart-title')).toHaveText('荧光光谱');
  await page.getByLabel('图表标题', { exact: true }).fill('Sheet 2 响应图');
  const panel = page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
  await paste(
    panel.getByLabel('原始数据第 1 行第 1 列', { exact: true }),
    'nm\tSheetA\tSheetB\n500\t10\t30\n510\t20\t40\n520\t10\t30',
  );
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await expect(page.getByTestId('chart-title')).toHaveText('Sheet 2 响应图');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot('每sheet图表标题'), fullPage: true, animations: 'disabled' });

  // 切回原始光谱 sheet：恢复它自己的标题。
  await page
    .getByRole('group', { name: '绘图 sheet' })
    .getByRole('button', { name: '绘图 sheet 原始光谱', exact: true })
    .click();
  await expect(page.getByTestId('chart-title')).toHaveText('CsPbCl3响应图');

  // 「全部 sheet」：每张卡片的图各有自己的标题，卡片标题仍是 sheet 名。
  await page.getByRole('button', { name: '全部 sheet', exact: true }).click();
  await expect(page.locator('.sheet-gallery-card')).toHaveCount(2);
  await expect(
    page.locator('[data-testid="gallery-chart-raw"] .sheet-gallery-chart svg'),
  ).toContainText('CsPbCl3响应图');
  await expect(
    page.locator('[data-testid="gallery-chart-raw-2"] .sheet-gallery-chart svg'),
  ).toContainText('Sheet 2 响应图');
  await page.screenshot({
    path: shot('全部sheet各自的图表标题'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('表格拖拽框选：输入数据后与快速拖动', async ({ page }) => {
  const panel = page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
  await paste(
    panel.getByLabel('原始数据第 1 行第 1 列', { exact: true }),
    'nm\tA\tB\n500\t10\t30\n510\t20\t40\n520\t10\t30',
  );
  const start = page.locator('[data-cell="0:0"]'),
    end = page.locator('[data-cell="3:2"]');
  const a = (await start.boundingBox())!,
    b = (await end.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // 一步跨多格，模拟 Windows 上快速拖动。
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 1 });
  await page.mouse.up();
  await expect(page.getByLabel('工作表当前选区')).toHaveText('A1:C4');
  await panel.locator('.worksheet').screenshot({
    path: shot('表格拖拽框选'),
    animations: 'disabled',
  });
});

test('390px 手机端：表格与图表标题', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('group', { name: '工作表标签' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({ path: shot('手机端'), fullPage: true, animations: 'disabled' });
});
