import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { AI_STORAGE_KEY } from '../../src/state/ai-session-2026.10.24';
const SECRET = 'test-user-key-not-real-2026.10.24';
const panel = (page: Page) => page.getByRole('region', { name: 'AI 辅助光谱处理', exact: true });
async function importTxt(page: Page, withBlank = false) {
  await page.getByLabel('选择数据文件').setInputFiles({ name: '光谱样品-2026.10.24.txt', mimeType: 'text/plain',
    buffer: Buffer.from(withBlank
      ? 'Wavelength\tSolventBlank\tSample A\n400\t20\t10\n401\t22\t12\n402\t24\t100\n403\t26\t15\n404\t28\t10\n'
      : 'Wavelength\tSample A\n400\t10\n401\t12\n402\t100\n403\t15\n404\t10\n') });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (withBlank) await dialog.locator('.column-choices').getByLabel('Sample A', { exact: true }).check();
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(panel(page).getByRole('checkbox', { name: 'Sample A', exact: true })).toBeVisible();
  await page.getByLabel('激发波长 / nm', { exact: true }).fill('350');
}
async function credentials(page: Page, key = SECRET) {
  const p = panel(page);
  await p.getByLabel('个人 API Key', { exact: true }).fill(key);
  await p.locator('.ai-consent input').check();
}
async function addManual(p: Locator, from = '402', to = '402') {
  await p.getByLabel('排除区间起点 / nm', { exact: true }).fill(from);
  await p.getByLabel('排除区间终点 / nm', { exact: true }).fill(to);
  await p.getByRole('button', { name: '添加手动区间', exact: true }).click();
}
test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('TXT → unconfirmed AI suggestions → preview → apply → auditable Excel; raw data and key isolation', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await importTxt(page);
  const p = panel(page);
  const originalLine = await page.getByTestId('spectra-chart').locator('polyline').getAttribute('points');
  await credentials(page);
  await page.route('**/api/ai/analyze', async (route) => {
    const req = route.request(), data = req.postDataJSON();
    expect(req.headers().authorization).toBe(`Bearer ${SECRET}`);
    expect(req.postData()).not.toContain(SECRET);
    expect(data.input.spectra[0].points).toHaveLength(5);
    await route.fulfill({ json: { summary: '402 nm 附近存在疑似干扰，请结合空白确认。',
      regions: [{ spectrumId: data.input.spectra[0].id, fromNm: 402, toNm: 402, reason: '人工核验后排除' }] } });
  });
  await p.getByRole('button', { name: 'AI 分析干扰', exact: true }).click();
  await expect(p.locator('.ai-analysis')).toContainText('402 nm');
  await expect(p.getByLabel('应用区间 1', { exact: true })).not.toBeChecked();
  await expect(p.getByRole('button', { name: '导出处理 Excel', exact: true })).toBeDisabled();
  await p.getByRole('button', { name: '预览处理', exact: true }).click();
  await expect(p.getByRole('alert')).toContainText('请勾选');
  await p.getByLabel('应用区间 1', { exact: true }).check();
  await p.getByRole('button', { name: '预览处理', exact: true }).click();
  await expect(p.getByTestId('ai-processing-chart')).toBeVisible();
  await expect(p.getByTestId('ai-processing-chart').locator('polyline')).toHaveCount(3); // raw + 2 separated runs
  await p.getByRole('button', { name: '确认应用处理', exact: true }).click();
  await expect(p).toContainText('已应用结果');
  const downloaded = page.waitForEvent('download');
  await p.getByRole('button', { name: '导出处理 Excel', exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/^光谱干扰处理-v0\.9\.2-\d{4}\.\d{1,2}\.\d{1,2}\.xlsx$/);
  const output = info.outputPath('处理结果-2026.10.24.xlsx');
  await file.saveAs(output);
  const wb = XLSX.read(await readFile(output));
  expect(wb.SheetNames).toEqual(['原始数据', '处理数据', '修改记录', '处理参数']);
  const processed = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.处理数据, { defval: '' });
  expect(processed[2].处理强度).toBe('');
  expect(processed[2].原始强度).toBe(100);
  expect(XLSX.utils.sheet_to_json(wb.Sheets.原始数据)).toHaveLength(5);
  const all = wb.SheetNames.map((name) => XLSX.utils.sheet_to_json(wb.Sheets[name]));
  expect(JSON.stringify(all)).not.toContain(SECRET);
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveAttribute('points', originalLine!);
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(1);
  await mkdir('验证截图-AI-BYOK-2026.10.24', { recursive: true });
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10000 });
  await p.screenshot({ path: '验证截图-AI-BYOK-2026.10.24/AI处理与导出-2026.10.24.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('credentials persist across reloads and reopened pages, stay separate per provider and never enter backups', async ({ page, context }, info) => {
  const p = panel(page);
  await credentials(page);
  await page.getByRole('link', { name: '对象筛选', exact: true }).click();
  await page.getByRole('link', { name: '光谱工作台', exact: true }).click();
  await expect(p.getByLabel('个人 API Key', { exact: true })).toHaveValue(SECRET);
  const storage = await page.evaluate((key) => ({ saved: JSON.parse(localStorage.getItem(key)!),
    others: JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([name]) => name !== key))),
    session: JSON.stringify({ ...sessionStorage }) }), AI_STORAGE_KEY);
  expect(storage.saved.accounts.deepseek.apiKey).toBe(SECRET);
  expect(storage.others).not.toContain(SECRET);
  expect(storage.session).not.toContain(SECRET);
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载数据备份', exact: true }).click();
  const backup = await backupDownload, backupPath = info.outputPath('工作区备份-2026.10.24.json');
  await backup.saveAs(backupPath);
  expect(await readFile(backupPath, 'utf8')).not.toContain(SECRET);
  await p.getByLabel('AI 服务商', { exact: true }).selectOption('openai');
  await expect(p.getByLabel('个人 API Key', { exact: true })).toHaveValue('');
  await expect(p.getByLabel('AI 模型', { exact: true })).toHaveValue('gpt-6.1-sol');
  await expect(p.locator('.ai-consent input')).not.toBeChecked();
  const openaiKey = 'test-openai-separate-key-2026.10.24';
  await credentials(page, openaiKey);
  await p.getByLabel('AI 模型', { exact: true }).selectOption('gpt-6-luna');
  await p.getByLabel('AI 服务商', { exact: true }).selectOption('deepseek');
  await expect(p.getByLabel('个人 API Key', { exact: true })).toHaveValue(SECRET);
  await p.getByLabel('AI 服务商', { exact: true }).selectOption('openai');
  await expect(p.getByLabel('个人 API Key', { exact: true })).toHaveValue(openaiKey);
  await expect(p.getByLabel('AI 模型', { exact: true })).toHaveValue('gpt-6-luna');
  await p.locator('.ai-consent input').check();
  await page.route('**/api/ai/test', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ provider: 'openai', model: 'gpt-6-luna' });
    expect(route.request().headers().authorization).toBe(`Bearer ${openaiKey}`);
    await route.fulfill({ json: { ok: true } });
  });
  await p.getByRole('button', { name: '测试连接（可能计费）', exact: true }).click();
  await expect(p).toContainText('连接成功');
  await p.getByRole('button', { name: '清除密钥', exact: true }).click();
  await expect(p.getByLabel('个人 API Key', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(panel(page).getByLabel('个人 API Key', { exact: true })).toHaveValue('');
  await p.getByLabel('AI 服务商', { exact: true }).selectOption('deepseek');
  await expect(p.getByLabel('个人 API Key', { exact: true })).toHaveValue(SECRET);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '新建空白工作区', exact: true }).click();
  await expect(p.getByLabel('个人 API Key', { exact: true })).toHaveValue(SECRET);
  const reopened = await context.newPage();
  await page.close();
  await reopened.goto('/');
  await expect(panel(reopened).getByLabel('个人 API Key', { exact: true })).toHaveValue(SECRET);
  await panel(reopened).getByRole('button', { name: '清除全部服务商密钥', exact: true }).click();
  await reopened.reload();
  await expect(panel(reopened).getByLabel('个人 API Key', { exact: true })).toHaveValue('');
  await panel(reopened).getByLabel('AI 服务商', { exact: true }).selectOption('openai');
  await expect(panel(reopened).getByLabel('个人 API Key', { exact: true })).toHaveValue('');
});

test('manual key clearing synchronizes to another tab and stays cleared after reload', async ({ page, context }) => {
  await credentials(page);
  const second = await context.newPage();
  await second.goto('/');
  await expect(panel(second).getByLabel('个人 API Key', { exact: true })).toHaveValue(SECRET);
  await panel(page).getByRole('button', { name: '清除密钥', exact: true }).click();
  await expect(panel(second).getByLabel('个人 API Key', { exact: true })).toHaveValue('');
  await second.reload();
  await expect(panel(second).getByLabel('个人 API Key', { exact: true })).toHaveValue('');
});

test('corrupt saved settings recover and blocked storage reports that keys were not saved', async ({ page }) => {
  await page.evaluate((key) => localStorage.setItem(key, 'invalid-json'), AI_STORAGE_KEY);
  await page.reload();
  await expect(panel(page).getByRole('alert')).toContainText('无法读取');
  await credentials(page);
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(panel(page).getByLabel('个人 API Key', { exact: true })).toHaveValue(SECRET);
  await panel(page).getByRole('button', { name: '清除全部服务商密钥', exact: true }).click();
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('test storage limit', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, AI_STORAGE_KEY);
  await page.reload();
  await panel(page).getByLabel('个人 API Key', { exact: true }).fill(SECRET);
  await expect(panel(page).getByRole('alert')).toContainText('浏览器无法保存');
  await page.reload();
  await expect(panel(page).getByLabel('个人 API Key', { exact: true })).toHaveValue('');
});

test('manual processing works without AI, guards target ranges and invalidates old exports on parameter edits', async ({ page }) => {
  await importTxt(page);
  const p = panel(page);
  await p.getByLabel('目标保护区起点 / nm', { exact: true }).fill('401');
  await p.getByLabel('目标保护区终点 / nm', { exact: true }).fill('403');
  await addManual(p);
  await expect(p.getByRole('alert')).toContainText('保护区重叠');
  await p.getByLabel('目标保护区起点 / nm', { exact: true }).fill('403');
  await p.getByLabel('目标保护区终点 / nm', { exact: true }).fill('404');
  await addManual(p);
  await expect(p.getByLabel('应用区间 1', { exact: true })).toBeChecked();
  await p.getByRole('button', { name: '预览处理', exact: true }).click();
  await p.getByRole('button', { name: '确认应用处理', exact: true }).click();
  await expect(p.getByRole('button', { name: '导出处理 Excel', exact: true })).toBeEnabled();
  await p.getByLabel('区间 1 起点', { exact: true }).fill('401');
  await expect(p.getByRole('button', { name: '导出处理 Excel', exact: true })).toBeDisabled();
  await expect(p.getByTestId('ai-processing-chart')).toHaveCount(0);
  await p.getByRole('button', { name: '预览处理', exact: true }).click();
  await p.getByRole('button', { name: '确认应用处理', exact: true }).click();
  await page.getByLabel('激发波长 / nm', { exact: true }).fill('360');
  await expect(p.getByRole('button', { name: '导出处理 Excel', exact: true })).toBeDisabled();
  await expect(p.locator('.ai-regions')).toHaveCount(0);
});

test('blank subtraction needs same conditions and keeps negative intensity in Excel', async ({ page }, info) => {
  await importTxt(page, true);
  const p = panel(page);
  await p.getByLabel('空白参考光谱', { exact: true }).selectOption({ label: 'SolventBlank' });
  await p.getByRole('checkbox', { name: '启用 1:1 空白扣除', exact: true }).check();
  await p.getByRole('button', { name: '预览处理', exact: true }).click();
  await expect(p.getByRole('alert')).toContainText('条件一致');
  await p.getByRole('checkbox', { name: '确认空白与样品测量条件一致', exact: true }).check();
  await p.getByRole('button', { name: '预览处理', exact: true }).click();
  await p.getByRole('button', { name: '确认应用处理', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await p.getByRole('button', { name: '导出处理 Excel', exact: true }).click();
  const output = info.outputPath('空白扣除-2026.10.24.xlsx');
  await (await downloaded).saveAs(output);
  const wb = XLSX.read(await readFile(output));
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.处理数据);
  expect(rows.map((r) => r.处理强度)).toEqual([-10, -10, 76, -11, -18]);
  expect(XLSX.utils.sheet_to_json(wb.Sheets.原始数据)).toHaveLength(10);
});

test('late AI replies are discarded after data edits; errors leave manual tools usable', async ({ page }) => {
  await importTxt(page);
  const p = panel(page);
  await credentials(page);
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/ai/analyze', async (route) => {
    const data = route.request().postDataJSON();
    await ready;
    await route.fulfill({ json: { summary: '过期分析', regions: [{ spectrumId: data.input.spectra[0].id,
      fromNm: 402, toNm: 402, reason: '过期建议' }] } }).catch(() => {});
  });
  const sent = page.waitForRequest('**/api/ai/analyze');
  await p.getByRole('button', { name: 'AI 分析干扰', exact: true }).click();
  await sent;
  await p.getByLabel('溶剂或基质', { exact: true }).fill('乙醇');
  release();
  await expect(p.locator('.ai-analysis')).toHaveCount(0);
  await expect(p.locator('.ai-regions')).toHaveCount(0);
  await page.unroute('**/api/ai/analyze');
  await page.route('**/api/ai/analyze', (route) => route.fulfill({ status: 402, json: { error: '账户余额不足' } }));
  await p.getByRole('button', { name: 'AI 分析干扰', exact: true }).click();
  await expect(p.getByRole('alert')).toContainText('余额不足');
  await addManual(p);
  await p.getByRole('button', { name: '预览处理', exact: true }).click();
  await expect(p.getByTestId('ai-processing-chart')).toBeVisible();
});

test('switching sheets clears results but keeps session key; mobile controls stay within viewport', async ({ page }) => {
  await importTxt(page);
  const p = panel(page);
  await credentials(page);
  await addManual(p);
  await p.getByRole('button', { name: '预览处理', exact: true }).click();
  await p.getByRole('button', { name: '确认应用处理', exact: true }).click();
  await page.getByLabel('新建 sheet', { exact: true }).click();
  await expect(p.getByRole('button', { name: '导出处理 Excel', exact: true })).toBeDisabled();
  await expect(p.getByLabel('个人 API Key', { exact: true })).toHaveValue(SECRET);
  await page.setViewportSize({ width: 390, height: 844 });
  await p.scrollIntoViewIfNeeded();
  expect(await p.evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(391);
  await mkdir('验证截图-AI-BYOK-2026.10.24', { recursive: true });
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10000 });
  await p.screenshot({ path: '验证截图-AI-BYOK-2026.10.24/移动端设置-2026.10.24.png', animations: 'disabled' });
});
