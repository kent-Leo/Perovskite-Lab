import { APP_VERSION } from '../version-v0.5.5-2026.10.22';
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
