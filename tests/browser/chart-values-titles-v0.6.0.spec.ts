import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/** Paste a rectangular TSV block into a worksheet cell (same approach as older specs). */
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

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('group', { name: '工作表标签' })).toBeVisible();
});

test('每个 sheet 的图表标题独立保存，且标题不包含 sheet 名', async ({ page }) => {
  // Default: the page title, with no sheet name appended.
  await expect(page.getByTestId('chart-title')).toHaveText('荧光光谱');
  await expect(page.getByTestId('spectra-chart')).toContainText('荧光光谱');
  await expect(page.getByTestId('spectra-chart')).not.toContainText('原始光谱');

  // Editing the title changes this sheet only.
  await page.getByLabel('图表标题', { exact: true }).fill('CsPbCl3响应图');
  await expect(page.getByTestId('chart-title')).toHaveText('CsPbCl3响应图');
  await expect(page.getByTestId('spectra-chart')).toContainText('CsPbCl3响应图');

  // A new sheet starts from the page default instead of inheriting the title.
  await page.getByRole('button', { name: '新建 sheet', exact: true }).click();
  await expect(sheetTab(page, 'Sheet 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('chart-title')).toHaveText('荧光光谱');
  await page.getByLabel('图表标题', { exact: true }).fill('Sheet 2 响应图');

  const panel = page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
  await paste(
    panel.getByLabel('原始数据第 1 行第 1 列', { exact: true }),
    'nm\tA\tB\n500\t10\t30\n510\t20\t40\n520\t10\t30',
  );
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await expect(page.getByTestId('chart-title')).toHaveText('Sheet 2 响应图');

  // Renaming the sheet does not change its chart title.
  await page.getByRole('button', { name: '重命名标签 Sheet 2', exact: true }).click();
  const renameInput = page.getByLabel('工作表标签名', { exact: true });
  await renameInput.fill('实验组 A');
  await renameInput.press('Enter');
  await expect(page.getByTestId('chart-title')).toHaveText('Sheet 2 响应图');

  // Switching back restores the first sheet's own title.
  await plotTab(page, '原始光谱').click();
  await expect(page.getByTestId('chart-title')).toHaveText('CsPbCl3响应图');

  // "All sheets" keeps each card's h3 as the sheet name while its SVG uses its own title.
  await page.getByRole('button', { name: '全部 sheet', exact: true }).click();
  await expect(page.locator('.sheet-gallery-card')).toHaveCount(2);
  await expect(page.locator('[data-testid="gallery-chart-raw"] h3')).toHaveText('原始光谱');
  await expect(page.locator('[data-testid="gallery-chart-raw-2"] h3')).toHaveText('实验组 A');
  await expect(
    page.locator('[data-testid="gallery-chart-raw"] .sheet-gallery-chart svg'),
  ).toContainText('CsPbCl3响应图');
  await expect(
    page.locator('[data-testid="gallery-chart-raw-2"] .sheet-gallery-chart svg'),
  ).toContainText('Sheet 2 响应图');

  // Per-sheet titles survive a refresh.
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByRole('group', { name: '工作表标签' })).toBeVisible();
  await expect(page.getByTestId('chart-title')).toHaveText('CsPbCl3响应图');
  await plotTab(page, '实验组 A').click();
  await expect(page.getByTestId('chart-title')).toHaveText('Sheet 2 响应图');
});

test('显示数据点数值：当前图、导出 SVG、切换 sheet 与「全部 sheet」都生效并持久化', async ({
  page,
}, testInfo) => {
  await page.getByRole('link', { name: '对象筛选', exact: true }).click();
  await expect(page.getByTestId('chart-title')).toHaveText('分析对象筛选');
  const chart = page.getByTestId('screening-chart'),
    values = chart.locator('[data-point-value]');
  const toggle = page.getByLabel('显示数据点数值', { exact: true });

  // Off by default, including for workspaces saved before v0.6.0.
  await expect(toggle).not.toBeChecked();
  await expect(values).toHaveCount(0);

  await toggle.check();
  await expect(values).toHaveCount(6);
  await expect(chart).toContainText('F/F₀');

  // Exported SVG also carries the point values and the title without a sheet name.
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SVG', exact: true }).click();
  const svgPath = testInfo.outputPath('对象筛选-数据点数值.svg');
  await (await pending).saveAs(svgPath);
  const svg = (await readFile(svgPath)).toString('utf8');
  expect(svg).toContain('data-point-value="true"');
  expect(svg).toContain('分析对象筛选');
  expect(svg).not.toContain('分析对象筛选 · 分析对象');

  // The checkbox state is shared by the page's style, so a new sheet inherits it;
  // the sheet title however starts from the page default again.
  await page.getByRole('button', { name: '新建 sheet', exact: true }).click();
  await expect(page.getByTestId('chart-title')).toHaveText('分析对象筛选');
  await expect(toggle).toBeChecked();
  await page.getByLabel('图表标题', { exact: true }).fill('Sheet 2 筛选图');
  await expect(page.getByTestId('chart-title')).toHaveText('Sheet 2 筛选图');
  await page.getByRole('button', { name: '添加对象', exact: true }).click();
  await page.getByRole('button', { name: '添加对象', exact: true }).click();
  await page.getByLabel('对象名称 1', { exact: true }).fill('Blank');
  await page.getByLabel('对象强度 1', { exact: true }).fill('12000');
  await page.getByLabel('对象名称 2', { exact: true }).fill('Cd2+');
  await page.getByLabel('对象强度 2', { exact: true }).fill('2800');
  await page.getByLabel('空白参考 F₀', { exact: true }).selectOption({ label: 'Blank' });
  await expect(page.getByTestId('screening-chart').locator('[data-point-value]')).toHaveCount(2);

  // Switching back keeps the setting and shows the first sheet's 6 labels.
  await plotTab(page, '分析对象').click();
  await expect(page.getByTestId('chart-title')).toHaveText('分析对象筛选');
  await expect(page.getByTestId('screening-chart').locator('[data-point-value]')).toHaveCount(6);

  // Each gallery card uses its own title, keeps its h3 name and shows values.
  await page.getByRole('button', { name: '全部 sheet', exact: true }).click();
  await expect(page.locator('.sheet-gallery-card')).toHaveCount(2);
  await expect(page.locator('[data-testid="gallery-chart-screening"] h3')).toHaveText('分析对象');
  await expect(page.locator('[data-testid="gallery-chart-screening-2"] h3')).toHaveText('Sheet 2');
  await expect(
    page.locator('[data-testid="gallery-chart-screening"] .sheet-gallery-chart svg'),
  ).toContainText('分析对象筛选');
  await expect(
    page.locator('[data-testid="gallery-chart-screening-2"] .sheet-gallery-chart svg'),
  ).toContainText('Sheet 2 筛选图');
  await expect(page.locator('.sheet-gallery-chart [data-point-value]')).toHaveCount(8);

  await page.getByRole('button', { name: '查看 sheet Sheet 2', exact: true }).click();
  await expect(page.getByTestId('chart-title')).toHaveText('Sheet 2 筛选图');

  // Setting, per-sheet data and per-sheet chart title survive a refresh.
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByTestId('chart-title')).toHaveText('Sheet 2 筛选图');
  await expect(page.getByLabel('显示数据点数值', { exact: true })).toBeChecked();
  await expect(page.getByTestId('screening-chart').locator('[data-point-value]')).toHaveCount(2);
  await plotTab(page, '分析对象').click();
  await expect(page.getByTestId('chart-title')).toHaveText('分析对象筛选');
  await expect(page.getByTestId('screening-chart').locator('[data-point-value]')).toHaveCount(6);
});
