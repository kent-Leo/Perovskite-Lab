import type { ColumnMetadata, SheetMapping } from './types';

/** Workspace key for the header metadata of one raw-spectrum table column. */
export function rawColumnKey(column: number) {
  return `raw-${column}`;
}
export function rawColumnIndex(key: string) {
  const match = /^raw-(\d+)$/.exec(key);
  return match ? Number(match[1]) : null;
}
/**
 * Every raw-table column except the wavelength column is an intensity column
 * unless it was explicitly marked as metadata. This keeps newly widened or
 * reloaded tables plottable without re-checking each column.
 */
export function rawIntensityColumns(grid: string[][], mapping: SheetMapping) {
  if (mapping.kind !== 'wide') return mapping.ys;
  const meta = new Set(mapping.meta ?? []);
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: width }, (_, column) => column).filter(
    (column) => column !== mapping.x && !meta.has(column),
  );
}
export function syncRawMapping(grid: string[][], mapping: SheetMapping) {
  // AI processed sheets keep their explicit column selection (masked values are meaningful).
  if (mapping.kind !== 'wide' || mapping.allowEmptyIntensity) return mapping;
  const ys = rawIntensityColumns(grid, mapping);
  return ys.length === mapping.ys.length && ys.every((column, index) => column === mapping.ys[index])
    ? mapping
    : { ...mapping, ys };
}
/**
 * Legend and chart labels follow the raw table: comment (备注) first, then the
 * column name, then the name captured when the spectrum was plotted.
 */
export function rawSpectrumLabel(meta: ColumnMetadata | undefined, fallback: string) {
  return meta?.comment?.trim() || meta?.title?.trim() || fallback;
}
export function rawSpectrumColor(meta: ColumnMetadata | undefined, fallback: string) {
  return meta?.color?.trim() || fallback;
}
