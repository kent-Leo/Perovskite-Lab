import { numeric } from '../domain/math';
import type { Point } from '../domain/types';

/**
 * Parses single-scan Hitachi F-7100 TXT exports and generic two-column text
 * tables. It deliberately refuses 3-D/EEM exports instead of guessing a slice.
 */

export type SpectrumEncoding =
  | 'auto'
  | 'utf-8'
  | 'gb18030'
  | 'shift_jis'
  | 'utf-16le'
  | 'utf-16be'
  | 'windows-1252';

export type SpectrumDelimiter = 'auto' | '\t' | ',' | ';' | '|' | 'space';

export interface F7100Peak {
  no: number;
  startNm: number | null;
  apexNm: number | null;
  endNm: number | null;
  height: string;
  valleyNm: number | null;
  valleyData: number | null;
}

export interface SpectrumMetadata {
  sample: string;
  fileName: string;
  runDate: string;
  measuredOn: string;
  operator: string;
  comment: string;
  instrument: string;
  serial: string;
  romVersion: string;
  measurementType: string;
  scanMode: string;
  dataMode: string;
  excitationNm: number | null;
  emStartNm: number | null;
  emEndNm: number | null;
  exSlitNm: number | null;
  emSlitNm: number | null;
  scanSpeed: string;
  pmtVoltage: string;
  response: string;
  correctedSpectra: string;
  peaks: F7100Peak[];
  extra: Record<string, string>;
}

export interface SpectrumParseOptions {
  encoding?: SpectrumEncoding;
  delimiter?: SpectrumDelimiter;
  /** First measured data row (1-based). Overrides automatic data-block detection. */
  dataStartLine?: number;
  /** Zero-based column containing wavelength (nm). */
  wavelengthColumn?: number;
  /** Zero-based column containing fluorescence intensity. */
  intensityColumn?: number;
}

export interface ParsedSpectrumFile {
  fileName: string;
  format: 'f7100-emission' | 'generic-table';
  encoding: Exclude<SpectrumEncoding, 'auto'>;
  delimiter: Exclude<SpectrumDelimiter, 'auto'>;
  metadata: SpectrumMetadata;
  points: Point[];
  /** Source line number (1-based) for every point. */
  rowNumbers: number[];
  headerLine: number | null;
  dataStartLine: number;
  columns: { wavelength: number; intensity: number };
  totalLines: number;
  dataRows: number;
  skippedRows: number;
  warnings: string[];
  /** Decoded text is retained so a manual correction can re-parse without re-reading the file. */
  text: string;
}

export interface DecodedSpectrumText {
  text: string;
  encoding: Exclude<SpectrumEncoding, 'auto'>;
  warnings: string[];
}

const HEADER_KEYS = [
  'sample',
  'file name',
  'run date',
  'operator',
  'comment',
  'model',
  'serial number',
  'rom version',
  'measurement type',
  'scan mode',
  'data mode',
  'ex wl',
  'em  start wl',
  'em start wl',
  'em  end wl',
  'em end wl',
  'ex  start wl',
  'ex start wl',
  'ex  end wl',
  'ex end wl',
  'ex sampling interval',
  'em sampling interval',
  'scan speed',
  'delay',
  'ex slit',
  'em slit',
  'pmt voltage',
  'response',
  'corrected spectra',
  'shutter control',
  'threshold',
  'sensitivity',
  'integration method',
] as const;

const WAVE_HEADER = /^(?:nm|λ|wavelength(?:\s*\(nm\))?|wave\s*length|波长(?:\s*\/?\s*nm)?|发射波长)$/i;
const INTENSITY_HEADER =
  /^(?:data|f|i|pl|intensity|fluorescence(?:\s*intensity)?|荧光强度|强度|信号|counts?)(?:\s*[/(（].*)?$/i;
const DATA_ANCHOR = /^\s*Data\s+points\b/i;
const EEM_MARKER = /(?:3\s*-\s*d\s*scan|3d\s*scan|three[-\s]*dimensional|三维|3\s*维)/i;

function cleanValue(value: string) {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^['"]\s*/, '')
    .trim();
}

function splitDelimited(line: string, delimiter: Exclude<SpectrumDelimiter, 'auto'>): string[] {
  if (delimiter === '\t') return line.split('\t').map(cleanValue);
  if (delimiter === 'space') return line.trim() ? line.trim().split(/\s+/).map(cleanValue) : [];
  const cells: string[] = [];
  let value = '',
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(cleanValue(value));
      value = '';
    } else value += char;
  }
  cells.push(cleanValue(value));
  return cells;
}

function numericCells(cells: string[]): number[] {
  return cells
    .map((cell, index) => ({ value: numeric(cell), index }))
    .filter((entry): entry is { value: number; index: number } => entry.value !== null)
    .map((entry) => entry.index);
}

/**
 * Scores each delimiter against the numeric data rows only. Instrument
 * preambles contain prose and tabs, so counting every line would mislead.
 */
export function detectSpectrumDelimiter(lines: string[]): Exclude<SpectrumDelimiter, 'auto'> {
  const candidates: Exclude<SpectrumDelimiter, 'auto'>[] = ['\t', ',', ';', '|', 'space'];
  let best: { delimiter: Exclude<SpectrumDelimiter, 'auto'>; score: number } = {
    delimiter: '\t',
    score: -1,
  };
  for (const delimiter of candidates) {
    let score = 0;
    const widths: number[] = [];
    let previousWidth = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      const cells = splitDelimited(line, delimiter);
      if (cells.length < 2) continue;
      const numbers = numericCells(cells);
      if (numbers.length < 2) continue;
      const leadingNumbers = numbers.filter((index) => index < 2).length;
      if (leadingNumbers < 2) continue;
      if (delimiter === 'space' && cells.some((cell) => /[,;\t|]/.test(cell))) continue;
      score += 10 + Math.min(4, numbers.length);
      widths.push(cells.length);
      if (previousWidth && previousWidth !== cells.length) score -= 2;
      previousWidth = cells.length;
    }
    if (widths.length >= 2) {
      const mode = [...new Set(widths)].sort(
        (a, b) => widths.filter((w) => w === b).length - widths.filter((w) => w === a).length,
      )[0];
      score -= widths.filter((width) => width !== mode).length * 3;
    }
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

/** Decodes F-7100 exports from UTF-8, GB18030/GBK, UTF-16 or a Latin-1 fallback. */
export function decodeSpectrumBytes(
  bytes: Uint8Array,
  requested: SpectrumEncoding = 'auto',
): DecodedSpectrumText {
  const warnings: string[] = [];
  const decode = (encoding: Exclude<SpectrumEncoding, 'auto'>, fatal = true) =>
    new TextDecoder(encoding, { fatal }).decode(bytes);
  if (requested !== 'auto') {
    try {
      return { text: decode(requested), encoding: requested, warnings };
    } catch {
      throw new Error(`无法按 ${requested} 解码文件；请选择其他编码后重试`);
    }
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { text: decode('utf-8').replace(/^\uFEFF/, ''), encoding: 'utf-8', warnings };
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { text: decode('utf-16le').replace(/^\uFEFF/, ''), encoding: 'utf-16le', warnings };
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return { text: decode('utf-16be').replace(/^\uFEFF/, ''), encoding: 'utf-16be', warnings };
  let oddNulls = 0,
    evenNulls = 0;
  const sample = Math.min(bytes.length, 4096);
  for (let i = 0; i < sample; i++) {
    if (bytes[i] !== 0) continue;
    if (i % 2 === 0) evenNulls++;
    else oddNulls++;
  }
  if (sample > 20 && (oddNulls > sample / 8 || evenNulls > sample / 8)) {
    const guessed = oddNulls >= evenNulls ? 'utf-16le' : 'utf-16be';
    try {
      return { text: decode(guessed).replace(/^\uFEFF/, ''), encoding: guessed, warnings };
    } catch {
      /* fall through to byte-oriented encodings */
    }
  }
  for (const candidate of ['utf-8', 'gb18030'] as const) {
    try {
      return { text: decode(candidate), encoding: candidate, warnings };
    } catch {
      /* try the next candidate */
    }
  }
  warnings.push('未识别到确定的文本编码，已按 Windows-1252 读取；中文元数据可能显示异常。');
  return { text: decode('windows-1252', false), encoding: 'windows-1252', warnings };
}

function splitLines(text: string): string[] {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
}

function parseMetadata(lines: string[], fileName: string): SpectrumMetadata {
  const values = new Map<string, string>();
  for (const line of lines) {
    if (DATA_ANCHOR.test(line)) break;
    const index = line.indexOf(':');
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key || key.length > 80) continue;
    values.set(key, cleanValue(line.slice(index + 1)));
  }
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = values.get(key);
      if (value) return value;
    }
    return '';
  };
  const numberValue = (value: string) => {
    const match = value.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
    const parsed = match ? Number(match[0]) : null;
    return parsed !== null && Number.isFinite(parsed) ? parsed : null;
  };
  const runDate = get('run date');
  const dateMatch =
    runDate.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/) ??
    runDate.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  let measuredOn = '';
  if (dateMatch) {
    measuredOn =
      dateMatch[1].length === 4
        ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
        : `${dateMatch[3]}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
  }
  const peaks: F7100Peak[] = [];
  const peakStart = lines.findIndex((line) => /^\s*Peaks\s*$/i.test(line));
  const dataStart = lines.findIndex((line) => DATA_ANCHOR.test(line));
  if (peakStart >= 0 && (dataStart < 0 || peakStart < dataStart)) {
    for (let i = peakStart + 1; i < lines.length; i++) {
      if (DATA_ANCHOR.test(lines[i])) break;
      const cells = lines[i].split('\t').map(cleanValue);
      if (cells.length < 3) continue;
      const no = numeric(cells[0]);
      if (no === null) continue;
      peaks.push({
        no,
        startNm: numeric(cells[1]),
        apexNm: numeric(cells[2]),
        endNm: numeric(cells[3]),
        height: cells[4] ?? '',
        valleyNm: numeric(cells[5]),
        valleyData: numeric(cells[6]),
      });
    }
  }
  const knownKeys = new Set<string>(HEADER_KEYS);
  const extra = Object.fromEntries([...values].filter(([key]) => !knownKeys.has(key)));
  return {
    sample: get('sample') || fileName.replace(/\.[^.]+$/, ''),
    fileName: get('file name') || fileName,
    runDate,
    measuredOn,
    operator: get('operator'),
    comment: get('comment'),
    instrument: get('model'),
    serial: get('serial number'),
    romVersion: get('rom version'),
    measurementType: get('measurement type'),
    scanMode: get('scan mode'),
    dataMode: get('data mode'),
    excitationNm: numberValue(get('ex wl', 'excitation wavelength', 'ex wavelength')),
    emStartNm: numberValue(get('em start wl', 'em  start wl', 'emission start wavelength')),
    emEndNm: numberValue(get('em end wl', 'em  end wl', 'emission end wavelength')),
    exSlitNm: numberValue(get('ex slit')),
    emSlitNm: numberValue(get('em slit')),
    scanSpeed: get('scan speed'),
    pmtVoltage: get('pmt voltage'),
    response: get('response'),
    correctedSpectra: get('corrected spectra'),
    peaks,
    extra,
  };
}

function isHeaderRow(cells: string[]): boolean {
  const first = cells[0]?.trim() ?? '',
    second = cells[1]?.trim() ?? '';
  return (
    (WAVE_HEADER.test(first) && INTENSITY_HEADER.test(second)) ||
    (WAVE_HEADER.test(first) && numeric(second) === null) ||
    (numeric(first) === null && INTENSITY_HEADER.test(second))
  );
}

function nextNonEmpty(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i++) if (lines[i].trim()) return i;
  return -1;
}

interface Block {
  headerLine: number | null;
  dataStartLine: number;
  format: ParsedSpectrumFile['format'];
}

function locateDataBlock(
  lines: string[],
  delimiter: Exclude<SpectrumDelimiter, 'auto'>,
  options: SpectrumParseOptions,
  f7100Like = false,
): Block {
  if (options.dataStartLine !== undefined) {
    if (
      !Number.isInteger(options.dataStartLine) ||
      options.dataStartLine < 1 ||
      options.dataStartLine > lines.length
    )
      throw new Error('首个数据行超出文件范围，请检查行号');
    const index = options.dataStartLine - 1;
    if (!lines[index]?.trim()) throw new Error('指定的首个数据行为空，请检查行号');
    return { headerLine: null, dataStartLine: options.dataStartLine, format: 'generic-table' };
  }
  const anchor = lines.findIndex((line) => DATA_ANCHOR.test(line));
  if (anchor >= 0) {
    const first = nextNonEmpty(lines, anchor + 1);
    if (first < 0) throw new Error('文件包含 “Data points” 标记，但后面没有数据表');
    const firstCells = splitDelimited(lines[first], delimiter);
    const header = isHeaderRow(firstCells);
    const dataIndex = header ? nextNonEmpty(lines, first + 1) : first;
    if (dataIndex < 0) throw new Error('文件包含数据表头，但没有测量数据行');
    return {
      headerLine: header ? first + 1 : null,
      dataStartLine: dataIndex + 1,
      format: 'f7100-emission',
    };
  }
  // Generic table: prefer an explicit wavelength/intensity header.
  for (let i = 0; i < lines.length; i++) {
    const cells = splitDelimited(lines[i], delimiter);
    if (cells.length < 2 || !isHeaderRow(cells)) continue;
    const dataIndex = nextNonEmpty(lines, i + 1);
    if (dataIndex < 0) continue;
    const numericRows = Array.from({ length: 4 }, (_, offset) =>
      splitDelimited(lines[dataIndex + offset] ?? '', delimiter),
    ).filter((row) => numericCells(row).length >= 2).length;
    if (numericRows >= 3)
      return { headerLine: i + 1, dataStartLine: dataIndex + 1, format: 'generic-table' };
  }
  if (f7100Like)
    throw new Error(
      '检测到 F-7100 元数据，但未找到 “Data points” 数据段。请确认文件导出完整，或在“检查/修正识别结果”中手动指定首个数据行与波长/强度列；不会把 Peaks 表误当作光谱数据。',
    );
  // A long monotonic numeric run distinguishes real data from headerless tables.
  let bestStart = -1,
    bestLength = 0;
  for (let i = 0; i < lines.length; i++) {
    const cells = splitDelimited(lines[i], delimiter);
    const positions = numericCells(cells);
    if (positions.length < 2) continue;
    const x = numeric(cells[positions[0]]),
      y = numeric(cells[positions[1]]);
    if (x === null || y === null || x <= 0) continue;
    let length = 1,
      previous = x;
    for (let j = i + 1; j < lines.length; j++) {
      const row = splitDelimited(lines[j], delimiter);
      const rowPositions = numericCells(row);
      if (rowPositions.length < 2) break;
      const nextX = numeric(row[rowPositions[0]]),
        nextY = numeric(row[rowPositions[1]]);
      if (nextX === null || nextY === null || nextX <= previous) break;
      length++;
      previous = nextX;
    }
    if (length > bestLength) {
      bestLength = length;
      bestStart = i;
    }
    if (length >= 10) break;
  }
  if (bestStart >= 0 && bestLength >= 3)
    return { headerLine: null, dataStartLine: bestStart + 1, format: 'generic-table' };
  throw new Error(
    '未能识别光谱数据。F-7100 TXT 应包含 “Data points” 段落和 nm / Data 两列；通用文本至少需要两列数值（波长、强度）。请检查分隔符、编码或手动指定首个数据行与列。',
  );
}

function resolveColumns(
  lines: string[],
  block: Block,
  delimiter: Exclude<SpectrumDelimiter, 'auto'>,
  options: SpectrumParseOptions,
): { wavelength: number; intensity: number } {
  if (options.wavelengthColumn !== undefined || options.intensityColumn !== undefined) {
    const row = splitDelimited(lines[block.dataStartLine - 1] ?? '', delimiter);
    const wavelength = options.wavelengthColumn ?? 0,
      intensity = options.intensityColumn ?? 1;
    if (wavelength < 0 || intensity < 0 || wavelength === intensity)
      throw new Error('波长列与强度列必须是两个不同的非负列');
    if (wavelength >= row.length || intensity >= row.length)
      throw new Error(`列号超出该行实际列数（${row.length} 列），请重新选择`);
    return { wavelength, intensity };
  }
  if (block.headerLine !== null) {
    const cells = splitDelimited(lines[block.headerLine - 1], delimiter);
    const wave = cells.findIndex((cell) => WAVE_HEADER.test(cell.trim()));
    const intensity = cells.findIndex(
      (cell, index) => index !== wave && INTENSITY_HEADER.test(cell.trim()),
    );
    if (wave >= 0 && intensity >= 0) return { wavelength: wave, intensity };
  }
  const row = splitDelimited(lines[block.dataStartLine - 1] ?? '', delimiter);
  const positions = numericCells(row);
  if (positions.length < 2)
    throw new Error('数据首行没有找到两列数值；请手动指定波长列与强度列');
  return { wavelength: positions[0], intensity: positions[1] };
}

/**
 * Parses decoded text. If automatic detection fails, pass dataStartLine and
 * columns to validate a manual layout without silently dropping rows.
 */
export function parseSpectrumText(
  text: string,
  fileName: string,
  options: SpectrumParseOptions = {},
  decodedEncoding?: Exclude<SpectrumEncoding, 'auto'>,
): ParsedSpectrumFile {
  const lines = splitLines(text);
  const warnings: string[] = [];
  const raw = lines.join('\n');
  if (!raw.trim()) throw new Error('文件为空');
  if (raw.includes('\u0000')) throw new Error('文件包含二进制内容，不是可解析的文本光谱');
  const metadata = parseMetadata(lines, fileName);
  const combinedType = `${metadata.measurementType} ${metadata.scanMode}`;
  if (EEM_MARKER.test(combinedType)) {
    throw new Error(
      '不支持的格式：检测到三维 EEM / 3-D scan 数据。AI 光谱助手当前只处理一维发射光谱；请在 F-7100 软件中导出单次 Emission 扫描后重试。',
    );
  }
  if (
    metadata.measurementType &&
    !/wavelength\s*scan|光谱扫描|波长扫描/i.test(metadata.measurementType)
  )
    throw new Error(
      `不支持的测量类型：“${metadata.measurementType}”。请导出 Wavelength scan 的 Emission 光谱。`,
    );
  if (metadata.scanMode && !/emission|发射/i.test(metadata.scanMode))
    throw new Error(
      `不支持的扫描模式：“${metadata.scanMode}”。AI 光谱助手当前只处理一维发射光谱（Emission）。`,
    );
  const delimiter =
    options.delimiter && options.delimiter !== 'auto'
      ? options.delimiter
      : detectSpectrumDelimiter(lines);
  const f7100Like =
    /f-?7100/i.test(metadata.instrument) ||
    (/wavelength\s*scan/i.test(metadata.measurementType) &&
      /emission|发射/i.test(metadata.scanMode));
  const block = locateDataBlock(lines, delimiter, options, f7100Like);
  const columns = resolveColumns(lines, block, delimiter, options);
  const points: Point[] = [];
  const rowNumbers: number[] = [];
  let dataRows = 0,
    skippedRows = 0,
    consecutiveInvalid = 0,
    blankAfterData = false,
    pointsAtBlank = 0;
  const skippedDetails: string[] = [];
  for (let index = block.dataStartLine - 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) {
      if (dataRows || skippedRows) {
        blankAfterData = true;
        pointsAtBlank = points.length;
      }
      continue;
    }
    const cells = splitDelimited(line, delimiter);
    const x = numeric(cells[columns.wavelength]),
      y = numeric(cells[columns.intensity]);
    if (x === null && y === null) {
      if (dataRows || skippedRows) break;
      continue;
    }
    dataRows++;
    if (x === null || y === null) {
      skippedRows++;
      consecutiveInvalid++;
      if (skippedDetails.length < 8)
        skippedDetails.push(`第 ${index + 1} 行：${x === null ? '波长' : '强度'}不是数值`);
      if (consecutiveInvalid >= 5) break;
      continue;
    }
    consecutiveInvalid = 0;
    if (x <= 0) {
      skippedRows++;
      if (skippedDetails.length < 8) skippedDetails.push(`第 ${index + 1} 行：波长必须为正数`);
      continue;
    }
    if (points.length && x <= points.at(-1)!.x) {
      skippedRows++;
      if (skippedDetails.length < 8)
        skippedDetails.push(`第 ${index + 1} 行：波长 ${x} 未严格递增，已跳过`);
      continue;
    }
    points.push({ x, y });
    rowNumbers.push(index + 1);
    if (blankAfterData && points.length > pointsAtBlank) {
      warnings.push(
        `数据段中检测到空行（第 ${index + 1} 行之前）；已跳过空行继续读取，后续测量点不会丢失。`,
      );
      blankAfterData = false;
    }
  }
  if (points.length < 2)
    throw new Error(
      `没有找到至少两个有效数据点（识别到 ${points.length} 个）。请检查波长列、强度列和分隔符；非数值行不会被静默计入。`,
    );
  if (skippedRows) {
    warnings.push(
      `跳过 ${skippedRows} 行无效或重复波长的数据：${skippedDetails.join('；')}${skippedRows > skippedDetails.length ? ' 等' : ''}`,
    );
  }
  if (points.length < 5) warnings.push(`有效数据点仅 ${points.length} 个，稳健异常检测需要至少 5 个点。`);
  const first = points[0].x,
    last = points.at(-1)!.x;
  if (metadata.emStartNm !== null && Math.abs(metadata.emStartNm - first) > 2)
    warnings.push(`元数据发射起始波长 ${metadata.emStartNm} nm 与首个数据点 ${first} nm 不一致，请核对。`);
  if (metadata.emEndNm !== null && Math.abs(metadata.emEndNm - last) > 2)
    warnings.push(`元数据发射终止波长 ${metadata.emEndNm} nm 与末个数据点 ${last} nm 不一致，请核对。`);
  if (metadata.excitationNm === null)
    warnings.push('文件中未找到激发波长（EX WL）；散射判断与斯托克斯位移将不可用，可手动补充。');
  else if (metadata.excitationNm >= first && metadata.excitationNm <= last)
    warnings.push(
      `激发波长 ${metadata.excitationNm} nm 位于发射扫描范围内；该位置的强峰可能是瑞利散射，已被排除在目标峰保护之外。`,
    );
  if (metadata.correctedSpectra && !/off|否|关闭/i.test(metadata.correctedSpectra))
    warnings.push(`仪器已开启光谱校正：${metadata.correctedSpectra}。`);
  if (decodedEncoding === 'windows-1252')
    warnings.push('文件按 Windows-1252 读取；若中文样品名异常，请切换到 GB18030 重新解析。');
  return {
    fileName,
    format: block.format,
    encoding: decodedEncoding ?? 'utf-8',
    delimiter,
    metadata,
    points,
    rowNumbers,
    headerLine: block.headerLine,
    dataStartLine: block.dataStartLine,
    columns,
    totalLines: lines.length,
    dataRows,
    skippedRows,
    warnings,
    text,
  };
}

/** Decodes and parses one uploaded text spectrum. */
export function parseSpectrumBytes(
  bytes: Uint8Array,
  fileName: string,
  options: SpectrumParseOptions = {},
): ParsedSpectrumFile {
  const decoded = decodeSpectrumBytes(bytes, options.encoding ?? 'auto');
  const parsed = parseSpectrumText(decoded.text, fileName, options, decoded.encoding);
  parsed.warnings.unshift(...decoded.warnings);
  return parsed;
}

export async function readSpectrumFile(
  file: File,
  options: SpectrumParseOptions = {},
): Promise<ParsedSpectrumFile> {
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} 超过 20 MB，请拆分后处理`);
  if (!/\.(txt|csv|tsv)$/i.test(file.name))
    throw new Error(
      `${file.name}：AI 光谱助手支持 F-7100 TXT、通用 TXT、CSV 和 TSV。请导出文本光谱，或先在光谱工作台导入其他格式。`,
    );
  return parseSpectrumBytes(new Uint8Array(await file.arrayBuffer()), file.name, options);
}

export function delimiterLabel(delimiter: Exclude<SpectrumDelimiter, 'auto'>) {
  return (
    {
      '\t': '制表符',
      ',': '逗号',
      ';': '分号',
      '|': '竖线',
      space: '空格',
    } as const
  )[delimiter];
}
