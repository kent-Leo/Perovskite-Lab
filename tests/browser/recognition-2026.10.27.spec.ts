import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const evidence = path.resolve('docs/验收-v0.9.0-2026.10.27');
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

test('quenching formula, real-time recalculation, raw preservation and whole-sheet undo / redo', async ({ page }) => {
  await demo(page);
  await view(page, '猝灭率');
  await expect(cell(page, 0, 3)).toContainText('0.7400'); await expect(cell(page, 0, 4)).toContainText('74.0000%');
  await expect(cell(page, 4, 3)).toContainText('-0.2100'); await expect(cell(page, 4, 4)).toContainText('-21.0000%');
  await view(page, '原始强度');
  const input = moduleOf(page).getByLabel('原始强度 第 1 行第 5 列', { exact: true });
  const before = await page.getByTestId('recognition-scores-chart').locator('[data-point] circle').first().getAttribute('cx');
  await input.fill('300');
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-point] circle').first()).not.toHaveAttribute('cx', before!);
  await view(page, '猝灭率'); await expect(cell(page, 0, 3)).toContainText('0.7000');
  await view(page, '原始强度');
  await moduleOf(page).getByLabel('撤销工作表修改', { exact: true }).click(); await expect(input).toHaveValue('260');
  await moduleOf(page).getByLabel('重做工作表修改', { exact: true }).click(); await expect(input).toHaveValue('300');
  await expect(moduleOf(page).getByLabel('原始强度 第 5 行第 5 列', { exact: true })).toHaveValue('1210');
  await view(page, '猝灭率');
  await moduleOf(page).locator('.recognition-data').screenshot({ path: path.join(evidence, '猝灭率与负值-2026.10.27.png') });
});

test('probe renaming, sorting, insertion, deletion and undo preserve stable measurement IDs', async ({ page }) => {
  await demo(page);
  await moduleOf(page).getByLabel('探针名称 1', { exact: true }).fill('探针甲 Fe³⁺');
  await moduleOf(page).getByLabel('下移探针 1', { exact: true }).click();
  await expect(moduleOf(page).getByLabel('探针名称 2', { exact: true })).toHaveValue('探针甲 Fe³⁺');
  await expect(moduleOf(page).getByLabel('原始强度 第 1 行第 5 列', { exact: true })).toHaveValue('810');
  await expect(moduleOf(page).getByLabel('原始强度 第 1 行第 6 列', { exact: true })).toHaveValue('260');
  await moduleOf(page).getByRole('button', { name: '添加探针', exact: true }).click();
  await expect(page.getByTestId('recognition-scores-chart')).toHaveCount(0);
  await expect(moduleOf(page).getByRole('alert')).toContainText('缺失');
  await moduleOf(page).getByLabel('删除探针 4', { exact: true }).click();
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-point]')).toHaveCount(6);
  await moduleOf(page).getByLabel('删除探针 1', { exact: true }).click();
  await expect(moduleOf(page).getByLabel('原始强度 第 1 行第 5 列', { exact: true })).toHaveValue('260');
  await moduleOf(page).getByLabel('撤销工作表修改', { exact: true }).click();
  await expect(moduleOf(page).getByLabel('原始强度 第 1 行第 5 列', { exact: true })).toHaveValue('810');
  await expect(moduleOf(page).getByLabel('原始强度 第 1 行第 6 列', { exact: true })).toHaveValue('260');
});

test('batch-specific blanks, free ion labels, paste, explicit invalid cells and no stale chart', async ({ page }) => {
  await demo(page);
  await moduleOf(page).getByRole('button', { name: '添加空白批次', exact: true }).click();
  await paste(moduleOf(page).getByLabel('空白与批次 第 2 行第 1 列', { exact: true }), '第二批\t2000\t1000\t1000');
  await view(page, '原始强度');
  await moduleOf(page).getByLabel('原始强度 第 1 行第 4 列', { exact: true }).selectOption({ label: '第二批' });
  await view(page, '猝灭率'); await expect(cell(page, 0, 3)).toContainText('0.8700');
  await view(page, '空白与批次');
  await moduleOf(page).getByLabel('空白与批次 第 2 行第 2 列', { exact: true }).fill('0');
  await expect(moduleOf(page).getByRole('alert')).toContainText('F₀ 必须为有限正数');
  await expect(page.getByTestId('recognition-scores-chart')).toHaveCount(0);
  await moduleOf(page).getByLabel('撤销工作表修改', { exact: true }).click();
  await expect(page.getByTestId('recognition-scores-chart')).toBeVisible();
  await view(page, '原始强度');
  await moduleOf(page).getByLabel('原始强度 第 1 行第 5 列', { exact: true }).fill('abc');
  await expect(cell(page, 0, 4).locator('input')).toHaveAttribute('aria-invalid', 'true');
  await expect(moduleOf(page).getByRole('alert')).toContainText('F 必须为有限数值');
  await expect(page.getByTestId('recognition-scores-chart')).toHaveCount(0);
  await moduleOf(page).getByLabel('原始强度 第 1 行第 5 列', { exact: true }).fill('');
  await expect(moduleOf(page).getByRole('alert')).toContainText('空值不能按零处理');
  await moduleOf(page).locator('.recognition-data').screenshot({ path: path.join(evidence, '无效单元格定位-2026.10.27.png') });
});

test('multi-Sheet regional paste, refresh, independent replicas and read-only result snapshots', async ({ page }) => {
  await demo(page); await persisted(page);
  const oldSpectra = await page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!).spectra);
  await moduleOf(page).getByLabel('新建 sheet', { exact: true }).click();
  await expect(moduleOf(page).getByRole('group', { name: '工作表标签' }).getByRole('button', { name: 'Sheet 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await view(page, '空白与批次');
  await paste(moduleOf(page).getByLabel('空白与批次 第 1 行第 1 列', { exact: true }), '批次甲\t1000\t1000\t1000');
  await view(page, '原始强度');
  await paste(moduleOf(page).getByLabel('原始强度 第 1 行第 1 列', { exact: true }),
    'A\tFe³⁺\t1\t批次甲\t260\t810\t650\nA\tFe³⁺\t2\t批次甲\t290\t790\t620\nB\tCO₃²⁻\t1\t批次甲\t830\t240\t700\nB\tCO₃²⁻\t2\t批次甲\t800\t280\t670\nC\tCu²⁺\t1\t批次甲\t1210\t900\t220\nC\tCu²⁺\t2\t批次甲\t1180\t870\t250');
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-point]')).toHaveCount(6);
  await persisted(page); await page.reload();
  await expect(moduleOf(page).getByLabel('原始强度 第 1 行第 5 列', { exact: true })).toHaveValue('260');
  await expect(page.getByTestId('recognition-scores-chart').locator('[data-point]')).toHaveCount(6);
  const coords = await page.getByTestId('recognition-scores-chart').locator('[data-point] title').evaluateAll((els) => els.map((el) => el.textContent!.split('\n').slice(-2)).sort());
  await moduleOf(page).getByLabel('原始强度 第 1 行第 2 列', { exact: true }).fill('自由输入离子 Al³⁺');
  const next = await page.getByTestId('recognition-scores-chart').locator('[data-point] title').evaluateAll((els) => els.map((el) => el.textContent!.split('\n').slice(-2)).sort());
  expect(next).toEqual(coords);
  await expect(page.getByTestId('recognition-scores-chart')).toContainText('自由输入离子 Al³⁺');
  await view(page, 'PCA得分');
  const firstScore = await cell(page, 0, 3).innerText();
  await moduleOf(page).getByRole('button', { name: '保存当前结果到新 Sheet', exact: true }).click();
  await expect(moduleOf(page)).toContainText('结果快照'); await expect(cell(page, 0, 3)).toContainText(firstScore);
  await expect(cell(page, 0, 3)).toHaveAttribute('aria-readonly', 'true');
  await moduleOf(page).getByRole('button', { name: '返回来源 Sheet', exact: true }).click();
  await moduleOf(page).getByLabel('原始强度 第 1 行第 5 列', { exact: true }).fill('500');
  await moduleOf(page).getByRole('group', { name: '工作表标签' }).getByRole('button', { name: /^PCA得分-/ }).click();
  await expect(moduleOf(page)).toContainText('来源数据已改变');
  await expect(cell(page, 0, 3)).toContainText(firstScore);
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!).spectra)).toEqual(oldSpectra);
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
  expect(wb.SheetNames).toEqual(['原始强度', '空白与批次', '猝灭率', 'PCA得分', 'PCA载荷', '方差解释率', '聚类结果', 'Ward合并', '分析设置']);
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
    await moduleOf(page).locator('.chart-layout').screenshot({ path: path.join(evidence, `${label}-页面-2026.10.27.png`) });
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
  await page.screenshot({ path: path.join(evidence, '多探针识别-手机端-2026.10.27.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await moduleOf(page).getByLabel('删除探针 3', { exact: true }).click();
  await paste(moduleOf(page).getByLabel('原始强度 第 1 行第 5 列', { exact: true }), '100\t200\n200\t400\n300\t600\n400\t800\n500\t1000\n600\t1200');
  await expect(moduleOf(page)).toContainText('仅有 1 个有效主成分');
  await expect(page.getByTestId('recognition-scores-chart')).toHaveCount(0);
  await chart(page, '层次聚类树状图'); await expect(page.getByTestId('recognition-tree-chart')).toBeVisible();
  await paste(moduleOf(page).getByLabel('原始强度 第 1 行第 5 列', { exact: true }), '100\t200\n100\t400\n100\t600\n100\t800\n100\t1000\n100\t1200');
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
