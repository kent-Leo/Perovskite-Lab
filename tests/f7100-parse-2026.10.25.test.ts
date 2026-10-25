import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeSpectrumBytes,
  detectSpectrumDelimiter,
  parseSpectrumBytes,
  parseSpectrumText,
  readSpectrumFile,
} from '../src/services/f7100-2026.10.25';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.resolve('tests/fixtures', name)));
const text = (name: string) => new TextDecoder().decode(fixture(name));

describe('F-7100 文本解析', () => {
  it('extracts metadata and the Data points block while ignoring the Peaks table', () => {
    const parsed = parseSpectrumBytes(fixture('f7100-emission-utf8.txt'), '样品A(FDS).TXT');
    expect(parsed.format).toBe('f7100-emission');
    expect(parsed.encoding).toBe('utf-8');
    expect(parsed.delimiter).toBe('\t');
    expect(parsed.metadata.instrument).toContain('F-7100');
    expect(parsed.metadata.excitationNm).toBe(360);
    expect(parsed.metadata.emStartNm).toBe(400);
    expect(parsed.metadata.emEndNm).toBe(410);
    expect(parsed.metadata.measuredOn).toBe('2026-10-23');
    expect(parsed.metadata.scanMode).toBe('Emission');
    expect(parsed.metadata.peaks).toHaveLength(1);
    const lines = text('f7100-emission-utf8.txt').split(/\r?\n/);
    expect(parsed.headerLine).toBe(lines.indexOf('nm\tData') + 1);
    expect(parsed.dataStartLine).toBe(parsed.headerLine! + 1);
    expect(parsed.columns).toEqual({ wavelength: 0, intensity: 1 });
    expect(parsed.points).toHaveLength(11);
    expect(parsed.points[0]).toEqual({ x: 400, y: 1 });
    expect(parsed.points[5]).toEqual({ x: 405, y: 100 });
    expect(parsed.rowNumbers[0]).toBe(parsed.dataStartLine);
    expect(parsed.rowNumbers.at(-1)).toBe(parsed.dataStartLine + 10);
    expect(parsed.skippedRows).toBe(0);
    // The 4-row Peaks table must never become the data block.
    expect(parsed.points.some((point) => point.y === 2.22)).toBe(false);
  });

  it('auto-detects GB18030 Chinese metadata and keeps the original sample name', () => {
    const parsed = parseSpectrumBytes(fixture('f7100-emission-gb18030.txt'), '样品A(FDS).TXT');
    expect(parsed.encoding).toBe('gb18030');
    expect(parsed.metadata.sample).toBe('样品A');
    expect(parsed.points).toHaveLength(11);
    expect(parsed.warnings.join('\n')).not.toContain('Windows-1252');
  });

  it('decodes UTF-16LE and explicit encodings without corrupting the header', () => {
    const source = text('f7100-emission-utf8.txt');
    const encoded = new Uint8Array(source.length * 2 + 2);
    encoded[0] = 0xff;
    encoded[1] = 0xfe;
    for (let i = 0; i < source.length; i++) {
      const code = source.charCodeAt(i);
      encoded[2 + i * 2] = code & 0xff;
      encoded[3 + i * 2] = code >> 8;
    }
    const decoded = decodeSpectrumBytes(encoded);
    expect(decoded.encoding).toBe('utf-16le');
    expect(decoded.text).toContain('Data points');
    expect(decodeSpectrumBytes(fixture('f7100-emission-gb18030.txt'), 'gb18030').text).toContain(
      '样品A',
    );
    expect(() => decodeSpectrumBytes(fixture('f7100-emission-gb18030.txt'), 'utf-8')).toThrow(
      '无法按 utf-8 解码',
    );
  });

  it('refuses 3-D EEM exports instead of guessing one excitation slice', () => {
    expect(() => parseSpectrumBytes(fixture('f7100-eem-utf8.txt'), '3D(FD3).TXT')).toThrow(
      '三维 EEM',
    );
  });

  it('parses generic CSV tables and supports manual data-row/column correction', () => {
    const generic = text('generic-spectrum.csv');
    const parsed = parseSpectrumText(generic, 'generic-spectrum.csv');
    expect(parsed.format).toBe('generic-table');
    expect(parsed.delimiter).toBe(',');
    expect(parsed.points).toEqual([
      { x: 500, y: 10 },
      { x: 510, y: 20 },
      { x: 520, y: 15 },
    ]);
    const f7100 = text('f7100-emission-utf8.txt');
    const auto = parseSpectrumText(f7100, 'manual.txt');
    const manual = parseSpectrumText(f7100, 'manual.txt', {
      dataStartLine: auto.dataStartLine,
      wavelengthColumn: 0,
      intensityColumn: 1,
    });
    expect(manual.format).toBe('generic-table');
    expect(manual.points).toHaveLength(11);
    expect(manual.metadata.excitationNm).toBe(360);
  });

  it('reports skipped non-numeric/duplicate rows and never silently changes the wavelength axis', () => {
    const broken = `nm\tData\n400\t1\n401\t2\n401\t99\n402\tbad\n403\t4\n404\t5\n405\t6\n`;
    const parsed = parseSpectrumText(broken, 'broken.csv');
    expect(parsed.points.map((point) => point.x)).toEqual([400, 401, 403, 404, 405]);
    expect(parsed.skippedRows).toBe(2);
    expect(parsed.warnings.join('\n')).toContain('跳过 2 行');
    expect(parsed.warnings.join('\n')).toContain('未严格递增');
    expect(parsed.warnings.join('\n')).toContain('强度不是数值');
  });

  it('keeps reading measured rows after an internal blank line instead of silently truncating', () => {
    const withBlank = `nm\tData\n400\t1\n401\t2\n402\t3\n\n403\t4\n404\t5\n405\t6\n`;
    const parsed = parseSpectrumText(withBlank, 'blank-lines.csv');
    expect(parsed.points.map((point) => point.x)).toEqual([400, 401, 402, 403, 404, 405]);
    expect(parsed.warnings.join('\n')).toContain('检测到空行');
  });

  it('rejects files with no recognizable data block and gives an actionable error', () => {
    expect(() => parseSpectrumText('Sample: foo\nOnly prose\n', 'bad.txt')).toThrow('未能识别光谱数据');
    expect(() => parseSpectrumText('', 'empty.txt')).toThrow('文件为空');
    const withoutData = text('f7100-emission-utf8.txt')
      .split('Data points')[0]
      .replace('Model:\tF-7100 FL Spectrophotometer', 'Model:\tF-7100 FL Spectrophotometer');
    expect(() => parseSpectrumText(withoutData, 'no-data.TXT')).toThrow('未找到 “Data points”');
  });

  it('requires text formats and enforces the upload size limit', async () => {
    const pdf = new File([new Uint8Array([1, 2, 3])], 'sample.pdf');
    await expect(readSpectrumFile(pdf)).rejects.toThrow('支持 F-7100 TXT');
    const huge = new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'huge.txt');
    await expect(readSpectrumFile(huge)).rejects.toThrow('超过 20 MB');
  });

  it('detects the delimiter from numeric rows instead of metadata prose', () => {
    expect(detectSpectrumDelimiter(['Sample:\tname', '200.0\t1.0', '201.0\t2.0'])).toBe('\t');
    expect(detectSpectrumDelimiter(['wavelength,intensity', '200.0,1.0', '201.0,2.0'])).toBe(',');
    expect(detectSpectrumDelimiter(['200.0 1.0', '201.0 2.0', '202.0 3.0'])).toBe('space');
  });
});
