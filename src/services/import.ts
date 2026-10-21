import Papa from 'papaparse';
import { numeric, convertConcentration, normalizeConcentrationUnit } from '../domain/math';
import type { Workspace } from '../state/workspace';
import {
  uid,
  palette,
  type Spectrum,
  type ObjectRow,
  type CalibrationRow,
  type Point,
} from '../domain/types';
export interface SheetTable {
  name: string;
  rows: unknown[][];
}
export interface ImportFile {
  name: string;
  sheets: SheetTable[];
}
export type ImportKind = 'wide' | 'long' | 'objects' | 'calibration';
export interface Mapping {
  kind: ImportKind;
  start: number;
  header: boolean;
  x: number;
  ys: number[];
  name: number;
  concentration: number;
  unit: string;
}
function parseText(text: string, delimiter: string) {
  if (delimiter === 'space')
    return {
      data: text.split(/\r\n|\n|\r/).map((line) => (line.trim() ? line.trim().split(/\s+/) : [])),
      errors: [],
    };
  return Papa.parse<string[]>(text, { skipEmptyLines: false, delimiter });
}
function detectDelimiter(text: string) {
  const directive = text.match(/^(?:\s*\r?\n)*sep=([,;\t|])\s*(?:\r?\n|$)/i);
  if (directive) return directive[1];
  // Instrument preambles often defeat Papa's first-row delimiter guess. Score actual numeric rows.
  const sample = text
    .split(/\r\n|\n|\r/)
    .slice(0, 1000)
    .join('\n');
  const candidates = ['\t', ',', ';', '|', 'space'].map((delimiter) => {
    const { data } = parseText(sample, delimiter);
    let score = 0;
    for (const row of data) {
      // Whitespace inside a CSV value is not a field delimiter.
      if (delimiter === 'space' && row.some((v) => /[,;\t|]/.test(v))) continue;
      // Also recognize a header-only clipboard block before numeric rows are pasted.
      if (row.length > 1) score += 0.01;
      const numbers = row.filter((v) => numeric(v) !== null).length;
      if (row.length > 1 && numbers > 0) score += numbers > 1 ? 10 : 1;
      if (row.filter((v) => columnRole(v)).length >= 2) score += 2;
    }
    return { delimiter, score };
  });
  return candidates.sort((a, b) => b.score - a.score)[0].delimiter;
}
export function readTextTable(text: string, delimiter = 'auto'): SheetTable {
  text = text.replace(/^\uFEFF/, '');
  if (!text.trim()) throw new Error('数据为空');
  const parsed = parseText(text, delimiter === 'auto' ? detectDelimiter(text) : delimiter);
  if (parsed.errors.some((e) => e.type === 'Quotes'))
    throw new Error('数据中的引号没有正确闭合，请检查 CSV 格式');
  return { name: '数据', rows: parsed.data };
}
export async function readDataFile(
  file: File,
  encoding = 'utf-8',
  delimiter = 'auto',
): Promise<ImportFile> {
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} 超过 20 MB，请拆分后导入`);
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return {
      name: file.name,
      sheets: wb.SheetNames.map((name) => ({
        name,
        rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '' }),
      })),
    };
  }
  if (!/\.(csv|txt|tsv)$/i.test(file.name)) throw new Error('请选择 XLSX、XLS、CSV 或 TXT 文件');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bomEncoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : encoding;
  const text = new TextDecoder(bomEncoding).decode(bytes).replace(/^\uFEFF/, '');
  if (!text.trim()) throw new Error('文件为空');
  return { name: file.name, sheets: [readTextTable(text, delimiter)] };
}
export function headers(table: SheetTable, m: Mapping) {
  const count = table.rows
    .slice(Math.max(0, m.start - 1))
    .reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: count }, (_, i) =>
    m.header ? String(table.rows[m.start - 1]?.[i] ?? '').trim() || `列 ${i + 1}` : `列 ${i + 1}`,
  );
}
const columnRole = (value: unknown) => {
  const label = String(value ?? '')
    .trim()
    .toLowerCase();
  if (
    /^(nm|λ|wavelength(?:\b|_)|wave\s*length(?:\b|_)|波长|波長|发射波长|emission\s*wavelength)/i.test(
      label,
    )
  )
    return 'wave';
  if (
    /^(f|i|pl|intensity|fluorescence(?:\b|_)|fluorescence\s*intensity|荧光强度|荧光值|强度|信号|counts?)(?:$|[\s/_（(])/i.test(
      label,
    )
  )
    return 'intensity';
  if (/^(c|conc(?:entration)?|浓度)(?:$|[\s/_（(])/i.test(label)) return 'concentration';
  if (
    /^(sample(?:\b|_)|name(?:\b|_)|ion(?:\b|_)|object(?:\b|_)|analyte(?:\b|_)|样品|名称|分析对象|对象|离子)/i.test(
      label,
    )
  )
    return 'name';
  return '';
};
export function inferMapping(table: SheetTable, kind: ImportKind, unit: string): Mapping {
  const count = table.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const base: Mapping = {
    kind,
    start: 1,
    header: false,
    x: 0,
    ys: count > 1 ? [1] : [],
    name: 0,
    concentration: kind === 'objects' ? -1 : 0,
    unit,
  };
  const sample = table.rows.slice(0, 1000);
  for (let i = 0; i < sample.length; i++) {
    const roles = sample[i].map(columnRole),
      wave = roles.indexOf('wave'),
      intensity = roles.indexOf('intensity'),
      name = roles.indexOf('name'),
      concentration = roles.indexOf('concentration');
    if (
      (kind === 'wide' && wave >= 0 && sample[i].length > 1) ||
      (kind === 'long' && wave >= 0 && name >= 0 && intensity >= 0) ||
      (kind === 'objects' && name >= 0 && intensity >= 0) ||
      (kind === 'calibration' && concentration >= 0 && intensity >= 0)
    ) {
      return {
        ...base,
        start: i + 1,
        header: true,
        x: wave >= 0 ? wave : 0,
        name: name >= 0 ? name : 0,
        concentration: concentration >= 0 ? concentration : base.concentration,
        ys: [intensity >= 0 ? intensity : wave === 0 ? 1 : 0],
      };
    }
  }
  for (let i = 0; i < sample.length; i++) {
    const row = sample[i],
      nums = row.map((v, j) => (numeric(v) !== null ? j : -1)).filter((j) => j >= 0),
      name = row.findIndex((v) => String(v ?? '').trim() !== '' && numeric(v) === null);
    if (
      kind === 'wide' || kind === 'calibration'
        ? nums.length < 2
        : name < 0 || nums.length < (kind === 'long' ? 2 : 1)
    )
      continue;
    const x = nums[0],
      y = nums[kind === 'objects' && nums.length === 1 ? 0 : 1];
    let previous = i - 1;
    while (previous >= 0 && sample[previous].every((v) => String(v ?? '').trim() === ''))
      previous--;
    const numberCols = kind === 'objects' && nums.length === 1 ? [y] : [x, y];
    const header =
      previous >= 0 &&
      numberCols.every(
        (col) =>
          String(sample[previous][col] ?? '').trim() !== '' &&
          numeric(sample[previous][col]) === null,
      );
    return {
      ...base,
      start: (header ? previous : i) + 1,
      header,
      x,
      ys: [y],
      name: name >= 0 ? name : 0,
      concentration: kind === 'objects' && nums.length === 1 ? -1 : x,
    };
  }
  return base;
}
export function mappedImport(file: ImportFile, sheet: number, m: Mapping) {
  const table = file.sheets[sheet];
  if (!table) throw new Error('请选择有效工作表');
  if (!Number.isInteger(m.start) || m.start < 1 || m.start > table.rows.length)
    throw new Error('起始行不在数据范围内');
  const labels = headers(table, m),
    rows = table.rows.slice(m.start - 1 + (m.header ? 1 : 0));
  if (labels.length < 2)
    throw new Error(
      '文件只识别到 1 列：请修改分隔符。光谱至少需要“波长、强度”两列，对象筛选至少需要“名称、强度”两列。',
    );
  if (!m.ys.length) throw new Error('请选择荧光强度列');
  const validColumn = (col: number) => Number.isInteger(col) && col >= 0 && col < labels.length;
  if (m.ys.some((col) => !validColumn(col)))
    throw new Error('选中的荧光强度列不存在，请重新选择强度列');
  if ((m.kind === 'wide' || m.kind === 'long') && !validColumn(m.x))
    throw new Error('请选择有效波长列');
  if ((m.kind === 'objects' || m.kind === 'long') && !validColumn(m.name))
    throw new Error('请选择有效名称列');
  if (
    (m.kind === 'calibration' || (m.kind === 'objects' && m.concentration !== -1)) &&
    !validColumn(m.concentration)
  )
    throw new Error('请选择有效浓度列；没有浓度时选择“不提供浓度”');
  if (m.kind === 'objects' && (m.name === m.ys[0] || m.name === m.concentration))
    throw new Error('名称列应与强度列、浓度列不同');
  let skipped = 0,
    invalidX = 0,
    invalidY = 0,
    invalidC = 0,
    invalidName = 0;
  const spectra: Spectrum[] = [],
    objects: ObjectRow[] = [],
    calibration: CalibrationRow[] = [];
  if (m.kind === 'wide' || m.kind === 'long') {
    if (m.ys.includes(m.x)) throw new Error('波长列与强度列不能相同');
    if (m.kind === 'long' && (m.name === m.x || m.ys.includes(m.name)))
      throw new Error('样品名称列应与数值列不同');
    const groups = new Map<string, Point[]>();
    for (const row of rows) {
      if (row.every((v) => String(v).trim() === '')) continue;
      const x = numeric(row[m.x]);
      if (x === null) {
        invalidX++;
        skipped++;
        continue;
      }
      for (const col of m.ys) {
        const y = numeric(row[col]),
          name =
            m.kind === 'long' ? String(row[m.name] ?? '').trim() : labels[col] || `谱 ${col + 1}`;
        if (y === null || !name) {
          if (y === null) invalidY++;
          if (!name) invalidName++;
          skipped++;
          continue;
        }
        const key = m.kind === 'long' ? name : String(col);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push({ x, y });
      }
    }
    for (const [key, points] of groups) {
      points.sort((a, b) => a.x - b.x);
      if (points.length < 2) throw new Error(`曲线 ${key} 的有效点少于 2`);
      if (points.length > 100000) throw new Error('单条曲线超过 100000 点，请拆分');
      if (points.some((p, i) => i > 0 && p.x === points[i - 1].x))
        throw new Error(`曲线 ${key} 存在重复波长；请分开重复测量或先处理重复值`);
      const name =
        m.kind === 'long'
          ? key
          : m.header
            ? labels[Number(key)]
            : file.name.replace(/\.[^.]+$/, '') + (m.ys.length > 1 ? ` · ${Number(key) + 1}` : '');
      spectra.push({
        id: uid(),
        name,
        role: 'other',
        concentration: '',
        unit: normalizeConcentrationUnit(m.unit),
        color: palette[spectra.length % palette.length],
        visible: true,
        points,
        source: file.name + ' / ' + table.name,
      });
    }
  } else {
    if (m.concentration === m.ys[0]) throw new Error('浓度列与强度列不能相同');
    for (const row of rows) {
      if (row.every((v) => String(v).trim() === '')) continue;
      const f = numeric(row[m.ys[0]]),
        c = numeric(row[m.concentration]);
      if (f === null || (m.kind === 'calibration' && (c === null || c < 0))) {
        if (f === null) invalidY++;
        if (m.kind === 'calibration' && (c === null || c < 0)) invalidC++;
        skipped++;
        continue;
      }
      if (m.kind === 'calibration')
        calibration.push({
          id: uid(),
          concentration: String(c),
          intensity: String(f),
          included: true,
        });
      else {
        const name = String(row[m.name] ?? '').trim();
        if (
          !name ||
          (c === null && String(row[m.concentration] ?? '').trim() !== '') ||
          (c !== null && c < 0)
        ) {
          if (!name) invalidName++;
          else invalidC++;
          skipped++;
          continue;
        }
        objects.push({
          id: uid(),
          name,
          role: 'other',
          concentration: c === null ? '' : String(c),
          unit: normalizeConcentrationUnit(m.unit),
          intensity: String(f),
          notes: '',
        });
      }
    }
  }
  const count = spectra.length || objects.length || calibration.length;
  if (!count) {
    const reasons = [
      invalidX && `${invalidX} 行波长不是数值`,
      invalidY && `${invalidY} 个强度值不是数值`,
      invalidC && `${invalidC} 行浓度无效`,
      invalidName && `${invalidName} 行名称为空`,
    ].filter(Boolean);
    throw new Error(
      `映射后没有有效数据：${reasons.join('；') || '列名之后没有数据行'}。请核对数据布局、起始行和列映射；数值单元格不能包含 nm、a.u. 等单位，使用小数点（如 1.25）或科学计数法（如 1.2E3）。`,
    );
  }
  return { spectra, objects, calibration, skipped, count };
}
export function mergeImport(
  prev: Workspace,
  r: ReturnType<typeof mappedImport>,
  unit: string,
): Partial<Workspace> {
  const oldCalibration = prev.demo ? [] : prev.calibration;
  const calUnit = normalizeConcentrationUnit(
    r.calibration.length && !oldCalibration.length ? unit : prev.calUnit,
  );
  const importedCalibration = r.calibration.map((row) => ({
    ...row,
    concentration: String(convertConcentration(Number(row.concentration), unit, calUnit)),
  }));
  return {
    demo: false,
    spectra: [...(prev.demo ? [] : prev.spectra), ...r.spectra],
    rawSpectra: [...(prev.demo ? [] : (prev.rawSpectra ?? prev.spectra)), ...r.spectra],
    objects: [...(prev.demo ? [] : prev.objects), ...r.objects],
    calibration: [...oldCalibration, ...importedCalibration],
    calUnit,
    blankId: prev.demo ? '' : prev.blankId,
    calF0: prev.demo ? '' : prev.calF0,
    blankRepeats: prev.demo ? '' : prev.blankRepeats,
    manualSigma: prev.demo ? '' : prev.manualSigma,
    fitMin: prev.demo ? '' : prev.fitMin,
    fitMax: prev.demo ? '' : prev.fitMax,
    styles: {
      ...prev.styles,
      calibration: { ...prev.styles.calibration, xLabel: `Concentration / ${calUnit}` },
    },
  };
}
