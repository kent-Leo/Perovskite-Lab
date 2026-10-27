import { test, expect } from '@playwright/test';

const charts = [
  { route: '/', kind: 'spectra' },
  { route: '/#screening', kind: 'screening' },
  { route: '/#calibration', kind: 'calibration' },
] as const;

for (const { route, kind } of charts) {
  test(`${kind}: legend can be dragged freely, its font size is adjustable and both persist`, async ({
    page,
  }) => {
    await page.goto(route);
    const chart = page.getByTestId(`${kind}-chart`);
    await page.getByLabel('图例位置', { exact: true }).selectOption('free');
    const legend = chart.locator('[data-legend]');
    await expect(legend).toHaveCount(1);
    await expect(page.getByLabel('图例位置', { exact: true })).toHaveValue('free');

    await page.getByLabel('图例字号', { exact: true }).fill('22');
    await expect(legend.locator('text').first()).toHaveAttribute('font-size', '22');
    await chart.scrollIntoViewIfNeeded();

    const before = {
      x: Number(await legend.getAttribute('data-legend-x')),
      y: Number(await legend.getAttribute('data-legend-y')),
    };
    const svg = await chart.locator('svg').boundingBox();
    const box = await legend.boundingBox();
    expect(svg).not.toBeNull();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 24, box!.y + 12);
    await page.mouse.down();
    await page.mouse.move(svg!.x + svg!.width * 0.26, svg!.y + svg!.height * 0.72, {
      steps: 6,
    });
    await page.mouse.up();
    await page.waitForTimeout(120);

    const after = {
      x: Number(await legend.getAttribute('data-legend-x')),
      y: Number(await legend.getAttribute('data-legend-y')),
    };
    expect(after.x).not.toBe(before.x);
    expect(after.x).toBeGreaterThan(0.15);
    expect(after.x).toBeLessThan(0.36);
    expect(after.y).toBeGreaterThan(0.5);

    await page.waitForTimeout(650);
    const stored = await page.evaluate(
      (kind) => JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1')!).styles[kind],
      kind,
    );
    expect(stored.legend).toBe('free');
    expect(stored.legendFontSize).toBe(22);
    expect(stored.legendX).toBeCloseTo(after.x, 3);
    expect(stored.legendY).toBeCloseTo(after.y, 3);

    await page.reload();
    await expect(page.getByLabel('图例位置', { exact: true })).toHaveValue('free');
    await expect(page.getByLabel('图例字号', { exact: true })).toHaveValue('22');
    await expect(chart.locator('[data-legend]')).toHaveCount(1);
    await expect(chart.locator('[data-legend] text').first()).toHaveAttribute('font-size', '22');
  });
}

test('legend presets still render and the free position inputs clamp to the canvas', async ({
  page,
}) => {
  await page.goto('/');
  const chart = page.getByTestId('spectra-chart');
  for (const mode of ['bottom', 'right', 'none']) {
    await page.getByLabel('图例位置', { exact: true }).selectOption(mode);
    await expect(chart.locator('[data-legend]')).toHaveCount(mode === 'none' ? 0 : 1);
  }
  await page.getByLabel('图例位置', { exact: true }).selectOption('free');
  await page.getByLabel('图例 X / %', { exact: true }).fill('150');
  await page.getByLabel('图例 Y / %', { exact: true }).fill('150');
  const legend = chart.locator('[data-legend]');
  const x = Number(await legend.getAttribute('data-legend-x')),
    y = Number(await legend.getAttribute('data-legend-y'));
  expect(x).toBeGreaterThan(0.5);
  expect(x).toBeLessThan(1);
  expect(y).toBeGreaterThan(0.5);
  expect(y).toBeLessThan(1);
});
