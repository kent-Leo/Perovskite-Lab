import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const SHOT_DIR = path.resolve('test-results/AI光谱助手-2026.10.25');
mkdirSync(SHOT_DIR, { recursive: true });
const shot = (name: string) => path.join(SHOT_DIR, `${name}-2026.10.25.png`);

const gaussian = (x: number, centre: number, sigma: number, height: number) =>
  height * Math.exp(-0.5 * ((x - centre) / sigma) ** 2);
const noise = (index: number) => {
  const value = Math.sin(index * 7.17) * 14713.37;
  return (value - Math.floor(value) - 0.5) * 0.4;
};
function sampleText() {
  const rows = Array.from({ length: 101 }, (_, index) => {
    const x = 450 + index;
    let y = 10 + gaussian(x, 520, 8, 500) + noise(index);
    if (x === 480) y += 40;
    if (x >= 470 && x <= 473) y += 16;
    return `${x.toFixed(1)}\t${y.toFixed(4)}`;
  });
  return `Sample:\t'测试样品
File name:\t测试样品.FDS
Run date:\t'11:18:14, 10/23/2026
Operator:\tTEST
Comment:\t'

Instrument
Model:\tF-7100 FL Spectrophotometer
Serial number:\t0000-000

Instrument parameters
Measurement type:\tWavelength scan
Scan mode:\tEmission
Data mode:\tFluorescence
EX WL:\t350.0 nm
EM  Start WL:\t450.0 nm
EM  End WL:\t550.0 nm
Scan speed:\t30000 nm/min
EX Slit:\t2.5 nm
EM Slit:\t2.5 nm
PMT Voltage:\t500 V
Response:\t0.002 s
Corrected spectra:\tOff

Peaks
No.\tStart(nm)\tApex(nm)\tEnd(nm)\tHeight(Data)\tValley(nm)\tValley(Data)
1\t500.0\t520.0\t540.0\t500.0\t540.0\t1.000

Data points
nm\tData
${rows.join('\n')}
`;
}
async function upload(page: Page) {
  const menu = page.getByRole('button', { name: '打开导航', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'AI 光谱助手', exact: true }).click();
  const region = page.getByRole('region', { name: 'AI 光谱助手' });
  await region.getByLabel('上传 F-7100 TXT 光谱').setInputFiles({
    name: '测试样品(FDS).TXT',
    mimeType: 'text/plain',
    buffer: Buffer.from(sampleText(), 'utf8'),
  });
  await expect(region.getByText('F-7100 单次发射光谱', { exact: true })).toBeVisible();
  await expect(region.getByTestId('assistant-chart').locator('svg')).toBeVisible();
  return region;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'AI 光谱助手', exact: true })).toBeVisible();
});

test('F-7100 上传、对话、AI 分类、确认、Excel 与 Sheet 同步', async ({ page }) => {
  const region = await upload(page);
  const log = region.getByRole('log');
  await expect(log).toContainText('主发射峰');
  await expect(log).toContainText('局部修复');
  await expect(region.getByTestId('assistant-chart')).toContainText('原始测量值');

  // Natural-language command becomes a concrete parameter and a new result.
  await region.getByRole('button', { name: '重新分析 450–550 nm', exact: true }).click();
  await expect(log).toContainText('重分析区间 450–550 nm');
  await expect(log).toContainText('当前结果');

  // AI settings and mocked classification relay.
  await region.getByText('AI 服务商与连接', { exact: true }).click();
  await region.getByLabel('个人 API Key').fill('browser-test-key-not-real');
  await region.getByLabel(/我同意/).check();
  await page.route('**/api/ai/assistant', async (route) => {
    const body = route.request().postDataJSON() as { input: { anomalies: { id: string }[] } };
    const id = body.input.anomalies[0]?.id;
    await route.fulfill({
      json: {
        summary: 'A1 为连续异常区间，建议保持屏蔽并人工核对；主峰保护区未修改。',
        anomalyNotes: id
          ? [{ id, classification: 'uncertain', confidence: 'medium', note: '区间较宽，需要人工确认是否为真实谱形。' }]
          : [],
        recommendations: ['核对 470–473 nm 是否有仪器伪影。'],
      },
    });
  });
  await region.getByRole('button', { name: 'AI 辅助分类（可能计费）' }).click();
  await expect(region).toContainText('AI 分类说明');
  await expect(log).toContainText('AI 仅提供解释与分类');

  // Confirm: default auto-sync creates a new Sheet.
  await region.getByRole('button', { name: '确认处理结果' }).click();
  await expect(region).toContainText('已同步到 Sheet「测试样品(FDS)_AI处理」');
  await page.screenshot({ path: shot('对话与同步结果'), fullPage: true, animations: 'disabled' });

  // Independent Excel export uses the confirmed result.
  const downloadPromise = page.waitForEvent('download');
  await region.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloadPromise;
  const file = await download.path();
  expect(file).toBeTruthy();
  const wb = XLSX.read(readFileSync(file!), { type: 'buffer' });
  expect(wb.SheetNames).toEqual(['原始数据', '处理后数据', '杂峰处理记录', 'AI分析报告']);
  const processed = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.处理后数据, {
    defval: '',
  });
  expect(processed).toHaveLength(101);
  expect(processed.find((row) => row.波长_nm === 480)?.处理状态).toBe('已修复');
  expect(processed.filter((row) => row.处理状态 === '已屏蔽').map((row) => row.波长_nm)).toEqual([
    470, 471, 472, 473,
  ]);
  const report = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.AI分析报告, {
    defval: '',
  });
  expect(JSON.stringify(report)).toContain('A1 为连续异常区间');
  expect(JSON.stringify(report)).not.toContain('browser-test-key-not-real');

  // Any parameter change invalidates the confirmed snapshot and disables export.
  await region.getByLabel('异常识别阈值 / σ').fill('5');
  await expect(region.getByText('未确认', { exact: true })).toBeVisible();
  await expect(region.getByRole('button', { name: '导出 Excel', exact: true })).toBeDisabled();

  // The new Sheet is active in the existing spectrum workbench and plots both curves.
  await region.getByRole('button', { name: /前往光谱工作台查看/ }).click();
  await expect(page.getByRole('heading', { name: '光谱工作台', exact: true })).toBeVisible();
  await expect(
    page.getByRole('group', { name: '绘图 sheet' }).getByRole('button', {
      name: '绘图 sheet 测试样品(FDS)_AI处理',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(2);
  await page.screenshot({ path: shot('同步后的光谱工作台'), fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('切换模块后保留已上传文件、对话和未确认结果', async ({ page }) => {
  const region = await upload(page);
  const log = region.getByRole('log');
  await region.getByRole('button', { name: '只标记不修改', exact: true }).click();
  await expect(log).toContainText('关闭局部修复');

  await page.getByRole('link', { name: '对象筛选', exact: true }).click();
  await expect(page.getByRole('heading', { name: '对象筛选', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'AI 光谱助手', exact: true }).click();

  await expect(region).toBeVisible();
  await expect(region.getByRole('tab', { name: /测试样品/ })).toBeVisible();
  await expect(region.getByTestId('assistant-chart').locator('svg')).toBeVisible();
  await expect(region.getByText('F-7100 单次发射光谱', { exact: true })).toBeVisible();
  await expect(log).toContainText('只标记不修改');
  await expect(log).toContainText('101 个测量点');
});

test('390px 手机端可直接上传与查看图表', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const region = await upload(page);
  await expect(region.getByTestId('assistant-chart').locator('svg')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: shot('手机端'), fullPage: true, animations: 'disabled' });
});
