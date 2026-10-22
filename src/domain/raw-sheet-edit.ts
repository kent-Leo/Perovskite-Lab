import type { ColumnMetadata, SheetMapping } from './types';
import { rawColumnIndex, rawColumnKey } from './raw-spectra';

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

function uniformGrid(grid: string[][]): string[][] {
  const width = Math.max(3, ...grid.map((row) => row.length));
  return grid.map((row) =>
    Array.from({ length: width }, (_, column) => String(row[column] ?? '')),
  );
}

/** Insert one empty row before `row` (0-based); keeps the header/start-row mapping aligned. */
export function insertRawSheetRow(sheet: RawSheetDraft, row: number): RawSheetDraft {
  const grid = uniformGrid(sheet.grid);
  const index = Math.max(0, Math.min(Number.isFinite(row) ? Math.trunc(row) : 0, grid.length));
  grid.splice(index, 0, Array.from({ length: grid[0]?.length ?? 3 }, () => ''));
  // Mapping.start is 1-based. A row inserted at or above the header row pushes it down.
  const start = index + 1 <= sheet.mapping.start ? sheet.mapping.start + 1 : sheet.mapping.start;
  return { grid, mapping: { ...sheet.mapping, start } };
}

function shiftKey(key: string, column: number): string {
  const index = rawColumnIndex(key);
  if (index === null) return key;
  return index >= column ? rawColumnKey(index + 1) : key;
}

/**
 * Insert one empty column before `column` (0-based). Shifts the wavelength /
 * intensity mapping, the per-column header metadata and the persisted
 * column→spectrum mapping so existing curves stay attached to the same data.
 */
export function insertRawSheetColumn(
  sheet: RawSheetDraft,
  metadata: Record<string, ColumnMetadata> | undefined,
  columnSpectra: Record<string, string> | undefined,
  column: number,
): RawSheetInsertResult {
  const source = uniformGrid(sheet.grid);
  const index = Math.max(
    0,
    Math.min(Number.isFinite(column) ? Math.trunc(column) : 0, source[0]?.length ?? 3),
  );
  const grid = source.map((row) => {
    const next = [...row];
    next.splice(index, 0, '');
    return next;
  });
  const mapping: SheetMapping = {
    ...sheet.mapping,
    x: sheet.mapping.x >= index ? sheet.mapping.x + 1 : sheet.mapping.x,
    ys: sheet.mapping.ys.map((value) => (value >= index ? value + 1 : value)),
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata ?? {}).map(([key, value]) => [shiftKey(key, index), value]),
  );
  const nextColumnSpectra = Object.fromEntries(
    Object.entries(columnSpectra ?? {}).map(([key, value]) => [shiftKey(key, index), value]),
  );
  return {
    rawSheet: { grid, mapping },
    metadata: nextMetadata,
    columnSpectra: nextColumnSpectra,
  };
}
