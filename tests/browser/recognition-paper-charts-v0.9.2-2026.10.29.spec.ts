import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidence = path.resolve('docs/验收-多探针图表-v0.9.2-2026.10.29');
mkdirSync(evidence, { recursive: true });
const moduleOf = (page: Page) => page.getByTestId('recognition-module');
const scores = (page: Page) => page.getByTestId('recognition-scores-chart');
const tree = (page: Page) => page.getByTestId('recognition-tree-chart');
const selectChart = (page: Page, name: string) => moduleOf(page).getByRole('group', { name: '识别分析图形' }).getByRole('button', { name, exact: true }).click();
async function demo(page: Page) {
  await page.goto('/#recognition');
  await moduleOf(page).getByRole('button', { name: '载入演示数据', exact: true }).click();
  await expect(scores(page).locator('[data-point]')).toHaveCount(6);
  await page.evaluate(() => document.fonts.ready);
}
async function assertLabels(root: Locator) {
  const result = await root.evaluate((el) => {
    const svg = el.querySelector('svg')!;
    const rect = svg.querySelector('clipPath rect')!;
    const bounds = { x: Number(rect.getAttribute('x')), y: Number(rect.getAttribute('y')),
      width: Number(rect.getAttribute('width')), height: Number(rect.getAttribute('height')) };
    const labels = [...svg.querySelectorAll<SVGGraphicsElement>('[data-ion-label]')].map((n) => n.getBBox());
    const points = [...svg.querySelectorAll<SVGGraphicsElement>('[data-point]')].map((n) => n.getBBox());
    const overlaps = (a: DOMRect, b: DOMRect) => a.x < b.x + b.width + 2 && a.x + a.width + 2 > b.x
      && a.y < b.y + b.height + 2 && a.y + a.height + 2 > b.y;
    return { count: labels.length, bounded: labels.every((b) => b.x >= bounds.x && b.y >= bounds.y
      && b.x + b.width <= bounds.x + bounds.width && b.y + b.height <= bounds.y + bounds.height),
      labelCollision: labels.some((b, i) => labels.slice(0, i).some((a) => overlaps(a, b))),
      pointCollision: labels.some((b) => points.some((a) => overlaps(a, b))) };
  });
  expect(result.bounded).toBe(true); expect(result.labelCollision).toBe(false); expect(result.pointCollision).toBe(false);
}
async function assertFigureBounds(root: Locator) {
  const overflow = await root.evaluate((el) => {
    const svg = el.querySelector('svg')!, { width, height } = svg.viewBox.baseVal;
    return [...svg.querySelectorAll<SVGGraphicsElement>('text')].flatMap((n) => {
      const box = n.getBBox(), matrix = svg.getCTM()!.inverse().multiply(n.getCTM()!);
      const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
      return corners.some((p) => p.x < -0.1 || p.y < -0.1 || p.x > width + 0.1 || p.y > height + 0.1) ? [n.textContent] : [];
    });
  });
  expect(overflow).toEqual([]);
}

test('paper PCA uses one chemical label per ion and keeps all true scores across visual changes', async ({ page }) => {
  await demo(page);
  const root = scores(page), m = moduleOf(page);
  await expect(root.locator('[data-ion-label]')).toHaveCount(3);
  await expect(root.locator('[data-legend], [data-axis="top"], [data-axis="right"], [data-sample-label]')).toHaveCount(0);
  await expect(root.locator('[data-ion-label="CO₃²⁻"] tspan[baseline-shift="sub"]')).toHaveText('3');
  await expect(root.locator('[data-ion-label="CO₃²⁻"] tspan[baseline-shift="super"]')).toHaveText('2−');
  const metadata = await root.locator('[data-point] title').allTextContents();
  await m.getByLabel('离子形状 Fe³⁺', { exact: true }).selectOption('triangle');
  await m.getByLabel('离子形状 CO₃²⁻', { exact: true }).selectOption('square');
  await m.getByLabel('离子颜色 Fe³⁺', { exact: true }).fill('#a12233');
  await expect(root.locator('[data-point] polygon')).toHaveCount(2);
  await expect(root.locator('[data-point] rect')).toHaveCount(2);
  await expect(root.locator('[data-point] circle')).toHaveCount(2);
  for (const font of ['Arial', 'Times New Roman', 'Perovskite Lab Sans']) {
    await m.getByLabel('字体', { exact: true }).selectOption(font);
    await m.getByLabel('字号', { exact: true }).fill('30');
    await page.evaluate(() => document.fonts.ready);
    await assertLabels(root);
    await assertFigureBounds(root);
  }
  expect(await root.locator('[data-point] title').allTextContents()).toEqual(metadata);
  await root.screenshot({ path: path.join(evidence, 'PCA-组标签与多形状-2026.10.29.png') });
});

test('horizontal tree keeps six replicas and original merge heights, with only ion formulas visible', async ({ page }) => {
  await demo(page); await selectChart(page, '层次聚类树状图');
  const root = tree(page);
  await expect(root.locator('[data-leaf]')).toHaveCount(6); await expect(root.locator('[data-merge]')).toHaveCount(5);
  await expect(root.locator('[data-legend]')).toHaveCount(0);
  const visible = await root.locator('text').allTextContents();
  expect(visible.join(' ')).not.toContain('演示-'); expect(visible.join(' ')).not.toContain('平行');
  await expect(root.locator('[data-leaf] title').first()).toContainText('样本 ID: 演示-');
  await expect(root.locator('[data-axis="bottom"]')).toContainText('Ward 合并高度');
  const geometry = await root.evaluate((el) => {
    const merges = [...el.querySelectorAll('[data-merge]')].map((n) => ({
      height: Number(n.getAttribute('data-height')), x: Number(n.querySelector('line:last-child')!.getAttribute('x1')),
      branches: [...n.querySelectorAll('line')].map((l) => ({ start: Number(l.getAttribute('x1')), end: Number(l.getAttribute('x2')) })) }));
    const axis = el.querySelector('[data-axis="bottom"] > line')!;
    const left = Number(axis.getAttribute('x1')), right = Number(axis.getAttribute('x2'));
    const height = merges.at(-1)!.height;
    return { ratios: merges.map((m) => Math.abs((m.x - left) / (right - left) - m.height / height)),
      rightward: merges.every((m) => m.branches.every((b) => b.end >= b.start)),
      strokes: [...el.querySelectorAll('[data-merge] line')].map((n) => n.getAttribute('stroke')),
      labels: [...el.querySelectorAll<SVGGraphicsElement>('[data-leaf-label]')].map((n) => { const b = n.getBBox(); return { top: b.y, bottom: b.y + b.height }; }) };
  });
  expect(Math.max(...geometry.ratios)).toBeLessThan(1e-12); expect(geometry.rightward).toBe(true);
  expect(new Set(geometry.strokes)).toEqual(new Set(['#252525']));
  geometry.labels.slice(1).forEach((box, i) => expect(box.top).toBeGreaterThan(geometry.labels[i].bottom));
  await root.screenshot({ path: path.join(evidence, 'Ward-水平树状图-2026.10.29.png') });
});

test('paired desktop layout stacks on mobile and keeps independent downloads and shared typography', async ({ page }) => {
  await demo(page);
  const m = moduleOf(page);
  await m.getByRole('button', { name: 'PCA + 聚类双图', exact: true }).click();
  const layout = page.getByTestId('recognition-chart-layout');
  await expect(layout.locator('.chart-card')).toHaveCount(2);
  const a = await scores(page).boundingBox(), b = await tree(page).boundingBox();
  expect(b!.x).toBeGreaterThan(a!.x + a!.width); expect(Math.abs(a!.y - b!.y)).toBeLessThan(10);
  const panels = layout.locator('.chart-layout');
  await panels.first().getByRole('button', { name: '样式', exact: true }).click();
  await panels.first().getByLabel('字体', { exact: true }).selectOption('Times New Roman');
  await panels.first().getByLabel('字号', { exact: true }).fill('20');
  await expect(tree(page).locator('svg')).toHaveAttribute('font-family', /Times New Roman/);
  await expect(tree(page).locator('[data-leaf-label]').first()).toHaveAttribute('font-size', '20');
  await panels.first().getByRole('button', { name: '样式', exact: true }).click();
  await layout.screenshot({ path: path.join(evidence, '双图-桌面端-2026.10.29.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350); // Let the existing sidebar's responsive transition finish before visual QA.
  const mobileA = await scores(page).boundingBox(), mobileB = await tree(page).boundingBox();
  expect(Math.abs(mobileA!.x - mobileB!.x)).toBeLessThan(2); expect(mobileB!.y).toBeGreaterThan(mobileA!.y + mobileA!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await assertLabels(scores(page));
  await assertFigureBounds(scores(page));
  await layout.screenshot({ path: path.join(evidence, '双图-移动端-2026.10.29.png') });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1') || '{}').recognition?.settings.chartLayout)).toBe('paired');
  await page.reload(); await expect(scores(page)).toBeVisible(); await expect(tree(page)).toBeVisible();
  await selectChart(page, 'PCA 载荷图'); await expect(page.getByTestId('recognition-loadings-chart').locator('[data-point]')).toHaveCount(3);
  await expect(tree(page)).toHaveCount(0);
  await selectChart(page, '响应热图与树状图'); await expect(page.getByTestId('recognition-heatmap-chart').locator('[data-heat-row]')).toHaveCount(18);
});

test('crowded scores, large fonts and long labels remain bounded without collisions', async ({ page }) => {
  await demo(page);
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem('perovskite-lab-workspace-v1'))).toBe(true);
  await page.evaluate(() => {
    const w = JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!), d = w.recognition;
    const ions = ['Fe3+', 'CO3^2-', 'NH4+', 'SO4^{2-}', 'Cu²⁺', 'Al³⁺', 'Ca²⁺', 'Zn²⁺', 'Na⁺', 'K⁺', 'Mg²⁺', 'Cd²⁺'];
    d.rows = ions.flatMap((ion, i) => [0, 1, 2].map((rep) => ({ ...d.rows[0], id: `stress-${i}-${rep}`, sample: `long-sample-identifier-${i}`, ion,
      replicate: String(rep + 1), values: { 'probe-1': String(0.2 + i * 0.00001 + rep * 0.000001),
        'probe-2': String(0.3 + Math.sin(i) * 0.0001 + rep * 0.000001), 'probe-3': String(0.4 + Math.cos(i) * 0.0001 + rep * 0.000002) } })));
    d.settings.styles.scores.fontSize = 30;
    d.settings.styles.scores.fontFamily = 'Times New Roman';
    localStorage.setItem('perovskite-lab-workspace-v1', JSON.stringify(w));
  });
  await page.reload();
  await expect(scores(page).locator('[data-point]')).toHaveCount(36);
  await expect(scores(page).locator('[data-ion-label]')).toHaveCount(12);
  await assertLabels(scores(page));
  await scores(page).screenshot({ path: path.join(evidence, 'PCA-密集标签避让-2026.10.29.png') });
  await selectChart(page, '层次聚类树状图');
  await moduleOf(page).getByLabel('字体', { exact: true }).selectOption('Perovskite Lab Sans');
  const leaves = await tree(page).locator('[data-leaf-label]').evaluateAll((els) => els.map((n) => {
    const box = (n as SVGGraphicsElement).getBBox(); return { top: box.y, bottom: box.y + box.height };
  }));
  leaves.slice(1).forEach((box, i) => expect(box.top).toBeGreaterThan(leaves[i].bottom));
  await assertFigureBounds(tree(page));
});

test('SVG geometry equals the preview and PNG pixels equal the exported SVG raster', async ({ page }) => {
  await demo(page);
  const comparisons: { chart: string; sameGeometry: boolean; changedFraction: number }[] = [];
  for (const [name, id] of [['PCA 得分图', 'scores'], ['层次聚类树状图', 'tree']]) {
    await selectChart(page, name);
    const root = page.getByTestId(`recognition-${id}-chart`), panel = root.locator('xpath=ancestor::section[contains(@class,"chart-card")]');
    const preview = await root.locator('svg').evaluate((el) => el.outerHTML);
    const downloads: Record<string, Buffer> = {};
    for (const format of ['SVG', 'PNG']) {
      const event = page.waitForEvent('download');
      await panel.getByRole('button', { name: format, exact: true }).click();
      const download = await event, file = path.join(evidence, download.suggestedFilename());
      expect(download.suggestedFilename()).toMatch(/v0\.9\.2-\d{4}\.\d{1,2}\.\d{1,2}\./);
      await download.saveAs(file); downloads[format] = readFileSync(file);
    }
    const result = await page.evaluate(async ({ preview, exported, png }) => {
      const parser = new DOMParser(), before = parser.parseFromString(preview, 'image/svg+xml'), after = parser.parseFromString(exported, 'image/svg+xml');
      after.querySelector('defs style')?.remove();
      const sameGeometry = new XMLSerializer().serializeToString(before) === new XMLSerializer().serializeToString(after);
      const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src;
      });
      const svgURL = URL.createObjectURL(new Blob([exported], { type: 'image/svg+xml' }));
      try {
        const [actual, expected] = await Promise.all([load(`data:image/png;base64,${png}`), load(svgURL)]);
        const canvas = document.createElement('canvas'); canvas.width = actual.width; canvas.height = actual.height;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(actual, 0, 0);
        const actualPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(expected, 0, 0, canvas.width, canvas.height);
        const expectedPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let changed = 0;
        for (let i = 0; i < actualPixels.length; i++) if (Math.abs(actualPixels[i] - expectedPixels[i]) > 2) changed++;
        return { sameGeometry, changedFraction: changed / actualPixels.length };
      } finally { URL.revokeObjectURL(svgURL); }
    }, { preview, exported: downloads.SVG.toString(), png: downloads.PNG.toString('base64') });
    expect(result.sameGeometry).toBe(true); expect(result.changedFraction).toBeLessThan(0.00001);
    comparisons.push({ chart: id, ...result });
  }
  writeFileSync(path.join(evidence, '导出一致性-v0.9.2-2026.10.29.json'), JSON.stringify({ comparisons,
    channelTolerance: 2, maximumChangedChannelFraction: 0.00001 }, null, 2));
});
