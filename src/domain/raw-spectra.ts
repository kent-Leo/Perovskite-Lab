import type { ColumnMetadata } from './types';

/** Workspace key for the header metadata of one raw-spectrum table column. */
export function rawColumnKey(column: number) {
  return `raw-${column}`;
}
export function rawColumnIndex(key: string) {
  const match = /^raw-(\d+)$/.exec(key);
  return match ? Number(match[1]) : null;
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
