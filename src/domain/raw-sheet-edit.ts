import type { ColumnMetadata, SheetMapping } from './types';
import { rawColumnIndex, rawColumnKey, syncRawMapping } from './raw-spectra';
import { structureCount } from './worksheet-structure-2026.11.5';

/** Draft table of the active raw-spectrum sheet. */
export interface RawSheetDraft {
  grid: string[][];
  mapping: SheetMapping;
}

export interface RawSheetInsertResult {
  rawSheet: RawSheetDraft;
  metadata: Record<string, ColumnMetadata>;
  columnSpectra: Record<string, string>;
}

/** 列结构操作结果：额外带回被删除的原始列号，供页面同步移除光谱。 */
export interface RawSheetColumnResult extends RawSheetInsertResult {
  removedColumns: number[];
}

function uniformGrid(grid: string[][]): string[][] {
  const width = Math.max(1, ...grid.map((row) => row.length));
  return grid.map((row) =>
    Array.from({ length: width }, (_, column) => String(row[column] ?? '')),
  );
}

/** Insert one empty row before `row` (0-based); keeps the header/start-row mapping aligned. */
export function insertRawSheetRow(sheet: RawSheetDraft, row: number): RawSheetDraft {
  return insertRawSheetRows(sheet, row, 1);
}

/** Insert `count` empty rows before `row` (0-based); keeps the header/start-row mapping aligned. */
export function insertRawSheetRows(
  sheet: RawSheetDraft,
  row: number,
  count = 1,
): RawSheetDraft {
  const grid = uniformGrid(sheet.grid);
  const amount = structureCount(count);
  const index = Math.max(0, Math.min(Number.isFinite(row) ? Math.trunc(row) : 0, grid.length));
  const width = grid[0]?.length ?? 3;
  grid.splice(
    index,
    0,
    ...Array.from({ length: amount }, () => Array.from({ length: width }, () => '')),
  );
  // Mapping.start is 1-based. Rows inserted at or above the header row push it down.
  const start = index + 1 <= sheet.mapping.start ? sheet.mapping.start + amount : sheet.mapping.start;
  return { grid, mapping: { ...sheet.mapping, start } };
}

/** Remove `count` rows at `row`; the header/start row moves up when rows above it go away. */
export function deleteRawSheetRows(
  sheet: RawSheetDraft,
  row: number,
  count = 1,
): RawSheetDraft {
  const grid = uniformGrid(sheet.grid);
  const index = Math.max(0, Math.min(Number.isFinite(row) ? Math.trunc(row) : 0, grid.length));
  const amount = Math.min(structureCount(count), grid.length - index);
  if (!amount) return { grid, mapping: sheet.mapping };
  // 只有删除位置完全落在表头之上时，起始行才需要上移相同的行数。
  const start =
    index + amount < sheet.mapping.start
      ? Math.max(1, sheet.mapping.start - amount)
      : sheet.mapping.start;
  grid.splice(index, amount);
  return {
    grid,
    mapping: { ...sheet.mapping, start: Math.max(1, Math.min(start, Math.max(1, grid.length))) },
  };
}

function shiftKey(key: string, column: number, count = 1): string {
  const index = rawColumnIndex(key);
  if (index === null) return key;
  return index >= column ? rawColumnKey(index + count) : key;
}

/** Insert one empty column before `column` (0-based). */
export function insertRawSheetColumn(
  sheet: RawSheetDraft,
  metadata: Record<string, ColumnMetadata> | undefined,
  columnSpectra: Record<string, string> | undefined,
  column: number,
): RawSheetInsertResult {
  const result = insertRawSheetColumns(sheet, metadata, columnSpectra, column, 1);
  return { rawSheet: result.rawSheet, metadata: result.metadata, columnSpectra: result.columnSpectra };
}

/**
 * Insert `count` empty columns before `column` (0-based). Shifts the wavelength /
 * intensity mapping, the per-column header metadata and the persisted
 * column→spectrum mapping so existing curves stay attached to the same data.
 * New columns start as metadata columns (not plotted) until the user enables them.
 */
export function insertRawSheetColumns(
  sheet: RawSheetDraft,
  metadata: Record<string, ColumnMetadata> | undefined,
  columnSpectra: Record<string, string> | undefined,
  column: number,
  count = 1,
): RawSheetColumnResult {
  const source = uniformGrid(sheet.grid);
  const amount = structureCount(count);
  const width = source[0]?.length ?? 3;
  const index = Math.max(
    0,
    Math.min(Number.isFinite(column) ? Math.trunc(column) : 0, width),
  );
  if (width + amount > 64) throw new Error('原始光谱表最多 64 列');
  const grid = source.map((row) => {
    const next = [...row];
    next.splice(index, 0, ...Array.from({ length: amount }, () => ''));
    return next;
  });
  const shift = (value: number) => (value >= index ? value + amount : value);
  const inserted = Array.from({ length: amount }, (_, i) => index + i);
  const shifted: SheetMapping = {
    ...sheet.mapping,
    x: shift(sheet.mapping.x),
    ys: sheet.mapping.ys.map(shift),
    meta: [...new Set([...(sheet.mapping.meta ?? []).map(shift), ...inserted])].sort(
      (a, b) => a - b,
    ),
  };
  const mapping: SheetMapping = syncRawMapping(grid, shifted);
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata ?? {}).map(([key, value]) => [shiftKey(key, index, amount), value]),
  );
  const nextColumnSpectra = Object.fromEntries(
    Object.entries(columnSpectra ?? {}).map(([key, value]) => [shiftKey(key, index, amount), value]),
  );
  return {
    rawSheet: { grid, mapping },
    metadata: nextMetadata,
    columnSpectra: nextColumnSpectra,
    removedColumns: [],
  };
}

function shrinkKey(key: string, column: number, count: number): string | null {
  const index = rawColumnIndex(key);
  if (index === null) return key;
  if (index < column) return key;
  if (index >= column + count) return rawColumnKey(index - count);
  return null;
}

/**
 * Delete `count` columns starting at `column` (0-based). The wavelength column and
 * the last remaining column are protected; every other column can be removed.
 * Mapping, header metadata and the column→spectrum mapping are re-keyed, and the
 * deleted column numbers are returned so spectra linked to them can be dropped.
 */
export function deleteRawSheetColumns(
  sheet: RawSheetDraft,
  metadata: Record<string, ColumnMetadata> | undefined,
  columnSpectra: Record<string, string> | undefined,
  column: number,
  count = 1,
): RawSheetColumnResult {
  const source = uniformGrid(sheet.grid);
  const width = source[0]?.length ?? 3;
  const index = Math.max(
    0,
    Math.min(Number.isFinite(column) ? Math.trunc(column) : 0, width - 1),
  );
  const amount = Math.min(structureCount(count), width - index);
  const removed = Array.from({ length: amount }, (_, i) => index + i);
  if (removed.includes(sheet.mapping.x))
    throw new Error('波长列是绘图的必需列，不能删除；请先改用其他列作为波长列');
  if (width - amount < 1) throw new Error('工作表至少保留一列');
  const grid = source.map((row) => [...row.slice(0, index), ...row.slice(index + amount)]);
  const shift = (value: number) => {
    if (value < index) return value;
    if (value >= index + amount) return value - amount;
    return -1;
  };
  const shifted: SheetMapping = {
    ...sheet.mapping,
    x: shift(sheet.mapping.x),
    ys: sheet.mapping.ys.map(shift).filter((value) => value >= 0),
    meta: [...new Set((sheet.mapping.meta ?? []).map(shift).filter((value) => value >= 0))].sort(
      (a, b) => a - b,
    ),
  };
  const prune = <T,>(input: Record<string, T> | undefined) =>
    Object.fromEntries(
      Object.entries(input ?? {})
        .map(([key, value]) => [shrinkKey(key, index, amount), value] as const)
        .filter((entry): entry is readonly [string, T] => entry[0] !== null),
    );
  return {
    rawSheet: { grid, mapping: syncRawMapping(grid, shifted) },
    metadata: prune(metadata),
    columnSpectra: prune(columnSpectra),
    removedColumns: removed,
  };
}
