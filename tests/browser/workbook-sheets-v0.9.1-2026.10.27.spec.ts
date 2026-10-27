import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SHOT_DIR = path.resolve('验证截图-v0.9.1-2026.10.27');
mkdirSync(SHOT_DIR, { recursive: true });
const shot = (name: string) => path.join(SHOT_DIR, `${name}-v0.9.1-2026.10.27.png`);

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

const plotTab = (page: Page, name: string) =>
  page
    .getByRole('group', { name: '绘图 sheet' })
    .getByRole('button', { name: `绘图 sheet ${name}`, exact: true });

const createSheet = async (page: Page) => {
  await page.getByLabel('新建 sheet', { exact: true }).click();
};

const gotoPage = async (page: Page, label: string) => {
  await page.getByRole('link', { name: label, exact: true }).click();
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('group', { name: '工作表标签' })).toBeVisible();
});

test('光谱工作台: 多 sheet 粘贴绘图、全部 sheet 平铺、切回、重命名与刷新持久化', async ({
  page,
}, info) => {
  // Demo workspace starts with one sheet and six plotted spectra.
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(6);
  await expect(sheetTab(page, '原始光谱')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('删除当前 sheet', { exact: true })).toBeDisabled();

  // New sheet: becomes active immediately and starts with an empty plot.
  await createSheet(page);
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('删除当前 sheet', { exact: true })).toBeEnabled();
  await expect(page.getByTestId('spectra-chart')).toHaveCount(0);
  await expect(page.locator('.chart-card')).toContainText('图表待生成');
  await expect(page.getByRole('button', { name: '全部 sheet', exact: true })).toBeVisible();

  // Paste two spectra into Sheet 2 and plot them.
  const panel = page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
  await paste(
    panel.getByLabel('原始数据第 1 行第 1 列', { exact: true }),
    'nm\tSheetA\tSheetB\n500\t10\t30\n510\t20\t40\n520\t10\t30',
  );
  await expect(panel).toContainText('可绘制 2 条光谱 · 6 个数据点');
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await expect(page.locator('.chart-head')).toContainText('Sheet 2');
  await expect(plotTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: shot('光谱工作台多sheet表格'),
    fullPage: true,
    animations: 'disabled',
  });

  // Switching back restores the demo spectra untouched.
  await plotTab(page, '原始光谱').click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(6);
  await expect(sheetTab(page, '原始光谱')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.chart-head')).toContainText('原始光谱');

  // "All sheets" tiles every sheet with its own chart.
  await page.getByRole('button', { name: '全部 sheet', exact: true }).click();
  await expect(page.locator('.sheet-gallery-card')).toHaveCount(2);
  await expect(page.locator('[data-testid="gallery-chart-raw"] h3')).toHaveText('原始光谱');
  await expect(page.locator('[data-testid="gallery-chart-raw-2"] h3')).toHaveText('Sheet 2');
  await expect(page.locator('.sheet-gallery-chart svg')).toHaveCount(2);
  await page.screenshot({
    path: shot('全部sheet平铺绘图'),
    fullPage: true,
    animations: 'disabled',
  });

  // A gallery card switches the view back to that sheet.
  await page.getByRole('button', { name: '查看 sheet Sheet 2', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');

  // Rename the active sheet; both the worksheet tab and plot tab follow.
  await page.getByRole('button', { name: '重命名标签 Sheet 2', exact: true }).click();
  const renameInput = page.getByLabel('工作表标签名', { exact: true });
  await renameInput.fill('实验组 A');
  await renameInput.press('Enter');
  await expect(sheetTab(page, '实验组 A')).toHaveAttribute('aria-pressed', 'true');
  await expect(plotTab(page, '实验组 A')).toBeVisible();

  // Everything survives a refresh: tabs, active sheet, table cells and curves.
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByRole('group', { name: '工作表标签' })).toBeVisible();
  await expect(sheetTab(page, '实验组 A')).toHaveAttribute('aria-pressed', 'true');
  await expect(sheetTab(page, '原始光谱')).toBeVisible();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await expect(panel.getByLabel('原始数据第 1 行第 1 列', { exact: true })).toHaveValue('nm');
  await expect(panel.getByLabel('原始数据第 2 行第 1 列', { exact: true })).toHaveValue('500');
  await expect(panel.getByLabel('原始数据第 2 行第 2 列', { exact: true })).toHaveValue('10');
  await sheetTab(page, '原始光谱').click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(6);
  await sheetTab(page, '实验组 A').click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
});

test('对象筛选: 新 sheet 数据隔离、全部 sheet 视图与刷新持久化', async ({ page }, info) => {
  await gotoPage(page, '对象筛选');
  await expect(sheetTab(page, '分析对象')).toHaveAttribute('aria-pressed', 'true');
  const originalBars = await page.getByTestId('screening-chart').locator('rect').count();
  expect(originalBars).toBeGreaterThan(0);

  await createSheet(page);
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('screening-chart')).toHaveCount(0);
  await expect(page.locator('.chart-card')).toContainText('图表待生成');

  // Two fresh objects make a bar chart appear.
  await page.getByRole('button', { name: '添加对象', exact: true }).click();
  await page.getByRole('button', { name: '添加对象', exact: true }).click();
  await page.getByLabel('对象名称 1', { exact: true }).fill('Blank');
  await page.getByLabel('对象强度 1', { exact: true }).fill('12000');
  await page.getByLabel('对象名称 2', { exact: true }).fill('Cd2+');
  await page.getByLabel('对象强度 2', { exact: true }).fill('2800');
  await page.getByLabel('空白参考 F₀', { exact: true }).selectOption({ label: 'Blank' });
  await expect(page.getByTestId('screening-chart')).toBeVisible();
  expect(await page.getByTestId('screening-chart').locator('rect').count()).toBeGreaterThan(0);
  await expect(page.locator('.chart-head')).toContainText('Sheet 2');
  await expect(page.locator('.chart-head')).toContainText('2 个对象');
  await page.screenshot({
    path: shot('对象筛选多sheet'),
    fullPage: true,
    animations: 'disabled',
  });

  // Switching back restores the untouched demo sheet.
  await sheetTab(page, '分析对象').click();
  await expect(page.getByTestId('screening-chart').locator('rect')).toHaveCount(originalBars);
  await expect(page.getByLabel('对象名称 1', { exact: true })).toHaveValue('Blank');
  await expect(page.getByLabel('对象名称 2', { exact: true })).toHaveValue('Object A');

  // All sheets renders both cards with their own charts.
  await page.getByRole('button', { name: '全部 sheet', exact: true }).click();
  await expect(page.locator('.sheet-gallery-card')).toHaveCount(2);
  await expect(page.locator('[data-testid="gallery-chart-screening"] h3')).toHaveText('分析对象');
  await expect(page.locator('[data-testid="gallery-chart-screening-2"] h3')).toHaveText('Sheet 2');
  await expect(page.locator('.sheet-gallery-chart svg')).toHaveCount(2);
  await page.getByRole('button', { name: '查看 sheet Sheet 2', exact: true }).click();
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');

  await page.waitForTimeout(700);
  await page.reload();
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('screening-chart')).toBeVisible();
  await expect(page.getByLabel('对象名称 2', { exact: true })).toHaveValue('Cd2+');
  await expect(page.getByLabel('对象强度 2', { exact: true })).toHaveValue('2800');
  await sheetTab(page, '分析对象').click();
  await expect(page.getByTestId('screening-chart').locator('rect')).toHaveCount(originalBars);
});

test('校准与检出限: 新 sheet 继承方法设置、拟合绘图与刷新持久化', async ({ page }, info) => {
  await gotoPage(page, '校准与检出限');
  await expect(sheetTab(page, '校准数据')).toHaveAttribute('aria-pressed', 'true');
  const originalCircles = await page.getByTestId('calibration-chart').locator('circle').count();
  expect(originalCircles).toBeGreaterThan(0);

  await createSheet(page);
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('calibration-chart')).toHaveCount(0);
  // A new calibration sheet inherits the current method settings.
  await expect(page.getByLabel('固定参考 F₀', { exact: true })).toHaveValue('12000');
  await expect(page.getByLabel('响应方式', { exact: true })).toHaveValue('quench');

  // Two points produce a scatter set plus the fitted line.
  await page.getByRole('button', { name: '添加点', exact: true }).click();
  await page.getByRole('button', { name: '添加点', exact: true }).click();
  await page.getByLabel('校准浓度 1', { exact: true }).fill('1');
  await page.getByLabel('校准强度 1', { exact: true }).fill('1000');
  await page.getByLabel('校准浓度 2', { exact: true }).fill('2');
  await page.getByLabel('校准强度 2', { exact: true }).fill('900');
  await expect(page.getByTestId('calibration-chart')).toBeVisible();
  await expect(page.getByTestId('calibration-chart').locator('circle')).toHaveCount(2);
  await expect(page.getByTestId('calibration-chart').locator('polyline')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.chart-head')).toContainText('Sheet 2');
  await page.screenshot({
    path: shot('校准多sheet'),
    fullPage: true,
    animations: 'disabled',
  });

  // Previous sheet restores its demo calibration points.
  await sheetTab(page, '校准数据').click();
  await expect(page.getByTestId('calibration-chart').locator('circle')).toHaveCount(originalCircles);
  await expect(page.getByLabel('校准浓度 1', { exact: true })).toHaveValue('0');

  await page.getByRole('button', { name: '全部 sheet', exact: true }).click();
  await expect(page.locator('.sheet-gallery-card')).toHaveCount(2);
  await expect(page.locator('[data-testid="gallery-chart-calibration"] h3')).toHaveText('校准数据');
  await expect(page.locator('[data-testid="gallery-chart-calibration-2"] h3')).toHaveText('Sheet 2');
  await expect(page.locator('.sheet-gallery-chart svg')).toHaveCount(2);
  await page.getByRole('button', { name: '查看 sheet Sheet 2', exact: true }).click();

  await page.waitForTimeout(700);
  await page.reload();
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('calibration-chart').locator('circle')).toHaveCount(2);
  await expect(page.getByTestId('calibration-chart').locator('polyline')).toHaveCount(1);
  await expect(page.getByLabel('校准浓度 1', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('校准强度 2', { exact: true })).toHaveValue('900');
  await sheetTab(page, '校准数据').click();
  await expect(page.getByTestId('calibration-chart').locator('circle')).toHaveCount(originalCircles);
});

test('浓度梯度: 新建 sheet 默认目标浓度、切回恢复、刷新保留与删除当前 sheet', async ({
  page,
}, info) => {
  await gotoPage(page, '浓度梯度');
  await expect(sheetTab(page, '梯度配液')).toHaveAttribute('aria-pressed', 'true');
  const targets = page.getByLabel('目标浓度', { exact: true });
  await expect(targets).toHaveValue('0, 0.1, 0.5, 1, 2, 5, 10');

  // Give the original sheet a distinctive recipe before creating a second one.
  await targets.fill('5, 10');
  await createSheet(page);
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');
  // A new gradient sheet starts from the default target concentrations.
  await expect(targets).toHaveValue('0, 0.1, 0.5, 1, 2, 5, 10');
  await targets.fill('1, 2, 3');
  await expect(targets).toHaveValue('1, 2, 3');
  await page.screenshot({
    path: shot('浓度梯度多sheet'),
    fullPage: true,
    animations: 'disabled',
  });

  // Each sheet keeps its own recipe when switching.
  await sheetTab(page, '梯度配液').click();
  await expect(targets).toHaveValue('5, 10');
  await sheetTab(page, 'Sheet 2').click();
  await expect(targets).toHaveValue('1, 2, 3');

  // Both recipes survive a reload.
  await page.waitForTimeout(700);
  await page.reload();
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(targets).toHaveValue('1, 2, 3');
  await sheetTab(page, '梯度配液').click();
  await expect(targets).toHaveValue('5, 10');
  await sheetTab(page, 'Sheet 2').click();

  // Delete the current sheet: no confirm dialog is required, the neighbour stays.
  await page.getByLabel('删除当前 sheet', { exact: true }).click();
  await expect(page.getByRole('group', { name: '工作表标签' }).getByRole('button')).toHaveCount(1);
  await expect(sheetTab(page, '梯度配液')).toHaveAttribute('aria-pressed', 'true');
  await expect(targets).toHaveValue('5, 10');
  await expect(page.getByLabel('删除当前 sheet', { exact: true })).toBeDisabled();
});

test('390px 手机端: 多 sheet 界面与全部 sheet 视图不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('group', { name: '工作表标签' })).toBeVisible();
  await createSheet(page);
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');

  const panel = page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
  await paste(
    panel.getByLabel('原始数据第 1 行第 1 列', { exact: true }),
    'nm\tA\tB\n500\t10\t30\n510\t20\t40',
  );
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '全部 sheet', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: shot('手机端多sheet'),
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByRole('button', { name: '全部 sheet', exact: true }).click();
  await expect(page.locator('.sheet-gallery-card')).toHaveCount(2);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBe(true);
});
