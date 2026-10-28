import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import type { BatchEdit, ChatInput } from '../../shared/ai-chat-2026.10.25';
import { sheetSnapshots } from '../../src/domain/workbook';

function spectrum(name: string) {
  return { name, mimeType: 'text/plain', buffer: Buffer.from(`Sample:\t'test\nInstrument\nModel:\tF-7100 FL Spectrophotometer\nInstrument parameters\nMeasurement type:\tWavelength scan\nScan mode:\tEmission\nEX WL:\t250.0 nm\nData points\nnm\tData\n` + Array.from({ length: 301 }, (_, i) => `${300+i}\t${10 + 500 * Math.exp(-0.5 * ((300+i-520)/8)**2)}`).join('\n')) };
}
async function start(page: Page) {
  await page.goto('/#assistant');
  const region = page.getByRole('region', { name: 'AI 光谱助手', exact: true });
  await region.getByLabel('上传 F-7100 TXT 光谱').setInputFiles(['A.TXT','B.TXT','C.TXT'].map(spectrum));
  await expect(region.getByRole('tab')).toHaveCount(3);
  await region.getByText('AI 服务商与连接', { exact: true }).click();
  await region.getByLabel('个人 API Key').fill('batch-browser-key-not-real');
  await region.getByLabel(/我同意/).check();
  return region;
}
async function ask(page: Page, question = '删除所有文件 350–400 nm 的数据并合并导出 Excel') {
  await page.getByLabel('向 AI 光谱助手提问').fill(question);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}
function operation(input: ChatInput, edits: BatchEdit[]) {
  return { type: 'batch-edit', sessionId: input.context!.sessionId, revision: input.context!.revision,
    targets: input.context!.selectedFiles!.map(f => ({ fileId: f.id, version: f.version })), edits };
}
const deletion: BatchEdit = { type: 'delete-range', fromNm: 350, toNm: 400, reason: '用户要求删除该区间' };
async function confirm(page: Page) {
  await page.getByLabel('我已核对逐文件影响，确认提交整批编辑').check();
  await page.getByRole('button', { name: '确认批量编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: '统一导出 Excel', exact: true })).toBeEnabled();
}
async function workbook(page: Page) {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '统一导出 Excel', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\d{4}\.\d{1,2}\.\d{1,2}\.xlsx$/);
  return XLSX.read(await readFile((await download.path())!), { type: 'buffer' });
}

test('A/B/C 批量删除、预览无正式改动、二次确认、合并导出、Sheet 数值、撤销重做', async ({ page }) => {
  const requests: ChatInput[] = [];
  await page.route('**/api/ai/chat', async route => {
    const { input } = route.request().postDataJSON(); requests.push(input);
    await route.fulfill({ json: { reply: '将删除全部所选文件的闭区间 350–400 nm，请先预览。', operation: operation(input, [deletion]) } });
  });
  const region = await start(page);
  await expect(region.getByRole('button', { name: '统一导出 Excel', exact: true })).toBeDisabled();
  await ask(page);
  await region.getByRole('button', { name: '应用建议并生成预览', exact: true }).click();
  expect(requests[0].context!.selectedFiles!.map(f => f.name)).toEqual(['A.TXT','B.TXT','C.TXT']);
  expect(requests[0].context!.selectedFiles![0]).toMatchObject({ pointCount: 301, scanRange: { fromNm: 300, toNm: 600 } });
  for (const name of ['A.TXT','B.TXT','C.TXT']) await expect(region.getByLabel('批量编辑预览')).toContainText(`${name}：受影响 51 行；删除 51 行`);
  await expect(region.getByRole('button', { name: '确认批量编辑', exact: true })).toBeDisabled();
  await expect(region.getByRole('button', { name: '统一导出 Excel', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem('perovskite-lab-workspace-v1'))).toBe(true);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!));
  expect(before.workbooks.raw.tabs.some((t: { name: string }) => t.name.includes('_AI处理'))).toBe(false);
  await page.screenshot({ path: 'test-results/批量编辑-确认前-2026.10.25.png', fullPage: true });
  await confirm(page);
  const wb = await workbook(page);
  expect(wb.SheetNames).toEqual(['汇总_处理后','汇总_原始','A.TXT','B.TXT','C.TXT','修改记录','处理参数']);
  const processed = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['汇总_处理后'], { defval: '' });
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['汇总_原始']);
  expect(processed).toHaveLength(750); expect(raw).toHaveLength(903);
  expect(processed.some(r => Number(r.波长_nm)>=350 && Number(r.波长_nm)<=400)).toBe(false);
  await expect.poll(async () => {
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!));
    return state.workbooks.raw.tabs.filter((t: { name: string }) => t.name.includes('_AI处理')).length;
  }).toBe(3);
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!));
  for (const s of sheetSnapshots(state, 'raw').filter(s => s.tab.name.includes('_AI处理'))) {
    const name = s.tab.name.split('_AI处理')[0]+'.TXT';
    const payload = s.payload as { grid: string[][] };
    expect(payload.grid.slice(1).map(r => [r[0],r[1]])).toEqual(processed.filter(r => r.来源文件===name).map(r => [String(r.波长_nm),String(r.处理后强度)]));
  }
  await region.getByRole('button', { name: '撤销上次批量编辑', exact: true }).click();
  const undo = await workbook(page);
  expect(XLSX.utils.sheet_to_json(undo.Sheets['汇总_处理后'])).toHaveLength(903);
  expect(JSON.stringify(XLSX.utils.sheet_to_json(undo.Sheets['修改记录']))).toContain('undo');
  await region.getByRole('button', { name: '重新应用批量编辑', exact: true }).click();
  await confirm(page);
  const redo = await workbook(page);
  expect(XLSX.utils.sheet_to_json(redo.Sheets['汇总_处理后'])).toHaveLength(750);
  const rawValues = (rows: Record<string, unknown>[]) => rows.map(r => [r.文件ID,r.波长_nm,r.原始强度,r.源文件行号]);
  expect(rawValues(XLSX.utils.sheet_to_json(redo.Sheets['汇总_原始']))).toEqual(rawValues(raw));
  await page.screenshot({ path: 'test-results/批量编辑-确认后-2026.10.25.png', fullPage: true });
});

test('批量屏蔽与指定点修改、主峰单独授权、原始值完整', async ({ page }) => {
  await page.route('**/api/ai/chat', async route => {
    const { input } = route.request().postDataJSON();
    await route.fulfill({ json: { reply: '屏蔽并指定处理后强度，主峰修改须单独确认。', operation: operation(input, [
      { type: 'mask-range', fromNm: 350, toNm: 400, reason: '屏蔽' },
      { type: 'set-point', wavelengthNm: 520, value: 123.456, reason: '用户指定' },
    ]) } });
  });
  const region = await start(page);
  await ask(page, '屏蔽350–400 nm，把520 nm处理后值设为123.456');
  await region.getByRole('button', { name: '应用建议并生成预览', exact: true }).click();
  await page.getByLabel('我已核对逐文件影响，确认提交整批编辑').check();
  await expect(page.getByRole('button', { name: '确认批量编辑', exact: true })).toBeDisabled();
  await page.getByLabel('我已核对主峰风险，允许本计划修改保护区').check();
  await confirm(page);
  const wb = await workbook(page);
  const processed = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['汇总_处理后'], { defval: '' });
  expect(processed).toHaveLength(903);
  expect(processed.filter(r => r.处理后强度 === '')).toHaveLength(153);
  expect(processed.filter(r => r.波长_nm === 520).map(r => r.处理后强度)).toEqual([123.456,123.456,123.456]);
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['汇总_原始']);
  expect(raw.filter(r => r.波长_nm === 520).map(r => r.原始强度)).toEqual([510,510,510]);
});

test('其他文件版本变化使整批预览失效，迟到模型回复不得生效', async ({ page }) => {
  let release: (() => void) | undefined;
  let delayed = false;
  await page.route('**/api/ai/chat', async route => {
    const { input } = route.request().postDataJSON();
    if (delayed) await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { reply: '批量待确认', operation: operation(input, [deletion]) } });
  });
  const region = await start(page);
  await ask(page); await region.getByRole('button', { name: '应用建议并生成预览', exact: true }).click();
  await region.getByRole('tab', { name: /B.TXT/ }).click();
  await region.getByLabel('异常识别阈值 / σ').fill('6');
  await expect(region.getByLabel('批量编辑预览')).toContainText('旧预览已失效');
  await expect(region.getByRole('button', { name: '确认批量编辑', exact: true })).toBeDisabled();
  await region.getByRole('button', { name: '取消批量预览', exact: true }).click();
  await region.getByRole('button', { name: '重新生成结果', exact: true }).click();
  await region.getByRole('tab', { name: /A.TXT/ }).click();
  delayed = true; await ask(page, '再生成一次');
  await expect.poll(() => !!release).toBe(true);
  await region.getByLabel('批量选择 C.TXT').uncheck(); release!();
  await expect(region).toContainText('本次回复已失效');
  await expect(region.getByRole('button', { name: '统一导出 Excel', exact: true })).toBeDisabled();
});

test('无效 AI 操作拒绝且没有预览；手机批量界面无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/ai/chat', async route => {
    const { input } = route.request().postDataJSON();
    await route.fulfill({ json: { reply: '危险操作', operation: { ...operation(input, [deletion]), intensities: [1,2,3] } } });
  });
  const region = await start(page); await ask(page);
  await expect(region).toContainText('包含未授权字段');
  await expect(region.getByRole('button', { name: '应用建议并生成预览', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/批量编辑-手机端-2026.10.25.png', fullPage: true });
});

test('合并自动同步后撤销、重做及单文件更新保留其他文件', async ({ page }) => {
  await page.route('**/api/ai/chat', async route => {
    const { input } = route.request().postDataJSON();
    await route.fulfill({ json: { reply: '删除所选区间', operation: operation(input, [deletion]) } });
  });
  const region = await start(page);
  await region.getByLabel('多文件导入方式').selectOption('combined');
  await ask(page);
  await region.getByRole('button', { name: '应用建议并生成预览', exact: true }).click();
  await confirm(page);
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!));
  await expect.poll(async () => (await read()).spectra.length).toBe(3);
  const before = await read();
  expect(before.workbooks.raw.tabs).toHaveLength(2);
  expect(before.rawSheet.grid).toHaveLength(251);
  expect(before.rawSheet.grid[0]).toEqual(['波长 / nm', 'A.TXT', 'B.TXT', 'C.TXT']);
  await region.getByRole('button', { name: '撤销上次批量编辑', exact: true }).click();
  await expect.poll(async () => (await read()).rawSheet.grid.length).toBe(302);
  expect((await read()).workbooks.raw.tabs).toHaveLength(2);
  await region.getByRole('button', { name: '重新应用批量编辑', exact: true }).click();
  await confirm(page);
  await expect.poll(async () => (await read()).rawSheet.grid.length).toBe(251);
  await region.getByRole('button', { name: '更新已同步 Sheet', exact: true }).click();
  await expect.poll(async () => (await read()).spectra.length).toBe(3);
  expect((await read()).rawSheet.grid).toEqual(before.rawSheet.grid);
});
