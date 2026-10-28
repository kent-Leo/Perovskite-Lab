import { inferMapping, mappedImport, readTextTable, type Mapping } from './import';

export const PASTE_LIMITS = { rows: 100001, columns: 64, cells: 500000, bytes: 20 * 1024 * 1024 };
export const emptyPasteGrid = () => Array.from({ length: 6 }, () => ['', '', '']);

function checkSize(rows: number, columns: number) {
  if (
    rows > PASTE_LIMITS.rows ||
    columns > PASTE_LIMITS.columns ||
    rows * columns > PASTE_LIMITS.cells
  )
    throw new Error('表格最多 100001 行、64 列、共 500000 个单元格，请拆分数据后粘贴。');
}

export function trimPasteGrid(grid: string[][]) {
  let lastRow = -1,
    lastColumn = -1;
  grid.forEach((row, i) =>
    row.forEach((value, j) => {
      if (value.trim()) {
        lastRow = i;
        lastColumn = Math.max(lastColumn, j);
      }
    }),
  );
  return grid
    .slice(0, lastRow + 1)
    .map((row) => Array.from({ length: lastColumn + 1 }, (_, col) => row[col] ?? ''));
}

export function pasteIntoGrid(grid: string[][], text: string, row = 0, column = 0) {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0)
    throw new Error('请选择有效的粘贴位置');
  if (new TextEncoder().encode(text).byteLength > PASTE_LIMITS.bytes)
    throw new Error('粘贴数据超过 20 MB，请拆分后粘贴');
  // A single value such as "Sample 1" stays in one cell, including its spaces.
  const values = trimPasteGrid(
    readTextTable(text, !/[\r\n\t,;|]/.test(text) ? ',' : 'auto').rows.map((cells) =>
      cells.map((value) => String(value ?? '')),
    ),
  );
  const height = Math.max(grid.length, row + values.length),
    width = Math.max(grid[0]?.length ?? 0, column + (values[0]?.length ?? 0));
  checkSize(height, width);
  const next = Array.from({ length: height }, (_, i) =>
    Array.from({ length: width }, (_, j) => grid[i]?.[j] ?? ''),
  );
  values.forEach((cells, i) =>
    cells.forEach((value, j) => {
      next[row + i][column + j] = value;
    }),
  );
  return next;
}

export function growPasteGrid(grid: string[][], rows: number, columns: number) {
  checkSize(rows, columns);
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: columns }, (_, j) => grid[i]?.[j] ?? ''),
  );
}

export function suggestPasteMapping(grid: string[][], unit: string): Mapping {
  const rows = trimPasteGrid(grid),
    table = { name: '粘贴数据', rows },
    mapping = inferMapping(table, 'wide', unit);
  if (!rows.length) return { ...mapping, ys: [1] };
  const firstDataRow = mapping.start - 1 + (mapping.header ? 1 : 0);
  const columns = Array.from({ length: rows[0]?.length ?? 0 }, (_, i) => i);
  const ys = columns.filter(
    (col) =>
      col !== mapping.x &&
      (rows.slice(firstDataRow).some((row) => row[col]?.trim()) ||
        (mapping.header && rows[mapping.start - 1]?.[col]?.trim())),
  );
  return { ...mapping, ys: ys.length ? ys : [mapping.x === 0 ? 1 : 0] };
}

export function preparePastedSpectra(grid: string[][], mapping: Mapping, source: string) {
  const rows = trimPasteGrid(grid);
  if (!rows.length) throw new Error('请先在表格中粘贴或输入波长与荧光强度数据');
  const result = mappedImport({ name: source, sheets: [{ name: '原始数据表', rows }] }, 0, mapping);
  if (result.skipped)
    throw new Error(
      `有 ${result.skipped} 个无效记录，请修正标红的波长或强度单元格后绘图；说明行可通过起始行跳过。`,
    );
  return result;
}
