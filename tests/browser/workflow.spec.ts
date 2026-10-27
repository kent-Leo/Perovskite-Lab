import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '光谱工作台', exact: true })).toBeVisible();
});
test('optional browser tool contract updates the visible gradient and rejects invalid input', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registry = new Map<string, { execute: (input: unknown) => unknown }>();
    const host = window as unknown as { labTools: typeof registry };
    host.labTools = registry;
    Object.defineProperty(document, 'modelContext', {
      value: {
        registerTool(
          tool: { name: string; execute: (input: unknown) => unknown },
          options: { signal: AbortSignal },
        ) {
          registry.set(tool.name, tool);
          options.signal.addEventListener('abort', () => registry.delete(tool.name), {
            once: true,
          });
        },
      },
    });
  });
  await page.reload();
  const summary = await page.evaluate(() =>
    (window as any).labTools.get('lab_read_workspace_summary').execute({}),
  );
  expect(summary.spectra).toHaveLength(6);
  const plan = await page.evaluate(() =>
    (window as any).labTools
      .get('lab_configure_concentration_gradient')
      .execute({ stock: 100, volumeML: 10, fixedML: 1, targets: [0, 1], unit: 'μM' }),
  );
  expect(plan.plan[1].solventML).toBe(8.9);
  const error = await page.evaluate(() => {
    try {
      (window as any).labTools
        .get('lab_configure_concentration_gradient')
        .execute({ stock: 100, volumeML: 10, fixedML: 1, targets: [200], unit: 'μM' });
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  });
  expect(error).toContain('目标浓度');
  await page.getByRole('link', { name: '浓度梯度', exact: true }).click();
  await expect(page.getByLabel('固定添加体积 / mL', { exact: true })).toHaveValue('1');
  await expect(page.locator('tbody tr')).toHaveCount(2);
});
test('spectra, editing, normalization and three exports', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(6);
  await page.screenshot({ path: info.outputPath('desktop-2026.10.1.png'), fullPage: true });
  await page.getByRole('button', { name: '单条光谱', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(1);
  await page.getByLabel('归一化', { exact: true }).check();
  await expect(page.getByTestId('spectra-chart')).toContainText('Normalized intensity');
  await page.getByLabel('图表标题', { exact: true }).fill('荧光光谱验证');
  for (const format of ['SVG', 'PNG', 'PDF']) {
    const d = page.waitForEvent('download');
    await page.getByRole('button', { name: format, exact: true }).click();
    const file = await d;
    const path = info.outputPath(`光谱导出-2026.10.1.${format.toLowerCase()}`);
    await file.saveAs(path);
    const bytes = await readFile(path);
    expect(file.suggestedFilename()).toMatch(/-\d{4}\.\d{1,2}\.\d{1,2}\./);
    if (format === 'PDF') {
      expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getPage(0).getWidth()).toBeCloseTo((16 / 2.54) * 72);
    } else if (format === 'PNG') {
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect(bytes.readUInt32BE(16)).toBe(Math.round((16 / 2.54) * 300));
      const i = bytes.indexOf('pHYs');
      expect(i).toBeGreaterThan(0);
      expect(bytes.readUInt32BE(i + 4)).toBe(Math.round(300 / 0.0254));
    } else expect(bytes.toString()).toContain('荧光光谱验证');
  }
  expect(errors).toEqual([]);
});
test('CSV mapping, peak metrics, export and local persistence', async ({ page }, info) => {
  await page.getByLabel('选择数据文件').setInputFiles({
    name: '多光谱-2026.10.1.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('nm,Blank,My target\n500,100,50\n510,200,100\n520,100,50\nbad,1,2\n'),
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('.column-choices').getByLabel('My target', { exact: true }).check();
  await expect(dialog).toContainText('将跳过 1 个无效记录');
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await expect(page.locator('.workspace-status')).not.toContainText('示例工作区');

  await page.getByLabel('激发波长 / nm', { exact: true }).fill('450');
  const metrics = page.locator('.peak-panel .metric');
  await expect(metrics.nth(0)).toContainText('510');
  await expect(metrics.nth(1)).toContainText('200');
  await expect(metrics.nth(2)).toContainText('20');
  await expect(metrics.nth(3)).toContainText('60');
  await expect(metrics.nth(4)).toContainText('3000');
  await expect(page.locator('.peak-panel')).toContainText('积分区间 500–520 nm');

  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出峰指标', exact: true }).click();
  const file = await downloaded;
  const path = info.outputPath('峰特性指标-2026.10.22.xlsx');
  await file.saveAs(path);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    XLSX.read(await readFile(path)).Sheets.Data,
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    光谱: 'Blank',
    峰位_nm: 510,
    峰强度_a_u: 200,
    半高宽_nm: 20,
    斯托克斯位移_nm: 60,
    峰面积_a_u_nm: 3000,
  });

  await page.waitForTimeout(650);
  await page.reload();
  await expect(page.getByLabel('激发波长 / nm', { exact: true })).toHaveValue('450');
  await expect(page.locator('.peak-panel .metric').nth(3)).toContainText('60');
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
});
test('two-column object CSV maps automatically and provides a downloadable format example', async ({
  page,
}) => {
  await page.getByRole('link', { name: '对象筛选', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入表格', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: '两列筛选-2026.10.1.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('名称,强度\nBlank,12000\nCd2+,2800\n'),
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('浓度列', { exact: true })).toHaveValue('-1');
  await expect(dialog.getByLabel('荧光强度列', { exact: true })).toHaveValue('1');
  await expect(dialog).toContainText('可导入 2 行数据');
  await dialog.getByText('查看 CSV 格式与下载模板', { exact: true }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '下载当前布局 CSV 模板' }).click();
  expect((await download).suggestedFilename()).toMatch(
    /对象筛选模板-v0\.9\.1-\d{4}\.\d{1,2}\.\d{1,2}\.csv/,
  );
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByLabel('对象名称 2', { exact: true })).toHaveValue('Cd2+');
  await page.getByLabel('响应方式', { exact: true }).selectOption('F');
  await expect(page.getByTestId('screening-chart')).toContainText('Cd2+');
});
test('instrument CSV detects data after notes and blank rows', async ({ page }, info) => {
  await page.getByLabel('选择数据文件').setInputFiles({
    name: '仪器数据-2026.10.1.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Instrument,metadata\n\n波长;强度\n500;1\n510;2\n520;1\n'),
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('起始行', { exact: true })).toHaveValue('3');
  await expect(dialog).toContainText('可导入 1 条光谱');
  await dialog.getByText('查看 CSV 格式与下载模板', { exact: true }).click();
  await page.screenshot({ path: info.outputPath('CSV导入预览-2026.10.1.png'), fullPage: true });
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(1);
});
test('one-column parsing explains how to fix the separator', async ({ page }) => {
  await page.getByLabel('选择数据文件').setInputFiles({
    name: '分号数据-2026.10.1.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Wavelength;Intensity\n500;1\n501;2\n'),
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('分隔符', { exact: true }).selectOption(',');
  await expect(dialog.getByRole('alert')).toContainText('只识别到 1 列');
  await expect(dialog.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
  await dialog.getByLabel('分隔符', { exact: true }).selectOption(';');
  await expect(dialog).toContainText('可导入 1 条光谱');
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(1);
});
test('XLSX sheet selection and headerless TXT queue', async ({ page }) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['nm', 'F'],
      [500, 1],
      [510, 2],
    ]),
    'Sheet one',
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['nm', 'Second'],
      [500, 3],
      [510, 4],
    ]),
    '选择工作表',
  );
  await page.getByLabel('选择数据文件').setInputFiles([
    {
      name: '实验-2026.10.1.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }),
    },
    {
      name: '光谱-2026.10.1.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('500 8\n510 10\n520 8'),
    },
  ]);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('工作表', { exact: true }).selectOption('1');
  await dialog.getByRole('button', { name: '确认导入并继续' }).click();
  await expect(dialog).toContainText('光谱-2026.10.1.txt');
  await expect(dialog.getByLabel('起始行包含列名', { exact: true })).not.toBeChecked();
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await expect(page.getByTestId('spectra-chart')).toContainText('Second');
});
test('custom objects, baseline guards and gradient Excel', async ({ page }, info) => {
  await page.getByRole('link', { name: '对象筛选', exact: true }).click();
  await page.getByLabel('对象名称 5', { exact: true }).fill('Cd²⁺ + 河水');
  await expect(page.getByTestId('screening-chart')).toContainText('Cd²⁺ + 河水');
  await page.getByLabel('空白参考 F₀', { exact: true }).selectOption('');
  await expect(page.getByRole('alert')).toContainText('请指定');
  await page.getByLabel('响应方式', { exact: true }).selectOption('F');
  await expect(page.getByTestId('screening-chart')).toBeVisible();
  await page.screenshot({ path: info.outputPath('screening-2026.10.1.png'), fullPage: true });
  await page.getByRole('link', { name: '浓度梯度', exact: true }).click();
  await page.getByLabel('固定添加体积 / mL', { exact: true }).fill('1');
  await expect(page.locator('tbody tr').nth(3)).toContainText('8.9');
  const d = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const file = await d;
  await file.saveAs(info.outputPath('梯度-2026.10.1.xlsx'));
  const b = await readFile(info.outputPath('梯度-2026.10.1.xlsx'));
  const sheet = XLSX.read(b).Sheets.Data;
  expect(XLSX.utils.sheet_to_json(sheet)).toHaveLength(7);
  await page.getByLabel('目标浓度', { exact: true }).fill('200');
  await expect(page.getByRole('alert')).toContainText('目标浓度应在');
});
test('calibration range, negative slope LOD, units and invalid inputs', async ({ page }, info) => {
  await page.getByRole('link', { name: '校准与检出限', exact: true }).click();
  await page.getByLabel('响应方式', { exact: true }).selectOption('F');
  await expect(page.locator('.lod-results')).toBeVisible();
  await page.getByLabel('σ 来源', { exact: true }).selectOption('manual');
  await page.getByLabel('标准差 σ', { exact: false }).fill('20');
  await expect(page.locator('.lod-results')).toContainText('0.062');
  await page.getByLabel('拟合上限', { exact: true }).fill('2');
  await expect(page.getByTestId('calibration-chart').locator('circle')).toHaveCount(3);
  await page.getByLabel('浓度单位', { exact: true }).selectOption('nmol/L');
  await expect(page.getByLabel('校准浓度 2', { exact: true })).toHaveValue('1000');
  await expect(page.getByLabel('拟合上限', { exact: true })).toHaveValue('2000');
  await page.screenshot({ path: info.outputPath('calibration-2026.10.1.png'), fullPage: true });
  await page.getByLabel('标准差 σ', { exact: false }).fill('0');
  await expect(page.getByRole('alert')).toContainText('σ 必须大于 0');
});
test('mobile layouts expose navigation and stay within the viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '打开导航', exact: true })).toBeVisible();
  for (const name of ['光谱工作台', '对象筛选', '校准与检出限', '浓度梯度']) {
    if (name !== '光谱工作台') {
      await page.getByRole('button', { name: '打开导航', exact: true }).click();
      await page.getByRole('link', { name, exact: true }).click();
    }
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`${name}-mobile-2026.10.1.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});
