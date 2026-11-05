import type { ChartStyle } from '../domain/types';
import type { PDFFont } from 'pdf-lib';
import { pdfFonts, svgExportFonts } from '../domain/chart-fonts-2026.11.3';
import { downloadBlob, filename } from './download';
const svgFontData = new Map<string, Promise<string>>();
const rasterFonts = new Map<string, Promise<void>>();
async function embeddedFontData({ family, file }: { family: string; file: string }) {
  let pending = svgFontData.get(family);
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}fonts/${file}.woff`).then(
      async (r) => {
        if (!r.ok) throw new Error('导出字体读取失败');
        const blob = new Blob([await r.arrayBuffer()], { type: 'font/woff' });
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('字体编码失败'));
          reader.readAsDataURL(blob);
        });
      },
    ).catch((error) => { svgFontData.delete(family); throw error; });
    svgFontData.set(family, pending);
  }
  return { family, font: await pending };
}
async function portableSVG(svg: string, style: ChartStyle) {
  const selected = svgExportFonts(style, /[^\x00-\x7f]/.test(svg));
  if (!selected.length) return { svg, fonts: [] };
  const fonts = await Promise.all(selected.map(embeddedFontData));
  return {
    svg: svg.replace(
      '<defs>',
      `<defs><style>${fonts.map(({ family, font }) => `@font-face{font-family:'${family}';src:url('${font}') format('woff')}`).join('')}</style>`,
    ),
    fonts,
  };
}
// Chromium snapshots an SVG loaded through <img> before its data-URI @font-face
// finishes loading, so the first PNG of a page loses every glyph that needs the
// embedded font (chart title, Chinese legend labels). Loading the very same font
// data in the page first makes the image use the cached font on its first paint.
function warmRasterFont(family: string, font: string) {
  let pending = rasterFonts.get(family);
  if (!pending) {
    pending = (async () => {
      try {
        const face = new FontFace(`${family} Export`, `url('${font}') format('woff')`);
        await face.load();
        document.fonts.add(face);
      } catch {
        // Keep the extra animation frame below as the fallback for browsers that
        // cannot preload the export font.
      }
    })();
    rasterFonts.set(family, pending);
  }
  return pending;
}
// Wait for the raster to settle. requestAnimationFrame stops firing in hidden
// tabs, so fall back to a timer instead of hanging the export forever.
const nextPaint = () =>
  new Promise<void>((resolve) => {
    let settled = false,
      timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    timer = setTimeout(finish, 250);
  });
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export async function pngDPI(blob: Blob, dpi: number) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunk = new Uint8Array(21),
    v = new DataView(chunk.buffer);
  v.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4);
  v.setUint32(8, Math.round(dpi / 0.0254));
  v.setUint32(12, Math.round(dpi / 0.0254));
  chunk[16] = 1;
  v.setUint32(17, crc32(chunk.slice(4, 17)));
  const parts: BlobPart[] = [bytes.slice(0, 33), chunk];
  let pos = 33;
  while (pos < bytes.length) {
    const len = new DataView(bytes.buffer).getUint32(pos),
      type = new TextDecoder().decode(bytes.slice(pos + 4, pos + 8));
    if (type !== 'pHYs') parts.push(bytes.slice(pos, pos + 12 + len));
    pos += 12 + len;
  }
  return new Blob(parts, { type: 'image/png' });
}
export async function exportChart(
  svg: string,
  format: 'png' | 'svg' | 'pdf',
  style: ChartStyle,
  name: string,
) {
  let embeddedFonts: { family: string; font: string }[] = [];
  if (format !== 'pdf') {
    const portable = await portableSVG(svg, style);
    svg = portable.svg;
    embeddedFonts = portable.fonts;
  }
  if (format === 'svg') {
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), filename(name, 'svg'));
    return;
  }
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml'),
    root = doc.documentElement,
    W = Number(root.getAttribute('width')),
    H = Number(root.getAttribute('height'));
  if (format === 'png') {
    await Promise.all(embeddedFonts.map(({ family, font }) => warmRasterFont(family, font)));
    await document.fonts.ready;
    const img = new Image(),
      url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('图像渲染失败'));
        img.src = url;
      });
      // Give the image one paint to resolve its embedded font before rasterizing.
      await nextPaint();
      const width = Math.round((style.widthCm / 2.54) * style.dpi),
        height = Math.round((width * H) / W);
      if (width * height > 40_000_000) throw new Error('导出尺寸过大，请减小图宽');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('浏览器不支持画布');
      ctx.drawImage(img, 0, 0, width, height);
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG 导出失败'))), 'image/png'),
      );
      downloadBlob(await pngDPI(blob, style.dpi), filename(name, 'png'));
    } finally {
      URL.revokeObjectURL(url);
    }
    return;
  }
  const [pdf, fontkit] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit')]);
  const fontBytes = await Promise.all(pdfFonts(style).map(async ({ file }) => {
    const response = await fetch(`${import.meta.env.BASE_URL}fonts/${file}.ttf`);
    if (!response.ok) throw new Error('PDF 字体读取失败，请通过本地服务器打开网页');
    return response.arrayBuffer();
  }));
  const documentPDF = await pdf.PDFDocument.create();
  documentPDF.registerFontkit(fontkit.default);
  const fonts: { font: PDFFont; characters: Set<number> }[] = [];
  for (const bytes of fontBytes) {
    const font = await documentPDF.embedFont(bytes, { subset: false });
    fonts.push({ font, characters: new Set(font.getCharacterSet()) });
  }
  const textRuns = (content: string) => {
    const runs: { font: PDFFont; text: string }[] = [];
    for (const character of content) {
      const { font } = fonts.find(({ characters }) => characters.has(character.codePointAt(0)!)) ?? fonts[fonts.length - 1];
      const last = runs.at(-1);
      if (last?.font === font) last.text += character;
      else runs.push({ font, text: character });
    }
    return runs;
  };
  const scale = ((style.widthCm / 2.54) * 72) / W,
    page = documentPDF.addPage([W * scale, H * scale]);
  const num = (el: Element, a: string, d = 0) => Number(el.getAttribute(a) ?? d);
  const color = (s: string | null) => {
    if (!s || s === 'none') return undefined;
    const h = s.replace('#', '');
    return pdf.rgb(
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    );
  };
  function draw(el: Element) {
    const tag = el.tagName;
    if (tag === 'defs' || tag === 'clipPath') return;
    const clipped = el.getAttribute('clip-path');
    if (clipped) {
      const rect = root.querySelector('clipPath rect')!;
      page.pushOperators(
        pdf.pushGraphicsState(),
        pdf.rectangle(
          num(rect, 'x') * scale,
          (H - num(rect, 'y') - num(rect, 'height')) * scale,
          num(rect, 'width') * scale,
          num(rect, 'height') * scale,
        ),
        pdf.clip(),
        pdf.endPath(),
      );
    }
    if (tag === 'rect') {
      // Unfilled rects are transparent legend drag hit areas. pdf-lib would leave
      // their path unpainted, and because q/Q do not reset the current path the
      // next legend stroke outlines them as colored boxes. Skip them entirely.
      const fill = color(el.getAttribute('fill'));
      if (fill)
        page.drawRectangle({
          x: num(el, 'x') * scale,
          y: (H - num(el, 'y') - num(el, 'height')) * scale,
          width: num(el, 'width') * scale,
          height: num(el, 'height') * scale,
          color: fill,
        });
    }
    if (tag === 'line' || tag === 'polyline') {
      const pts =
        tag === 'line'
          ? [
              [num(el, 'x1'), num(el, 'y1')],
              [num(el, 'x2'), num(el, 'y2')],
            ]
          : el
              .getAttribute('points')!
              .split(' ')
              .map((s) => s.split(',').map(Number));
      for (let i = 1; i < pts.length; i++)
        page.drawLine({
          start: { x: pts[i - 1][0] * scale, y: (H - pts[i - 1][1]) * scale },
          end: { x: pts[i][0] * scale, y: (H - pts[i][1]) * scale },
          color: color(el.getAttribute('stroke')),
          thickness: num(el, 'stroke-width', 1) * scale,
          dashArray: el.hasAttribute('stroke-dasharray')
            ? el
                .getAttribute('stroke-dasharray')!
                .split(' ')
                .map((n) => Number(n) * scale)
            : undefined,
        });
    }
    if (tag === 'circle')
      page.drawCircle({
        x: num(el, 'cx') * scale,
        y: (H - num(el, 'cy')) * scale,
        size: num(el, 'r') * scale,
        color: color(el.getAttribute('fill')),
      });
    if (tag === 'text') {
      const size = num(el, 'font-size', 16) * scale,
        anchor = el.getAttribute('text-anchor'),
        // 逐个文本节点取字号与基线偏移：化学式上下标（baseline-shift）在 PDF 里
        // 也要真正抬高 / 降低，而不是当成普通文本画在同一条基线上。
        pieces: { text: string; size: number; shift: number }[] = [];
      const collect = (node: Node, base: number, shift: number) => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === 3) {
            const value = child.nodeValue ?? '';
            if (value) pieces.push({ text: value, size: base, shift });
            continue;
          }
          if (child.nodeType !== 1) continue;
          const element = child as Element,
            relative = element.getAttribute('font-size'),
            childSize = relative?.endsWith('%')
              ? (base * Number(relative.slice(0, -1))) / 100
              : relative
                ? Number(relative) * scale
                : base,
            baseline = element.getAttribute('baseline-shift');
          collect(
            element,
            childSize,
            baseline === 'super' ? shift + base * 0.32 : baseline === 'sub' ? shift - base * 0.16 : shift,
          );
        }
      };
      collect(el, size, 0);
      const runs = pieces.flatMap((piece) =>
        textRuns(piece.text).map((run) => ({ ...run, size: piece.size, shift: piece.shift })),
      );
      const width = runs.reduce(
        (sum, run) => sum + run.font.widthOfTextAtSize(run.text, run.size),
        0,
      );
      const offset = anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0;
      const angle = Number(el.getAttribute('transform')?.match(/rotate\(([-\d.]+)/)?.[1] ?? 0),
        r = (-angle * Math.PI) / 180;
      let advance = -offset;
      for (const run of runs) {
        page.drawText(run.text, {
          font: run.font,
          size: run.size,
          // 基线偏移沿文字自身的“上”方向：旋转后仍然垂直于排版基线。
          x: num(el, 'x') * scale + advance * Math.cos(r) + run.shift * Math.sin(r),
          y: (H - num(el, 'y')) * scale + advance * Math.sin(r) + run.shift * Math.cos(r),
          color: color(el.getAttribute('fill')),
          rotate: pdf.degrees(-angle),
        });
        advance += run.font.widthOfTextAtSize(run.text, run.size);
      }
    }
    for (const child of el.children) draw(child);
    if (clipped) page.pushOperators(pdf.popGraphicsState());
  }
  draw(root);
  const bytes = await documentPDF.save();
  downloadBlob(
    new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
    filename(name, 'pdf'),
  );
}
