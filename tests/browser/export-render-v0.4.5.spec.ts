import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

// Regression tests for the two v0.4.4 export-rendering bugs:
// 1. Chromium rasterized the exported SVG before its data-URI @font-face was
//    ready, so the *first* PNG of a page lost every glyph that needed the
//    embedded font (the Chinese chart title, Chinese legend labels).
// 2. pdf-lib drew the transparent legend drag hit rects (fill="none") as
//    unpainted closed paths; because q/Q do not reset the current path, the
//    next legend line's S operator outlined them with a colored border.
//
// IMPORTANT: the PNG case must stay the *first* test in this file (and keep
// exporting as the first action of a fresh page), otherwise the font is
// already cached and the "first rasterization" regression cannot be caught.

const CHART_TITLE = '荧光光谱导出验证';
const FIGURE_WIDTH_CM = 16;
const FIGURE_DPI = 300;
const PNG_PIXELS_PER_METER = Math.round(FIGURE_DPI / 0.0254);
const PNG_WIDTH_PX = Math.round((FIGURE_WIDTH_CM / 2.54) * FIGURE_DPI);
const PDF_WIDTH_PT = (FIGURE_WIDTH_CM / 2.54) * 72;

const PATH_CONSTRUCTION_OPS = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're']);
const PATH_PAINT_OPS = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);

async function downloadChart(page: Page, format: 'PNG' | 'PDF' | 'SVG', path: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: format, exact: true }).click();
  const download = await pending;
  await download.saveAs(path);
  expect(download.suggestedFilename().toLowerCase()).toMatch(
    new RegExp(`\\.${format.toLowerCase()}$`),
  );
  return readFile(path);
}

async function countTopStripDarkPixels(page: Page, png: Buffer) {
  const encoded = png.toString('base64');
  return page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建画布');
      context.drawImage(bitmap, 0, 0);
      // The title lives in the top 10% of the figure; ignore the outer 15% so
      // that axis labels and the legend can never satisfy the assertion.
      const rows = Math.max(1, Math.floor(bitmap.height * 0.1));
      const startX = Math.floor(bitmap.width * 0.15);
      const endX = Math.floor(bitmap.width * 0.85);
      const pixels = context.getImageData(0, 0, bitmap.width, rows).data;
      let dark = 0;
      for (let y = 0; y < rows; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const i = (y * bitmap.width + x) * 4;
          if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 450) dark += 1;
        }
      }
      return { dark, width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }, encoded);
}

function pdfPageContentText(doc: PDFDocument) {
  const contents = doc.getPage(0).node.Contents();
  const items = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return items
    .map((item) => {
      const resolved = doc.context.lookup(item);
      if (resolved instanceof PDFRawStream)
        return new TextDecoder('latin1').decode(decodePDFRawStream(resolved).decode());
      throw new Error('无法解析 PDF 内容流');
    })
    .join('\n');
}

// Count closed paths that are never painted before the enclosing graphics state
// is popped (the old legend-border bug). q/Q do not reset the current path in the
// PDF spec, so an unpainted legend hit rect gets stroked by the next S operator.
function countUnpaintedClosedPaths(content: string) {
  let path: string[] = [];
  let unpainted = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const op = line.split(/\s+/).pop() as string;
    if (PATH_CONSTRUCTION_OPS.has(op)) path.push(op);
    else if (PATH_PAINT_OPS.has(op)) path = [];
    else if (line === 'Q') {
      if (path.length > 0 && path[path.length - 1] === 'h') unpainted += 1;
      // Track one candidate per graphics-state scope: the leaked path must not
      // be counted again at an unrelated later Q.
      path = [];
    }
  }
  return unpainted;
}

test('first PNG export keeps the Chinese chart title and 300 DPI metadata', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const chart = page.getByTestId('spectra-chart');
  await expect(chart).toBeVisible();
  await page.getByLabel('图表标题', { exact: true }).fill(CHART_TITLE);
  await expect(chart).toContainText(CHART_TITLE);

  // First export of a fresh page: this is the exact situation where Chromium
  // used to snapshot the SVG before its embedded font had loaded (title/legend
  // text missing). Do not export anything before this point.
  const png = await downloadChart(page, 'PNG', testInfo.outputPath('首次PNG导出-荧光光谱.png'));

  expect(png.subarray(1, 4).toString()).toBe('PNG');
  // IHDR width at byte 16, pHYs resolution right after the pHYs chunk type.
  expect(png.readUInt32BE(16)).toBe(PNG_WIDTH_PX);
  const phys = png.indexOf('pHYs');
  expect(phys).toBeGreaterThan(0);
  expect(png.readUInt32BE(phys + 4)).toBe(PNG_PIXELS_PER_METER);
  expect(png.readUInt32BE(phys + 8)).toBe(PNG_PIXELS_PER_METER);

  const { dark, width } = await countTopStripDarkPixels(page, png);
  expect(width).toBe(PNG_WIDTH_PX);
  // Before the fix the first PNG had 0 dark pixels in the title strip.
  expect(dark).toBeGreaterThan(200);
});

test('PDF export leaves no unpainted closed path for the draggable legend rows', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const chart = page.getByTestId('spectra-chart');
  await expect(chart).toBeVisible();
  // Match the reported scenario: a free-positioned legend. Every legend row
  // still gets a transparent drag hit rect (fill="none") before its line.
  await page.getByLabel('图例位置', { exact: true }).selectOption('free');
  await page.getByLabel('图例 X / %', { exact: true }).fill('88');
  await page.getByLabel('图例 Y / %', { exact: true }).fill('16');
  await expect(chart.locator('[data-legend]')).toHaveCount(1);

  const pdfBytes = await downloadChart(page, 'PDF', testInfo.outputPath('自由图例-荧光光谱.pdf'));
  expect(pdfBytes.subarray(0, 4).toString()).toBe('%PDF');
  const doc = await PDFDocument.load(pdfBytes);
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getPage(0).getWidth()).toBeCloseTo(PDF_WIDTH_PT, 1);

  const content = pdfPageContentText(doc);
  expect(content.length).toBeGreaterThan(1000);
  // The legend line strokes are still there; only the leaked rects are gone.
  expect(content).toMatch(/(^|\n)S(\n|$)/);
  // Before the fix this was the number of legend items (6 for the sample data).
  expect(countUnpaintedClosedPaths(content)).toBe(0);
});

test('SVG export still carries the chart title and the draggable legend group', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const chart = page.getByTestId('spectra-chart');
  await expect(chart).toBeVisible();
  await page.getByLabel('图表标题', { exact: true }).fill(CHART_TITLE);
  await expect(chart).toContainText(CHART_TITLE);

  const svg = (
    await downloadChart(page, 'SVG', testInfo.outputPath('荧光光谱导出.svg'))
  ).toString('utf8');
  expect(svg).toContain(CHART_TITLE);
  expect(svg).toContain('data-legend');
  // The export must stay self-contained so the Chinese glyphs render offline.
  expect(svg).toContain('@font-face');
  expect(svg).toContain('data:font/woff;base64,');
});
