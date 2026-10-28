import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const evidence = path.resolve('docs/验收-多探针猝灭率-2026.10.28');
mkdirSync(evidence, { recursive: true });
const moduleOf = (page: Page) => page.getByTestId('recognition-module');
const view = (page: Page, name: string) => moduleOf(page).getByRole('group', { name: '分析数据视图' }).getByRole('button', { name, exact: true }).click();
const chart = (page: Page, name: string) => moduleOf(page).getByRole('group', { name: '识别分析图形' }).getByRole('button', { name, exact: true }).click();
const cell = (page: Page, r: number, c: number) => moduleOf(page).locator(`[data-cell="${r}:${c}"]`);
async function paste(at: Locator, text: string) {
  await at.evaluate((el, value) => {
    const data = new DataTransfer(); data.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}
async function demo(page: Page) {
  await page.goto('/#recognition');
  await moduleOf(page).getByRole('button', { name: '载入演示数据', exact: true }).click();
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-point]')).toHaveCount(6);
}
async function persisted(page: Page) {
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1') || '{}').recognition?.rows.length)).toBe(6);
}

test('direct decimal / percentage input, real-time recalculation and whole-sheet undo / redo', async ({ page }) => {
  await demo(page);
  const m = moduleOf(page);
  await expect(m.getByRole('group', { name: '分析数据视图' }).getByRole('button', { name: '原始强度', exact: true })).toHaveCount(0);
  await expect(m.getByRole('button', { name: '添加空白批次', exact: true })).toHaveCount(0);
  const input = m.getByLabel('猝灭率 第 1 行第 4 列', { exact: true });
  await expect(input).toHaveValue('0.74');
  await expect(m.getByLabel('猝灭率 第 5 行第 4 列', { exact: true })).toHaveValue('-0.21');
  const before = await page.getByTestId('recognition-scores-chart').locator('[data-point] circle').first().getAttribute('cx');
  await input.fill('70%');
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-point] circle').first()).not.toHaveAttribute('cx', before!);
  await chart(page, '响应热图与树状图');
  await expect(page.getByTestId('recognition-heatmap-chart').locator('[data-heat-row="0"][data-probe-id="probe-1"]')).toHaveAttribute('data-value', '0.7');
  await m.getByLabel('撤销工作表修改', { exact: true }).click(); await expect(input).toHaveValue('0.74');
  await m.getByLabel('重做工作表修改', { exact: true }).click(); await expect(input).toHaveValue('70%');
  await m.locator('.recognition-data').screenshot({ path: path.join(evidence, '猝灭率直接录入-2026.10.28.png') });
});

test('probe renaming, sorting, insertion, deletion and undo preserve stable measurement IDs', async ({ page }) => {
  await demo(page);
  await moduleOf(page).getByLabel('探针名称 1', { exact: true }).fill('探针甲 Fe³⁺');
  await moduleOf(page).getByLabel('下移探针 1', { exact: true }).click();
  await expect(moduleOf(page).getByLabel('探针名称 2', { exact: true })).toHaveValue('探针甲 Fe³⁺');
  await expect(moduleOf(page).getByLabel('猝灭率 第 1 行第 4 列', { exact: true })).toHaveValue('0.19');
  await expect(moduleOf(page).getByLabel('猝灭率 第 1 行第 5 列', { exact: true })).toHaveValue('0.74');
  await moduleOf(page).getByRole('button', { name: '添加探针', exact: true }).click();
  await expect(page.getByTestId('recognition-scores-chart')).toHaveCount(0);
  await expect(moduleOf(page).getByRole('alert')).toContainText('缺失');
  await moduleOf(page).getByLabel('删除探针 4', { exact: true }).click();
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-point]')).toHaveCount(6);
  await moduleOf(page).getByLabel('删除探针 1', { exact: true }).click();
  await expect(moduleOf(page).getByLabel('猝灭率 第 1 行第 4 列', { exact: true })).toHaveValue('0.74');
  await moduleOf(page).getByLabel('撤销工作表修改', { exact: true }).click();
  await expect(moduleOf(page).getByLabel('猝灭率 第 1 行第 4 列', { exact: true })).toHaveValue('0.19');
  await expect(moduleOf(page).getByLabel('猝灭率 第 1 行第 5 列', { exact: true })).toHaveValue('0.74');
});

test('percentage paste, negative responses, explicit invalid cells and no stale chart', async ({ page }) => {
  await demo(page);
  const m = moduleOf(page), input = m.getByLabel('猝灭率 第 1 行第 4 列', { exact: true });
  await paste(input, '74%\t19%\t35%\n71%\t21%\t38%\n17%\t76%\t30%\n20%\t72%\t33%\n-21%\t10%\t78%\n-18%\t13%\t75%');
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-point]')).toHaveCount(6);
  await chart(page, '响应热图与树状图');
  const heatmap = page.getByTestId('recognition-heatmap-chart');
  await expect(heatmap.locator('[data-heat-row="4"][data-probe-id="probe-1"]')).toHaveAttribute('data-value', '-0.21');
  await input.fill('abc');
  await expect(cell(page, 0, 3).locator('input')).toHaveAttribute('aria-invalid', 'true');
  await expect(m.getByRole('alert')).toContainText('猝灭率必须为有限数值');
  await expect(heatmap).toHaveCount(0);
  await m.getByLabel('撤销工作表修改', { exact: true }).click();
  await expect(heatmap).toBeVisible();
  await input.fill('');
  await expect(m.getByRole('alert')).toContainText('空值不能按零处理');
  await expect(heatmap).toHaveCount(0);
  await m.locator('.recognition-data').screenshot({ path: path.join(evidence, '猝灭率无效单元格-2026.10.28.png') });
});

test('multi-Sheet regional paste, refresh, independent replicas and read-only result snapshots', async ({ page }) => {
  await demo(page); await persisted(page);
  const oldSpectra = await page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!).spectra);
  await moduleOf(page).getByLabel('新建 sheet', { exact: true }).click();
  await expect(moduleOf(page).getByRole('group', { name: '工作表标签' }).getByRole('button', { name: 'Sheet 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await view(page, '猝灭率');
  await paste(moduleOf(page).getByLabel('猝灭率 第 1 行第 1 列', { exact: true }),
    'A\tFe³⁺\t1\t0.74\t0.19\t0.35\nA\tFe³⁺\t2\t0.71\t0.21\t0.38\nB\tCO₃²⁻\t1\t0.17\t0.76\t0.30\nB\tCO₃²⁻\t2\t0.20\t0.72\t0.33\nC\tCu²⁺\t1\t-0.21\t0.10\t0.78\nC\tCu²⁺\t2\t-0.18\t0.13\t0.75');
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-point]')).toHaveCount(6);
  await persisted(page); await page.reload();
  await expect(moduleOf(page).getByLabel('猝灭率 第 1 行第 4 列', { exact: true })).toHaveValue('0.74');
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-point]')).toHaveCount(6);
  const coords = await page.getByTestId('recognition-scores-chart').locator('[data-point] title').evaluateAll((els) => els.map((el) => el.textContent!.split('\n').slice(-2)).sort());
  await moduleOf(page).getByLabel('猝灭率 第 1 行第 2 列', { exact: true }).fill('自由输入离子 Al³⁺');
  const next = await page.getByTestId('recognition-scores-chart').locator('[data-point] title').evaluateAll((els) => els.map((el) => el.textContent!.split('\n').slice(-2)).sort());
  expect(next).toEqual(coords);
  await expect(page.getByTestId('recognition-scores-chart')).toContainText('自由输入离子 Al³⁺');
  await view(page, 'PCA得分');
  const firstScore = await cell(page, 0, 3).innerText();
  await moduleOf(page).getByRole('button', { name: '保存当前结果到新 Sheet', exact: true }).click();
  await expect(moduleOf(page)).toContainText('结果快照'); await expect(cell(page, 0, 3)).toContainText(firstScore);
  await expect(cell(page, 0, 3)).toHaveAttribute('aria-readonly', 'true');
  await moduleOf(page).getByRole('button', { name: '返回来源 Sheet', exact: true }).click();
  await moduleOf(page).getByLabel('猝灭率 第 1 行第 4 列', { exact: true }).fill('0.5');
  await moduleOf(page).getByRole('group', { name: '工作表标签' }).getByRole('button', { name: /^PCA得分-/ }).click();
  await expect(moduleOf(page)).toContainText('来源数据已改变');
  await expect(cell(page, 0, 3)).toContainText(firstScore);
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!).spectra)).toEqual(oldSpectra);
});

test('legacy intensity sheets convert once and preserve their original measurements in Excel', async ({ page }, info) => {
  await demo(page); await persisted(page);
  await page.evaluate(() => {
    const w = JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!), d = w.recognition;
    delete d.inputMode;
    d.batches = [{ id: 'old-batch', name: '旧批次', values: Object.fromEntries(d.probes.map((p: { id: string }) => [p.id, '1000'])) }];
    const f = [[260, 810, 650], [290, 790, 620], [830, 240, 700], [800, 280, 670], [1210, 900, 220], [1180, 870, 250]];
    d.rows.forEach((row: { batchId: string; values: Record<string, string> }, i: number) => {
      row.batchId = 'old-batch';
      row.values = Object.fromEntries(d.probes.map((p: { id: string }, j: number) => [p.id, String(f[i][j])]));
    });
    localStorage.setItem('perovskite-lab-workspace-v1', JSON.stringify(w));
  });
  await page.reload();
  const m = moduleOf(page), input = m.getByLabel('猝灭率 第 1 行第 4 列', { exact: true });
  await expect(input).toHaveValue('0.74');
  await expect(m).toContainText('旧强度数据已换算为猝灭率');
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-point]')).toHaveCount(6);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!).recognition.inputMode)).toBe('q');
  await page.reload(); await expect(input).toHaveValue('0.74');
  await input.fill('50%');
  const event = page.waitForEvent('download');
  await m.getByRole('button', { name: '导出分析 Excel', exact: true }).click();
  const download = await event, dest = info.outputPath(download.suggestedFilename()); await download.saveAs(dest);
  const wb = XLSX.read(readFileSync(dest), { type: 'buffer' });
  const q = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['猝灭率'], { header: 1 });
  const original = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['历史原始强度'], { header: 1 });
  const blanks = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['历史空白与批次'], { header: 1 });
  expect(q[1].slice(3, 5)).toEqual([0.5, 50]);
  expect(original[1].slice(6)).toEqual([260, 810, 650]);
  expect(blanks[1].slice(2)).toEqual([1000, 1000, 1000]);
});

test('Excel and SVG / PNG export match the visible analysis, full precision, Chinese and ion glyphs', async ({ page }, info) => {
  await demo(page);
  await moduleOf(page).getByLabel('探针名称 1', { exact: true }).fill('探针甲 Fe³⁺');
  await moduleOf(page).getByLabel('聚类数量', { exact: true }).fill('3');
  await view(page, 'PCA得分');
  const score = Number((await cell(page, 0, 3).innerText()).trim());
  const excelEvent = page.waitForEvent('download');
  await moduleOf(page).getByRole('button', { name: '导出分析 Excel', exact: true }).click();
  const excel = await excelEvent, excelPath = path.join(evidence, excel.suggestedFilename()); await excel.saveAs(excelPath);
  expect(excel.suggestedFilename()).toMatch(/v0\.9\.0-\d{4}\.\d{1,2}\.\d{1,2}\.xlsx$/);
  const wb = XLSX.read(readFileSync(excelPath), { type: 'buffer' });
  expect(wb.SheetNames).toEqual(['猝灭率', 'PCA得分', 'PCA载荷', '方差解释率', '聚类结果', 'Ward合并', '分析设置']);
  const q = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['猝灭率'], { header: 1 });
  expect(q[1].slice(3, 5)).toEqual([0.74, 74]); expect(q[5].slice(3, 5)).toEqual([-0.21, -21]);
  const scores = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['PCA得分'], { header: 1 });
  expect(scores).toHaveLength(7); expect(scores[1][3]).toBeCloseTo(score, 4);
  await moduleOf(page).getByLabel('预处理方式', { exact: true }).selectOption('center');
  await chart(page, 'PCA 得分图');
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-axis="bottom"]')).toContainText('66.01%');
  await moduleOf(page).getByLabel('横轴主成分', { exact: true }).selectOption('2');
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-axis="bottom"]')).toContainText('PC3 (0.03%)');
  await moduleOf(page).getByLabel('横轴主成分', { exact: true }).selectOption('0');
  const plots = [['PCA 得分图', 'scores'], ['PCA 载荷图', 'loadings'], ['层次聚类树状图', 'tree'], ['响应热图与树状图', 'heatmap']];
  for (const [label, id] of plots) {
    await chart(page, label);
    const root = page.getByTestId(`recognition-${id}-chart`);
    await expect(root.locator('svg')).toBeVisible();
    if (id === 'heatmap') {
      await expect(root.locator('[data-heat-row]')).toHaveCount(18);
      const first = await root.locator('[data-heat-row]').first().getAttribute('data-heat-row');
      const labels = await root.locator('[data-row-label]').evaluateAll((els) => els.map((el) => el.getAttribute('data-row-label')));
      expect(first).toBe(labels[0]);
      await moduleOf(page).getByLabel('热图数值', { exact: true }).selectOption('zscore');
      await expect(root).toContainText('Z-score');
      await moduleOf(page).getByLabel('热图数值', { exact: true }).selectOption('q');
    }
    await moduleOf(page).locator('.chart-layout').screenshot({ path: path.join(evidence, `${label}-页面-2026.10.28.png`) });
    for (const format of ['SVG', 'PNG']) {
      const event = page.waitForEvent('download');
      await moduleOf(page).locator('.chart-footer').getByRole('button', { name: format, exact: true }).click();
      const download = await event, dest = format === 'SVG' ? info.outputPath(download.suggestedFilename()) : path.join(evidence, download.suggestedFilename()); await download.saveAs(dest);
      const bytes = readFileSync(dest);
      if (format === 'SVG') { expect(bytes.toString().includes('@font-face')).toBe(true); expect(bytes.toString().includes('³⁺')).toBe(true); }
      else { expect(bytes.subarray(1, 4).toString()).toBe('PNG'); expect(bytes.readUInt32BE(16)).toBeGreaterThan(1000); }
    }
  }
});

test('rank one and zero variance are explicit, colors do not change coordinates, mobile layout works', async ({ page }) => {
  await demo(page);
  const before = await page.getByTestId('recognition-scores-chart').locator('[data-point] circle').evaluateAll((els) => els.map((el) => [el.getAttribute('cx'), el.getAttribute('cy')]));
  await moduleOf(page).getByLabel('离子颜色 Fe³⁺', { exact: true }).fill('#a12233');
  expect(await page.getByTestId('recognition-scores-chart').locator('[data-point] circle').evaluateAll((els) => els.map((el) => [el.getAttribute('cx'), el.getAttribute('cy')]))).toEqual(before);
  await moduleOf(page).getByLabel('样本点形状', { exact: true }).selectOption('triangle');
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-point] polygon')).toHaveCount(6);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: path.join(evidence, '多探针识别-手机端-2026.10.28.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await moduleOf(page).getByLabel('删除探针 3', { exact: true }).click();
  await paste(moduleOf(page).getByLabel('猝灭率 第 1 行第 4 列', { exact: true }), '0.1\t0.2\n0.2\t0.4\n0.3\t0.6\n0.4\t0.8\n0.5\t1\n0.6\t1.2');
  await expect(moduleOf(page)).toContainText('仅有 1 个有效主成分');
  await expect(page.getByTestId('recognition-scores-chart')).toHaveCount(0);
  await chart(page, '层次聚类树状图'); await expect(page.getByTestId('recognition-tree-chart')).toBeVisible();
  await paste(moduleOf(page).getByLabel('猝灭率 第 1 行第 4 列', { exact: true }), '0.1\t0.2\n0.1\t0.4\n0.1\t0.6\n0.1\t0.8\n0.1\t1\n0.1\t1.2');
  await expect(moduleOf(page).getByRole('alert')).toContainText('零方差');
  await expect(page.getByTestId('recognition-tree-chart')).toHaveCount(0);
});

test('probe selection, cut height, chart styles and four color settings persist independently', async ({ page }) => {
  await demo(page);
  const m = moduleOf(page);
  await m.getByLabel('聚类截断方式', { exact: true }).selectOption('height');
  await m.getByLabel('截断高度', { exact: true }).fill('0.5');
  await m.getByLabel('选择探针 3', { exact: true }).uncheck();
  await expect(m).toContainText('2 个探针');
  await m.getByLabel('选择探针 3', { exact: true }).check();
  await m.getByLabel('离子颜色 Fe³⁺', { exact: true }).fill('#112233');
  await m.getByLabel('探针颜色 1', { exact: true }).fill('#224466');
  await m.getByLabel('聚类颜色 1', { exact: true }).fill('#336699');
  await m.getByLabel('热图负值颜色', { exact: true }).fill('#557799');
  await m.getByLabel('图表标题', { exact: true }).fill('多探针 PCA Fe³⁺');
  await m.getByLabel('字体', { exact: true }).selectOption('Times New Roman');
  await m.locator('.style-panel').getByRole('button', { name: '坐标', exact: true }).click();
  await m.getByLabel('下轴名称', { exact: true }).fill('第一方向');
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-axis="bottom"]')).toContainText('第一方向 PC1 (67.45%)');
  await m.locator('.style-panel').getByRole('button', { name: '导出', exact: true }).click();
  await m.getByLabel('图宽 / cm', { exact: true }).fill('12');
  await chart(page, '层次聚类树状图');
  await expect(page.getByTestId('recognition-tree-chart').locator('line[stroke-dasharray]')).toHaveCount(1);
  await chart(page, 'PCA 得分图');
  await page.waitForTimeout(650); await page.reload();
  await expect(m.getByLabel('截断高度', { exact: true })).toHaveValue('0.5');
  await expect(m.getByLabel('离子颜色 Fe³⁺', { exact: true })).toHaveValue('#112233');
  await expect(m.getByLabel('探针颜色 1', { exact: true })).toHaveValue('#224466');
  await expect(m.getByLabel('聚类颜色 1', { exact: true })).toHaveValue('#336699');
  await expect(m.getByLabel('热图负值颜色', { exact: true })).toHaveValue('#557799');
  await expect(page.getByTestId('recognition-scores-chart')).toContainText('多探针 PCA Fe³⁺');
  await expect(page.getByTestId('recognition-scores-chart').locator('svg')).toHaveAttribute('font-family', /Times New Roman/);
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-axis="bottom"]')).toContainText('第一方向 PC1 (67.45%)');
});
