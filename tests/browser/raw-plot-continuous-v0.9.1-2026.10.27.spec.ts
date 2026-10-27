import { test, expect, type Locator } from '@playwright/test';

async function paste(cell: Locator, value: string) {
  await cell.evaluate((el, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  }, value);
}

test('raw header name, comment and color drive the chart legend while checkboxes control visibility', async ({
  page,
}) => {
  await page.goto('/');
  const raw = page.getByRole('region', { name: '粘贴原始光谱数据', exact: true });
  const chart = page.getByTestId('spectra-chart');
  await paste(
    page.getByLabel('原始数据第 1 行第 1 列', { exact: true }),
    'nm\tA\tB\n500\t10\t30\n510\t20\t40\n520\t10\t30',
  );
  await raw.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(chart.locator('polyline')).toHaveCount(2);

  // The column name feeds the legend and the color row feeds the curve.
  await page.getByLabel('原始光谱 第 2 列名称', { exact: true }).fill('自定义光谱 A');
  await page.getByLabel('原始光谱 第 2 列颜色', { exact: true }).fill('#ff0000');
  await expect(chart).toContainText('自定义光谱 A');
  await expect(chart.locator('polyline').first()).toHaveAttribute('stroke', '#ff0000');

  // 备注 has priority over the column name, and clearing it falls back.
  await page.getByLabel('原始光谱 第 2 列备注', { exact: true }).fill('Cd²⁺ 河水');
  await expect(chart).toContainText('Cd²⁺ 河水');
  await expect(chart).not.toContainText('自定义光谱 A');
  await page.getByLabel('原始光谱 第 2 列备注', { exact: true }).fill('');
  await expect(chart).toContainText('自定义光谱 A');

  // Intensity checkboxes update the visible curves without replotting.
  const original = await chart.locator('polyline').first().getAttribute('points');
  await raw.getByLabel('第 3 列作为强度', { exact: true }).uncheck();
  await expect(chart.locator('polyline')).toHaveCount(1);
  await raw.getByLabel('第 3 列作为强度', { exact: true }).check();
  await expect(chart.locator('polyline')).toHaveCount(2);

  // Replotting keeps the header name and color and refreshes the points.
  await raw.getByLabel('原始数据第 3 行第 2 列', { exact: true }).fill('35');
  await raw.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(chart.locator('polyline')).toHaveCount(2);
  await expect(chart).toContainText('自定义光谱 A');
  await expect(chart.locator('polyline').first()).not.toHaveAttribute('points', original!);
  await expect(chart.locator('polyline').first()).toHaveAttribute('stroke', '#ff0000');

  // Column selection and header metadata survive a reload.
  await raw.getByLabel('第 3 列作为强度', { exact: true }).uncheck();
  await page.waitForTimeout(650);
  await page.reload();
  await expect(chart.locator('polyline')).toHaveCount(1);
  await expect(chart).toContainText('自定义光谱 A');
  await expect(page.getByLabel('原始光谱 第 2 列颜色', { exact: true })).toHaveValue('#ff0000');
});

test('large raw tables scroll and select continuously beyond row 20', async ({ page }, info) => {
  await page.goto('/');
  const raw = page.getByLabel('光谱工作台 原始光谱 工作表', { exact: true });
  await paste(
    page.getByLabel('原始数据第 1 行第 1 列', { exact: true }),
    'nm\tLong spectrum\n' + Array.from({ length: 1000 }, (_, i) => `${400 + i}\t${1000 - i}`).join('\n'),
  );
  await expect(raw.getByRole('button', { name: '下一页', exact: true })).toHaveCount(0);
  await expect(raw.locator('tbody tr')).toHaveCount(1001);
  await raw.locator('.worksheet-scroll').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByLabel('原始数据第 1001 行第 2 列', { exact: true })).toBeVisible();
  await page.getByLabel('原始数据第 1001 行第 2 列', { exact: true }).fill('2');
  await raw.getByRole('button', { name: '撤销工作表修改', exact: true }).click();
  await expect(page.getByLabel('原始数据第 1001 行第 2 列', { exact: true })).toHaveValue('1');
  const a20 = page.getByLabel('原始数据第 20 行第 1 列', { exact: true });
  await a20.focus();
  await a20.press('Shift+ArrowDown');
  await expect(raw.getByLabel('工作表当前选区')).toHaveText('A20:A21');
  await raw.screenshot({ path: info.outputPath('连续工作表-2026.10.21.png') });
});

test('new blank workspace and demo reset replace the current raw plot', async ({ page }) => {
  await page.goto('/');
  await paste(page.getByLabel('原始数据第 1 行第 1 列', { exact: true }), '500\t10\n510\t20');
  await page.getByRole('button', { name: '根据表格绘图', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(1);
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '新建空白工作区', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(0);
  await page.getByRole('button', { name: '载入示例', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(6);
});
