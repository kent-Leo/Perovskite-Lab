import type { ProcessingResult } from '../domain/spectrum-processing-v0.9.1-2026.10.27';
import type { AiProvider } from '../../shared/ai-contract-v0.9.1-2026.10.27';
import { APP_VERSION } from '../version-v0.9.1-2026.10.27';
import { dateStamp, downloadBlob, filename } from './download';
export interface ProcessingAudit {
  sheet: string;
  excitation: string;
  solvent: string;
  appliedOn: string;
  ai: { provider: AiProvider; model: string; summary: string } | null;
}
/** Explicit metadata allowlist: never serialize AI session or credentials. */
export function processingTables(result: ProcessingResult, audit: ProcessingAudit) {
  const raw = result.originals.flatMap((s) => s.points.map((p) => ({
    光谱标识: s.id, 光谱: s.name, 来源: s.source, 波长_nm: p.x, 原始强度: p.y,
  })));
  if (result.plan.blank) raw.push(...result.plan.blank.points.map((p) => ({
    光谱标识: result.plan.blank!.id, 光谱: result.plan.blank!.name,
    来源: `空白参考：${result.plan.blank!.source}`, 波长_nm: p.x, 原始强度: p.y,
  })));
  const processed = result.spectra.flatMap((s) => s.points.map((p) => ({
    光谱标识: s.id, 光谱: s.name, 波长_nm: p.x, 原始强度: p.original,
    空白强度_含范围内插值: p.blank ?? '', 处理强度: p.y ?? '',
    状态: p.y === null ? '已排除' : result.plan.subtractBlank ? '已扣空白' : '原值保留', 理由: p.reason,
  })));
  const changes = result.plan.regions.map((r) => ({
    光谱: result.spectra.find((s) => s.id === r.spectrumId)?.name ?? r.spectrumId,
    起点_nm: r.fromNm, 终点_nm: r.toNm, 来源: r.origin === 'ai' ? 'AI建议，人工选择' : '手动标记',
    是否应用: r.enabled ? '是' : '否', 理由: r.reason,
  }));
  const settings = [
    ['工作表', audit.sheet], ['应用日期', audit.appliedOn], ['导出日期', dateStamp()],
    ['软件版本', APP_VERSION], ['处理算法', '区间排除 + 空白1:1扣除 / 2026.10.24'],
    ['激发波长_nm', audit.excitation], ['溶剂或基质', audit.solvent],
    ['目标保护区_nm', result.plan.protectedRange ? `${result.plan.protectedRange.fromNm}–${result.plan.protectedRange.toNm}` : '未设置'],
    ['空白扣除', result.plan.subtractBlank ? '是；同条件确认；不外推；保留负值' : '否'],
    ['空白参考', result.plan.blank?.name ?? '无'],
    ['AI服务商', audit.ai?.provider ?? '未使用'], ['AI模型', audit.ai?.model ?? '未使用'],
    ['AI分析说明', audit.ai?.summary ?? '手动处理'],
    ['数据说明', '排除区域留空，不插值补峰；处理数据独立于原始工作区；未自动更新校准或浓度计算'],
  ].map(([参数, 值]) => ({ 参数, 值 }));
  return { raw, processed, changes, settings };
}
export async function buildProcessingWorkbook(result: ProcessingResult, audit: ProcessingAudit) {
  const XLSX = await import('xlsx'), wb = XLSX.utils.book_new(), tables = processingTables(result, audit);
  for (const [name, rows, header] of [
    ['原始数据', tables.raw, ['光谱标识', '光谱', '来源', '波长_nm', '原始强度']],
    ['处理数据', tables.processed, ['光谱标识', '光谱', '波长_nm', '原始强度', '空白强度_含范围内插值', '处理强度', '状态', '理由']],
    ['修改记录', tables.changes, ['光谱', '起点_nm', '终点_nm', '来源', '是否应用', '理由']],
    ['处理参数', tables.settings, ['参数', '值']],
  ] as const) {
    const sheet = XLSX.utils.json_to_sheet(rows as Record<string, unknown>[], { header: [...header] });
    sheet['!cols'] = header.map((h) => ({ wch: h === '理由' || h === '值' ? 65 : 22 }));
    XLSX.utils.book_append_sheet(wb, sheet, name);
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
export async function exportProcessing(result: ProcessingResult, audit: ProcessingAudit) {
  const data = await buildProcessingWorkbook(result, audit);
  downloadBlob(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename('光谱干扰处理', 'xlsx'));
}
