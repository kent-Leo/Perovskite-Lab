import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

function sample(name: string) {
  return { name, mimeType:'text/plain',buffer:Buffer.from('nm\tData\n'+Array.from({length:101},(_,i)=>`${450+i}\t${10+500*Math.exp(-0.5*((450+i-520)/8)**2)}`).join('\n')) };
}

test('扫描范围默认完整、逐文件隔离、裁剪导出、恢复完整及旧确认失效', async ({page}) => {
  await page.goto('/#assistant');
  const region = page.getByRole('region',{name:'AI 光谱助手',exact:true});
  await region.getByLabel('上传 F-7100 TXT 光谱').setInputFiles([sample('A.TXT'),sample('B.TXT')]);
  const from = region.getByLabel('扫描范围起点 / nm',{exact:true});
  const to = region.getByLabel('扫描范围终点 / nm',{exact:true});
  await expect(from).toHaveValue('450'); await expect(to).toHaveValue('550');
  await region.getByRole('button',{name:'确认处理结果',exact:true}).click();
  const downloadButton = region.getByRole('button',{name:'导出 Excel',exact:true});
  await expect(downloadButton).toBeEnabled();
  await from.fill('480'); await to.fill('540');
  await expect(downloadButton).toBeDisabled();
  await expect(region.getByLabel('扫描范围设置')).toContainText('61 个实际测量点');
  await region.getByRole('tab',{name:/B.TXT/}).click();
  await expect(from).toHaveValue('450'); await expect(to).toHaveValue('550');
  await region.getByRole('tab',{name:/A.TXT/}).click();
  await expect(from).toHaveValue('480');
  await region.getByRole('button',{name:'按扫描范围生成预览',exact:true}).click();
  await expect(downloadButton).toBeDisabled();
  await region.getByRole('button',{name:'确认处理结果',exact:true}).click();
  const pending = page.waitForEvent('download'); await downloadButton.click();
  const file = await pending, wb = XLSX.read(await readFile((await file.path())!),{type:'buffer'});
  expect(XLSX.utils.sheet_to_json(wb.Sheets['原始数据'])).toHaveLength(101);
  const processed = XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets['处理后数据']);
  expect(processed).toHaveLength(61); expect(processed[0].波长_nm).toBe(480); expect(processed.at(-1)!.波长_nm).toBe(540);
  await region.getByLabel('扫描范围设置').screenshot({path:'test-results/扫描范围-2026.10.26.png'});
  await region.getByRole('button',{name:'恢复完整范围',exact:true}).click();
  await expect(from).toHaveValue('450'); await expect(to).toHaveValue('550');
  await expect(downloadButton).toBeDisabled();
  await region.getByRole('button',{name:'按扫描范围生成预览',exact:true}).click();
  await region.getByRole('button',{name:'确认处理结果',exact:true}).click();
  const restoredDownload = page.waitForEvent('download'); await downloadButton.click();
  const restored = XLSX.read(await readFile((await (await restoredDownload).path())!),{type:'buffer'});
  expect(XLSX.utils.sheet_to_json(restored.Sheets['处理后数据'])).toHaveLength(101);
});

test('空值、逆序、越界、少于5点均禁止确认和导出；手机布局可用', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#assistant');
  await page.getByLabel('上传 F-7100 TXT 光谱').setInputFiles(sample('范围.TXT'));
  const from = page.getByLabel('扫描范围起点 / nm',{exact:true}), to = page.getByLabel('扫描范围终点 / nm',{exact:true});
  for (const [a,b,message] of [['','540','请填写'],['540','480','终点必须大于起点'],['449','540','不能超出'],['480','483','至少需要 5']]) {
    await from.fill(a); await to.fill(b);
    await expect(page.getByLabel('扫描范围设置')).toContainText(message);
    await expect(page.getByRole('button',{name:'按扫描范围生成预览',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'确认处理结果',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'导出 Excel',exact:true})).toBeDisabled();
  }
  await from.fill('480'); await to.fill('540');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByLabel('扫描范围设置').screenshot({path:'test-results/扫描范围-手机端-2026.10.26.png'});
});
