import { test, expect, type Locator } from '@playwright/test';

async function paste(cell: Locator, text: string) {
  await cell.evaluate((input, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('pasted Excel data draws multiple spectra and edits update the same batch', async ({
  page,
}, info) => {
  const panel = page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
  await paste(
    panel.getByLabel('原始数据第 1 行第 1 列', { exact: true }),
    '波长\t空白\tCd²⁺ + 河水\r\n500\t100\t50\r\n510\t200\t100\r\n520\t100\t50',
  );
  await expect(panel).toContainText('可绘制 2 条光谱 · 6 个数据点');
  await expect(panel.getByLabel('起始行包含列名', { exact: true })).toBeChecked();
  await page.screenshot({
    path: info.outputPath('粘贴表格-2026.10.18.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await expect(page.getByTestId('spectra-chart')).toContainText('Cd²⁺ + 河水');
  await page.getByLabel('样品角色 2', { exact: true }).selectOption('target');
  await panel.getByLabel('原始数据第 3 行第 3 列', { exact: true }).fill('120');
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await expect(page.getByLabel('样品角色 2', { exact: true })).toHaveValue('target');
  await page.screenshot({
    path: info.outputPath('粘贴绘图预览-2026.10.18.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.waitForTimeout(650);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1') || '{}'),
  );
  expect(saved.spectra[1].points[1]).toEqual({ x: 510, y: 120 });
  await page.reload();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await expect(page.getByLabel('样品名称 2', { exact: true })).toHaveValue('Cd²⁺ + 河水');
});

test('headerless single spectrum and invalid corrections preserve the current chart', async ({
  page,
}) => {
  const panel = page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
  await paste(
    panel.getByLabel('原始数据第 1 行第 1 列', { exact: true }),
    '500,10\n510,bad\n520,15',
  );
  await expect(panel.getByRole('alert')).toContainText('无效记录');
  await expect(panel.getByLabel('原始数据第 2 行第 2 列', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(panel.getByRole('button', { name: '根据表格绘图', exact: true })).toBeDisabled();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(6);
  await panel.getByLabel('原始数据第 2 行第 2 列', { exact: true }).fill('20');
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(1);
  await panel.getByLabel('原始数据第 3 行第 1 列', { exact: true }).fill('510');
  await expect(panel.getByRole('alert')).toContainText('重复波长');
  await expect(panel.getByRole('button', { name: '根据表格绘图', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: '清空表格', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(1);
  await expect(panel.getByLabel('原始数据第 1 行第 1 列', { exact: true })).toHaveValue('');
});

test('pasting at an offset, continuous scrolling and column selection remain usable on mobile', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
  const text =
    'A\tWavelength\tB\n' +
    Array.from({ length: 25 }, (_, i) => `${i + 10}\t${500 + i}\t${i + 20}`).join('\n');
  await paste(panel.getByLabel('原始数据第 2 行第 1 列', { exact: true }), text);
  await expect(panel.getByLabel('粘贴数据起始行', { exact: true })).toHaveValue('2');
  await expect(panel.getByLabel('粘贴数据波长列', { exact: true })).toHaveValue('1');
  await expect(panel).toContainText('可绘制 2 条光谱 · 50 个数据点');
  await expect(panel.getByRole('button', { name: '下一页', exact: true })).toHaveCount(0);
  await expect(panel.getByLabel('原始数据第 27 行第 2 列', { exact: true })).toHaveValue('524');
  await panel.getByLabel('第 3 列作为强度', { exact: true }).uncheck();
  await expect(panel).toContainText('可绘制 1 条光谱 · 25 个数据点');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: info.outputPath('手机粘贴表格-2026.10.18.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(1);
});

test('manual cell entry plots only the current raw table and preserves imported sample metadata', async ({
  page,
}) => {
  await page.getByLabel('选择数据文件').setInputFiles({
    name: '保留光谱-2026.10.18.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('nm,Original\n500,100\n510,200'),
  });
  await page.getByRole('dialog').getByRole('button', { name: '确认导入', exact: true }).click();
  const panel = page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
  for (const [row, values] of [
    ['500', '1'],
    ['510', '2'],
  ].entries()) {
    for (const [col, value] of values.entries())
      await panel
        .getByLabel(`原始数据第 ${row + 1} 行第 ${col + 1} 列`, { exact: true })
        .fill(value);
  }
  await panel.getByRole('button', { name: '添加强度列', exact: true }).click();
  await expect(panel.getByLabel('原始数据第 1 行第 4 列', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(1);
  await panel.getByLabel('原始数据第 2 行第 2 列', { exact: true }).fill('3');
  await panel.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(1);
  await expect(page.getByLabel('样品名称 1', { exact: true })).toHaveValue('Original');
});
