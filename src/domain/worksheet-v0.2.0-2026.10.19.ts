import Papa from 'papaparse';
import { numeric } from './math';
import { readTextTable } from '../services/import';

export const WORKSHEET_VERSION = '0.2.0';
export const WORKSHEET_LIMITS = {
  rows: 100001,
  columns: 64,
  cells: 500000,
  bytes: 20 * 1024 * 1024,
};
export type CellAddress = { row: number; column: number };
export type CellSelection = { anchor: CellAddress; focus: CellAddress };
export type WorksheetColumn = {
  key: string;
  title: string;
  designation?: 'X' | 'Y' | 'Label' | 'Meta' | 'Result';
  unit?: string;
  comment?: string;
  type?: 'text' | 'number' | 'checkbox' | 'select' | 'color';
  options?: { value: string; label: string }[];
  readOnly?: boolean;
  defaultChecked?: boolean;
};

export function columnLetter(index: number): string {
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
}
export function cellName(cell: CellAddress) {
  return `${columnLetter(cell.column)}${cell.row + 1}`;
}
export function selectionBounds(s: CellSelection) {
  return {
    top: Math.min(s.anchor.row, s.focus.row),
    bottom: Math.max(s.anchor.row, s.focus.row),
    left: Math.min(s.anchor.column, s.focus.column),
    right: Math.max(s.anchor.column, s.focus.column),
  };
}
export function selectionName(s: CellSelection) {
  const b = selectionBounds(s),
    start = cellName({ row: b.top, column: b.left }),
    end = cellName({ row: b.bottom, column: b.right });
  return start === end ? start : `${start}:${end}`;
}
export function cellInSelection(cell: CellAddress, s: CellSelection) {
  const b = selectionBounds(s);
  return (
    cell.row >= b.top && cell.row <= b.bottom && cell.column >= b.left && cell.column <= b.right
  );
}
export function rangeValues(rows: string[][], s: CellSelection) {
  const b = selectionBounds(s);
  return Array.from({ length: b.bottom - b.top + 1 }, (_, r) =>
    Array.from({ length: b.right - b.left + 1 }, (_, c) => rows[b.top + r]?.[b.left + c] ?? ''),
  );
}
export function copyWorksheetRange(rows: string[][], s: CellSelection) {
  return Papa.unparse(rangeValues(rows, s), { delimiter: '\t', newline: '\n' });
}
export function selectionStats(rows: string[][], s: CellSelection) {
  const values = rangeValues(rows, s).flat(),
    numbers = values.map(numeric).filter((v): v is number => v !== null),
    sum = numbers.reduce((n, v) => n + v, 0);
  return {
    cells: values.length,
    numeric: numbers.length,
    sum,
    mean: numbers.length ? sum / numbers.length : null,
  };
}
export function trimWorksheetRows(rows: string[][], columns: WorksheetColumn[]) {
  let count = rows.length;
  while (count && !rows[count - 1].some((v, c) => !columns[c]?.readOnly && v.trim())) count--;
  return rows.slice(0, count);
}
export function clearWorksheetRange(
  rows: string[][],
  columns: WorksheetColumn[],
  s: CellSelection,
) {
  return rows.map((row, r) =>
    row.map((value, c) =>
      !columns[c]?.readOnly && cellInSelection({ row: r, column: c }, s) ? '' : value,
    ),
  );
}
export function normalizeWorksheetCell(value: string, column: WorksheetColumn): string {
  if (!value.trim()) return '';
  if (column.type === 'number' && numeric(value) === null)
    throw new Error(`“${column.title}”列只接受数值，请去掉单位文字`);
  if (column.type === 'checkbox') {
    if (/^(true|1|yes|是|选中)$/i.test(value.trim())) return 'true';
    if (/^(false|0|no|否|未选中)$/i.test(value.trim())) return 'false';
    throw new Error(`“${column.title}”列请使用 true / false 或 1 / 0`);
  }
  if (column.type === 'select') {
    const option = column.options?.find(
      (o) => o.value === value.trim() || o.label === value.trim(),
    );
    if (!option) throw new Error(`“${column.title}”列的值不在可选范围内`);
    return option.value;
  }
  if (column.type === 'color' && !/^#[\da-f]{6}$/i.test(value.trim()))
    throw new Error('颜色请使用 #RRGGBB 格式');
  return value;
}
/**
 * Values for the name / unit / comment header rows.
 * A clipboard block may be one row spread across columns, or a single column
 * (for example a vertical list copied from Excel) filled left to right.
 */
export function pasteMetadataValues(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!/[\t\n]/.test(normalized)) return [normalized];
  const rows = normalized.split('\n').map((row) => row.split('\t'));
  let end = rows.length;
  while (end && rows[end - 1].every((value) => !value.trim())) end--;
  const block = rows.slice(0, end);
  if (!block.length) return [''];
  if (block.every((row) => row.length <= 1)) return block.map((row) => row[0] ?? '');
  return block[0];
}
export function pasteWorksheetRange(
  rows: string[][],
  columns: WorksheetColumn[],
  at: CellAddress,
  text: string,
) {
  if (
    !columns.length ||
    !Number.isInteger(at.row) ||
    !Number.isInteger(at.column) ||
    at.row < 0 ||
    at.column < 0 ||
    at.column >= columns.length
  )
    throw new Error('请选择有效的粘贴位置');
  if (new TextEncoder().encode(text).byteLength > WORKSHEET_LIMITS.bytes)
    throw new Error('粘贴数据超过 20 MB，请分批粘贴');
  if (!text.trim())
    return { rows: rows.map((row) => [...row]), selection: { anchor: at, focus: at } };
  // Ignore quoted separators so a copied text cell containing tabs stays one cell.
  const layout = text.replace(/"(?:[^"]|"")*"/g, '""');
  const delimiter = layout.includes('\t')
    ? '\t'
    : layout.includes(',')
      ? ','
      : layout.includes(';')
        ? ';'
        : layout.includes('|')
          ? '|'
          : /^[\d.eE+\-\s]+$/.test(layout)
            ? 'auto'
            : ',';
  const values = readTextTable(text, delimiter).rows.map((row) => row.map((v) => String(v ?? '')));
  while (values.length && values[values.length - 1].every((v) => !v.trim())) values.pop();
  if (!values.length)
    return { rows: rows.map((row) => [...row]), selection: { anchor: at, focus: at } };
  const width = values.reduce((n, row) => Math.max(n, row.length), 0),
    height = Math.max(rows.length, at.row + values.length);
  if (at.column + width > columns.length)
    throw new Error('粘贴区域超出工作表列数，请先添加列或调整起点');
  if (
    height > WORKSHEET_LIMITS.rows ||
    columns.length > WORKSHEET_LIMITS.columns ||
    height * columns.length > WORKSHEET_LIMITS.cells
  )
    throw new Error('工作表数据过大，请拆分为多个工作表');
  // Validate the whole rectangle atomically. Missing trailing cells clear old readings.
  const changes = values.map((row, r) =>
    Array.from({ length: width }, (_, c) => {
      const column = columns[at.column + c],
        value = row[c] ?? '';
      if (column.readOnly && value.trim())
        throw new Error(`“${column.title}”是只读计算列，不能粘贴覆盖`);
      return {
        row: at.row + r,
        column: at.column + c,
        value: column.readOnly ? null : normalizeWorksheetCell(value, column),
      };
    }),
  );
  const next = Array.from({ length: height }, (_, r) => columns.map((_, c) => rows[r]?.[c] ?? ''));
  for (const row of changes)
    for (const cell of row) if (cell.value !== null) next[cell.row][cell.column] = cell.value;
  return {
    rows: next,
    selection: {
      anchor: at,
      focus: { row: at.row + values.length - 1, column: at.column + width - 1 },
    },
  };
}
