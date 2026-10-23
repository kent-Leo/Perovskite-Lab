import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const pages = [
  ['光谱工作台', ['原始光谱']], ['对象筛选', ['分析对象']],
  ['校准与检出限', ['校准数据']], ['浓度梯度', ['梯度配液']],
] as const;
async function navigate(page: Page, name: string) {
  await page.getByRole('link', { name, exact: true }).click();
}
test('all four sheet names commit with Enter or blur, survive navigation/reload, and leave data unchanged', async ({ page }, info) => {
  await page.goto('/');
  const original = await page.evaluate(() => {
    // The initial workspace is saved asynchronously.
    return document.querySelectorAll('[data-testid="spectra-chart"] polyline').length;
  });
  let n = 0;
  for (const [name, sheets] of pages) {
    await navigate(page, name);
    for (const sheet of sheets) {
      await page.getByRole('button', { name: `重命名标签 ${sheet}`, exact: true }).click();
      const input = page.getByRole('textbox', { name: '工作表标签名', exact: true });
      await input.fill(`  实验表 ${++n}  `);
      if (n % 2) await input.press('Enter');
      else await page.getByRole('heading', { name, exact: true }).click();
      await expect(page.getByRole('button', { name: `重命名标签 实验表 ${n}`, exact: true })).toBeVisible();
    }
  }
  await page.waitForTimeout(650);
  await page.reload();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!));
  expect(stored.sheetNames).toEqual({ raw: '实验表 1', screening: '实验表 2', calibration: '实验表 3', gradient: '实验表 4' });
  expect(stored.spectra).toHaveLength(6);
  expect(stored.objects).toHaveLength(6);
  expect(stored.calibration).toHaveLength(6);
  await navigate(page, '光谱工作台');
  await expect(page.getByTestId('spectra-chart').locator('polyline')).toHaveCount(original);
  await expect(page.getByRole('button', { name: '重命名标签 实验表 1', exact: true })).toBeVisible();
  await page.locator('.worksheet').first().screenshot({ path: info.outputPath('标签改名-v0.3.1-2026.10.19.png') });
});

test('sheet names reject whitespace and support Escape and double click without changing cells', async ({ page }) => {
  await page.goto('/');
  const sheet = page.locator('.worksheet').first();
  await sheet.locator('.worksheet-sheet-tab').dblclick();
  const input = page.getByRole('textbox', { name: '工作表标签名', exact: true });
  await input.fill('   ');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(sheet.locator('.worksheet-status')).toContainText('标签名须为');
  await input.press('Escape');
  await expect(page.getByRole('button', { name: '重命名标签 原始光谱', exact: true })).toBeVisible();
  await sheet.locator('.worksheet-sheet-tab').dblclick();
  await input.fill('取消的改名');
  await input.press('Escape');
  await expect(page.getByRole('button', { name: '重命名标签 原始光谱', exact: true })).toBeVisible();
});

for (const [name, kind] of [['光谱工作台', 'spectra'], ['对象筛选', 'screening'], ['校准与检出限', 'calibration']] as const) {
  test(`${name}: edits four axes independently, draws tick direction/length and persists settings`, async ({ page }, info) => {
    await page.goto('/');
    await navigate(page, name);
    await page.getByRole('button', { name: '坐标', exact: true }).click();
    const chart = page.getByTestId(`${kind}-chart`);
    await expect(chart.locator('[data-axis]')).toHaveCount(2);
    for (const [side, chinese] of [['bottom', '下轴'], ['top', '上轴'], ['left', '左轴'], ['right', '右轴']] as const) {
      await page.getByRole('button', { name: chinese, exact: true }).click();
      await page.getByLabel(`显示${chinese}`, { exact: true }).check();
      await page.getByLabel(`${chinese}名称`, { exact: true }).fill(`${chinese}实验 <&>`);
      await page.getByLabel(`${chinese}刻度线`, { exact: true }).selectOption('both');
      await page.getByLabel(`${chinese}刻度长度`, { exact: true }).fill('9');
      await page.getByLabel(`${chinese}刻度粗细`, { exact: true }).fill('2');
      if (kind !== 'screening' || side === 'left' || side === 'right')
        await page.getByLabel(`${chinese}刻度分段数`, { exact: true }).fill('4');
      const axis = chart.locator(`[data-axis="${side}"]`);
      await expect(axis.locator('[data-axis-title]')).toHaveText(`${chinese}实验 <&>`);
      await expect(axis.locator('[data-axis-ticks] line')).toHaveCount(kind === 'screening' && (side === 'top' || side === 'bottom') ? 6 : 5);
      const tick = axis.locator('[data-axis-ticks] line').first();
      const span = await tick.evaluate((el, horizontal) => {
        const a = horizontal ? 'y' : 'x';
        return Math.abs(Number(el.getAttribute(`${a}2`)) - Number(el.getAttribute(`${a}1`)));
      }, side === 'top' || side === 'bottom');
      expect(span).toBe(18);
      await expect(tick).toHaveAttribute('stroke-width', '2');
    }
    await expect(chart.locator('[data-axis]')).toHaveCount(4);
    await page.getByLabel('右轴刻度线', { exact: true }).selectOption('none');
    await page.getByLabel('显示右轴刻度标签', { exact: true }).uncheck();
    await expect(chart.locator('[data-axis="right"] [data-axis-ticks] line')).toHaveCount(0);
    await expect(chart.locator('[data-axis="right"] [data-axis-tick-labels] text')).toHaveCount(0);
    await expect(chart.locator('[data-axis="top"] [data-axis-ticks] line')).not.toHaveCount(0);
    await page.waitForTimeout(650);
    await page.reload();
    await expect(chart.locator('[data-axis="right"] [data-axis-title]')).toHaveText('右轴实验 <&>');
    await page.getByRole('button', { name: '坐标', exact: true }).click();
    await page.getByRole('button', { name: '右轴', exact: true }).click();
    await expect(page.getByLabel('右轴刻度线', { exact: true })).toHaveValue('none');
    await page.screenshot({ path: info.outputPath(`${kind}-四轴-v0.3.1-2026.10.19.png`), fullPage: true });
    await chart.screenshot({ path: info.outputPath(`${kind}-图表-v0.3.1-2026.10.19.png`) });
    await page.getByLabel('显示右轴', { exact: true }).uncheck();
    await expect(chart.locator('[data-axis="right"]')).toHaveCount(0);
  });
}

test('four axes export to SVG, PNG and PDF with versioned filenames', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: '坐标', exact: true }).click();
  for (const side of ['上轴', '右轴']) {
    await page.getByRole('button', { name: side, exact: true }).click();
    await page.getByLabel(`显示${side}`, { exact: true }).check();
    await page.getByLabel(`${side}名称`, { exact: true }).fill(`${side}试验 μM`);
  }
  for (const format of ['SVG', 'PNG', 'PDF']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: format, exact: true }).click();
    const file = await pending;
    expect(file.suggestedFilename()).toMatch(/-v0\.6\.0-\d{4}\.\d{1,2}\.\d{1,2}\./);
    const path = info.outputPath(`四轴-v0.3.1-2026.10.19.${format.toLowerCase()}`);
    await file.saveAs(path);
    const bytes = await readFile(path);
    if (format === 'SVG') {
      const svg = bytes.toString();
      expect(svg.match(/data-axis="(?:top|bottom|left|right)"/g)).toHaveLength(4);
      expect(svg).toContain('上轴试验 μM');
      expect(svg).toContain('右轴试验 μM');
    } else if (format === 'PDF') {
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    } else expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  }
});

test('old workspace settings/data survive upgrade and charts stay within the viewport on mobile', async ({ page }, info) => {
  await page.goto('/');
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    const key = 'perovskite-lab-workspace-v1', w = JSON.parse(localStorage.getItem(key)!);
    delete w.sheetNames;
    for (const s of Object.values(w.styles) as any[]) delete s.axes;
    w.styles.spectra.xLabel = '旧版波长名称';
    w.spectra[0].name = '旧版实际样品';
    localStorage.setItem(key, JSON.stringify(w));
  });
  await page.reload();
  await expect(page.getByTestId('spectra-chart')).toContainText('旧版波长名称');
  await expect(page.getByTestId('spectra-chart')).toContainText('旧版实际样品');
  await expect(page.getByTestId('spectra-chart').locator('[data-axis]')).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name] of pages) {
    await page.goto(`/#${{ '光谱工作台': 'spectra', '对象筛选': 'screening', '校准与检出限': 'calibration', '浓度梯度': 'gradient' }[name]}`);
    if (name !== '浓度梯度') {
      await page.getByRole('button', { name: '坐标', exact: true }).click();
      await page.getByRole('button', { name: '上轴', exact: true }).click();
      await page.getByLabel('显示上轴', { exact: true }).check();
      await page.getByLabel('上轴名称', { exact: true }).fill('上轴波长 / nm');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('手机-v0.3.1-2026.10.19.png'), fullPage: true });
});

test('inward/outward ticks point correctly on each edge and zero length hides only ticks', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '坐标', exact: true }).click();
  for (const [side, label, sign] of [['top', '上轴', -1], ['bottom', '下轴', 1], ['left', '左轴', -1], ['right', '右轴', 1]] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByLabel(`显示${label}`, { exact: true }).check();
    await page.getByLabel(`${label}刻度长度`, { exact: true }).fill('8');
    for (const direction of ['out', 'in'] as const) {
      await page.getByLabel(`${label}刻度线`, { exact: true }).selectOption(direction);
      const positions = await page.locator(`[data-axis="${side}"]`).evaluate((axis, horizontal) => {
        const key = horizontal ? 'y' : 'x';
        const baseline = Number(axis.querySelector('line')!.getAttribute(`${key}1`));
        const tick = axis.querySelector('[data-axis-ticks] line')!;
        return [baseline, Number(tick.getAttribute(`${key}1`)), Number(tick.getAttribute(`${key}2`))];
      }, side === 'top' || side === 'bottom');
      expect(positions[direction === 'out' ? 1 : 2]).toBe(positions[0]);
      expect(positions[direction === 'out' ? 2 : 1] - positions[0]).toBe((direction === 'out' ? sign : -sign) * 8);
    }
    await page.getByLabel(`${label}刻度长度`, { exact: true }).fill('0');
    await expect(page.locator(`[data-axis="${side}"] [data-axis-ticks] line`)).toHaveCount(0);
    await expect(page.locator(`[data-axis="${side}"] [data-axis-tick-labels] text`)).toHaveCount(6);
  }
});

test('large fonts, long category names and four titles fit inside the exported SVG', async ({ page }, info) => {
  await page.goto('/');
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    const key = 'perovskite-lab-workspace-v1', w = JSON.parse(localStorage.getItem(key)!);
    w.objects.forEach((o: any, i: number) => { o.name = `第${i + 1}组实际河水样品添加干扰离子`; });
    const s = w.styles.screening;
    s.fontSize = 30;
    s.title = '四侧坐标轴与分类标签排版';
    s.xLabel = '下轴分析对象'; s.yLabel = '左轴相对荧光响应';
    s.axes = { top: { visible: true, label: '上轴分析对象' }, right: { visible: true, label: '右轴相对荧光响应' } };
    localStorage.setItem(key, JSON.stringify(w));
  });
  await page.goto('/#screening');
  await page.reload();
  const chart = page.getByTestId('screening-chart');
  await expect(chart.locator('[data-axis]')).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
  const errors = await chart.evaluate((chart) => {
    const svg = chart.querySelector('svg')!, bounds = svg.getBoundingClientRect(), errors: string[] = [];
    for (const text of svg.querySelectorAll('text')) {
      const r = text.getBoundingClientRect();
      if (r.left < bounds.left - 1 || r.right > bounds.right + 1 || r.top < bounds.top - 1 || r.bottom > bounds.bottom + 1)
        errors.push(text.textContent ?? '');
    }
    // A title and the labels of its own axis must not overlap.
    for (const axis of svg.querySelectorAll('[data-axis]')) {
      const title = axis.querySelector('[data-axis-title]')?.getBoundingClientRect();
      if (!title) continue;
      for (const text of axis.querySelectorAll('[data-axis-tick-labels] text')) {
        const r = text.getBoundingClientRect();
        if (r.left < title.right && r.right > title.left && r.top < title.bottom && r.bottom > title.top)
          errors.push(`overlap: ${axis.getAttribute('data-axis')} title=${title.top},${title.bottom} label=${r.top},${r.bottom}`);
      }
    }
    return errors;
  });
  expect(errors).toEqual([]);
  await chart.screenshot({ path: info.outputPath('长标签大字号-v0.3.1-2026.10.19.png') });
});
