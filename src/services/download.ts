import { APP_VERSION } from '../version-v0.9.0-2026.10.27';
import { groupedExportTables } from '../domain/grouped-bar-2026.11.6';
import type { GroupedBarSheet } from '../domain/types';
export function dateStamp() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const part = (t: string) => p.find((v) => v.type === t)!.value;
  return `${part('year')}.${Number(part('month'))}.${Number(part('day'))}`;
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function filename(base: string, ext: string) {
  return `${base.replace(/[<>:"/\\|?*]/g, '_')}-v${APP_VERSION}-${dateStamp()}.${ext}`;
}
export async function exportExcel(rows: Record<string, unknown>[], name: string) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Data');
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  downloadBlob(new Blob([data]), filename(name, 'xlsx'));
}
export async function exportGroupedExcel(sheet: GroupedBarSheet) {
  const tables = groupedExportTables(sheet);
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  tables.forEach(({ name, rows }) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name));
  downloadBlob(new Blob([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })]), filename('分组柱状图数据', 'xlsx'));
}
