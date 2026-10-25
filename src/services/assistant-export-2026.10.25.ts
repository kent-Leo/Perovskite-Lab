import type { AiProvider } from '../../shared/ai-contract-2026.10.24';
import type {
  AssistantAnomaly,
  AssistantPoint,
  AssistantProcessingResult,
} from '../domain/assistant-processing-2026.10.25';
import type { ParsedSpectrumFile } from './f7100-2026.10.25';
import { APP_VERSION } from '../version-v0.7.0-2026.10.24';
import { dateStamp, downloadBlob, filename } from './download';

/** Audit metadata only. Never include API keys, AI sessions or request headers. */
export interface AssistantAudit {
  fileName: string;
  sheetName: string;
  excitationNm: number | null;
  solvent: string;
  ai: { provider: AiProvider; model: string; summary: string; notes: string[] } | null;
  userInstructions: string[];
  exportedOn: string;
}

export interface AssistantExportInput {
  parsed: ParsedSpectrumFile;
  result: AssistantProcessingResult;
  audit: AssistantAudit;
}

const STATUS_LABEL: Record<AssistantPoint['status'], string> = {
  normal: '正常',
  repaired: '已修复',
  masked: '已屏蔽',
  unresolved: '仅标记',
};
const KIND_LABEL: Record<NonNullable<AssistantPoint['anomalyKind']> | AssistantAnomaly['kind'], string> = {
  'positive-spike': '孤立正异常尖峰',
  'negative-spike': '孤立负异常尖峰',
  scattering: '疑似散射干扰',
  unrepairable: '连续异常区间',
};

export function assistantOriginalRows(input: AssistantExportInput) {
  return input.result.points.map((point, index) => ({
    来源文件: input.parsed.fileName,
    源文件行号: point.rowNumber ?? input.parsed.rowNumbers[index] ?? '',
    序号: index + 1,
    波长_nm: point.x,
    原始强度: point.original,
    空白强度_插值: point.blank ?? '',
    保护状态: point.protected ? '目标峰保护区内' : '',
  }));
}

export function assistantProcessedRows(input: AssistantExportInput) {
  return input.result.points.map((point, index) => ({
    来源文件: input.parsed.fileName,
    源文件行号: point.rowNumber ?? input.parsed.rowNumbers[index] ?? '',
    序号: index + 1,
    波长_nm: point.x,
    原始强度: point.original,
    空白强度_插值: point.blank ?? '',
    处理后强度: point.processed ?? '',
    异常标记: point.anomalyKind ? KIND_LABEL[point.anomalyKind] : '',
    处理状态: STATUS_LABEL[point.status],
    处理方法: point.method,
    处理理由: point.reason,
    保护状态: point.protected ? '是' : '',
  }));
}

export function assistantAnomalyRows(result: AssistantProcessingResult) {
  const rows: Record<string, unknown>[] = [];
  for (const anomaly of result.anomalies) {
    anomaly.wavelengths.forEach((wavelength, index) => {
      rows.push({
        记录号: anomaly.id,
        异常类型: KIND_LABEL[anomaly.kind],
        处理状态:
          anomaly.status === 'repaired'
            ? '已修复'
            : anomaly.status === 'masked'
              ? '已屏蔽'
              : anomaly.status === 'suggested'
                ? '仅标记，未修改'
                : '保留待人工判断',
        区间起点_nm: anomaly.fromNm,
        区间终点_nm: anomaly.toNm,
        波长_nm: wavelength,
        原始值: anomaly.originalValues[index],
        修复值: anomaly.processedValues[index] ?? '',
        最大偏离σ: Number(anomaly.deviation.toFixed(3)),
        方法: anomaly.method,
        理由: anomaly.reason,
        AI辅助说明: anomaly.aiNote ?? '',
      });
    });
  }
  return rows;
}

export function assistantReportRows(input: AssistantExportInput) {
  const { parsed, result, audit } = input;
  const rows: { 项目: string; 内容: string | number }[] = [];
  const push = (item: string, content: string | number | null | undefined) =>
    rows.push({ 项目: item, 内容: content ?? '' });
  push('报告生成日期', audit.exportedOn || dateStamp());
  push('软件版本', APP_VERSION);
  push('处理算法版本', result.algorithmVersion);
  push('文件名称', parsed.fileName);
  push('样品名称', parsed.metadata.sample || '未识别');
  push('建议 Sheet 名称', audit.sheetName);
  push('仪器型号', parsed.metadata.instrument || '未识别');
  push('仪器序列号', parsed.metadata.serial || '未识别');
  push('测量日期', parsed.metadata.measuredOn || parsed.metadata.runDate || '未识别');
  push('激发波长_nm', audit.excitationNm ?? parsed.metadata.excitationNm ?? '未识别');
  push('溶剂或基质', audit.solvent || '未填写');
  push('发射扫描范围_nm', `${parsed.points[0].x}–${parsed.points.at(-1)!.x}`);
  push('数据点数量', parsed.points.length);
  push('源文件总行数', parsed.totalLines);
  push('数据起始行', parsed.dataStartLine);
  push('表头行', parsed.headerLine ?? '无');
  push('文本编码', parsed.encoding);
  push('分隔符', parsed.delimiter === '\t' ? '制表符' : parsed.delimiter);
  push('跳过行数', parsed.skippedRows);
  push('解析警告', parsed.warnings.join(' | ') || '无');
  push('灵敏度', result.parameters.sensitivity);
  push('异常识别阈值σ', result.parameters.thresholdSigma);
  push('Hampel 窗口_点', result.parameters.windowSize);
  push('最大局部修复跨度_点', result.parameters.maxRepairRun);
  push('局部修复开关', result.parameters.repairSpikes ? '开启' : '仅标记');
  push('主峰自动保护', result.parameters.protectMainPeak ? '开启' : '关闭');
  push('主峰额外保护边界_nm', result.parameters.protectExtraNm);
  push('手动保护区_nm', result.parameters.userProtectedRange
    ? `${result.parameters.userProtectedRange.fromNm}–${result.parameters.userProtectedRange.toNm}`
    : '未设置');
  push('自动保护区_nm', result.autoProtectedRange
    ? `${result.autoProtectedRange.fromNm}–${result.autoProtectedRange.toNm}`
    : '未识别');
  push('重分析区间_nm', result.parameters.analysisRange
    ? `${result.parameters.analysisRange.fromNm}–${result.parameters.analysisRange.toNm}`
    : '全范围');
  push('散射区间屏蔽', result.parameters.maskScattering ? '开启' : '仅标记');
  push('空白扣除', result.blank ? `开启；${result.blank.name}；${result.blank.coverage}` : '未启用');
  push('处理结果_局部修复点', result.stats.repaired);
  push('处理结果_屏蔽点', result.stats.masked);
  push('处理结果_待判断点', result.stats.unresolved);
  push('处理结果_保护点', result.stats.protectedPoints);
  push('主发射峰_nm', result.mainPeak?.originalX ?? '未识别');
  push('主峰强度比_处理后/空白扣除', result.mainPeak?.heightRatio?.toFixed(5) ?? '不适用');
  const checkStatus = { pass: '通过', warn: '注意', fail: '失败' } as const;
  result.checks.forEach((check) =>
    push(`质量检查_${check.label}`, `${checkStatus[check.status]}；${check.detail}`),
  );
  result.warnings.forEach((warning, index) => push(`处理警告_${index + 1}`, warning));
  push('AI服务商', audit.ai?.provider ?? '未使用');
  push('AI模型', audit.ai?.model ?? '未使用');
  push('AI分析说明', audit.ai?.summary ?? '未使用 AI；结果为本地确定性算法生成');
  audit.ai?.notes.forEach((note, index) => push(`AI异常分类_${index + 1}`, note));
  audit.userInstructions.forEach((instruction, index) => push(`用户指令_${index + 1}`, instruction));
  push(
    '数据完整性声明',
    '原始数据表逐行保存原始波长与强度；处理后数据表保留原始强度与屏蔽空值；所有算法修正均可追溯到异常记录与参数。',
  );
  return rows;
}

/** Four editable, traceable worksheets; no formulas and no hidden deletions. */
export async function buildAssistantWorkbook(input: AssistantExportInput) {
  const XLSX = await import('xlsx'),
    wb = XLSX.utils.book_new(),
    original = assistantOriginalRows(input),
    processed = assistantProcessedRows(input),
    anomalies = assistantAnomalyRows(input.result),
    report = assistantReportRows(input);
  const add = (
    name: string,
    rows: Record<string, unknown>[],
    header: string[],
    widths: Record<string, number>,
  ) => {
    const sheet = rows.length
      ? XLSX.utils.json_to_sheet(rows, { header })
      : XLSX.utils.aoa_to_sheet([header]);
    sheet['!cols'] = header.map((column) => ({ wch: widths[column] ?? 18 }));
    XLSX.utils.book_append_sheet(wb, sheet, name);
  };
  add(
    '原始数据',
    original,
    ['来源文件', '源文件行号', '序号', '波长_nm', '原始强度', '空白强度_插值', '保护状态'],
    { 来源文件: 34, 波长_nm: 12, 原始强度: 14, 空白强度_插值: 16, 保护状态: 20 },
  );
  add(
    '处理后数据',
    processed,
    [
      '来源文件',
      '源文件行号',
      '序号',
      '波长_nm',
      '原始强度',
      '空白强度_插值',
      '处理后强度',
      '异常标记',
      '处理状态',
      '处理方法',
      '处理理由',
      '保护状态',
    ],
    {
      来源文件: 34,
      波长_nm: 12,
      原始强度: 14,
      空白强度_插值: 16,
      处理后强度: 14,
      异常标记: 22,
      处理状态: 12,
      处理方法: 32,
      处理理由: 70,
      保护状态: 10,
    },
  );
  add(
    '杂峰处理记录',
    anomalies,
    [
      '记录号',
      '异常类型',
      '处理状态',
      '区间起点_nm',
      '区间终点_nm',
      '波长_nm',
      '原始值',
      '修复值',
      '最大偏离σ',
      '方法',
      '理由',
      'AI辅助说明',
    ],
    {
      异常类型: 22,
      处理状态: 18,
      区间起点_nm: 14,
      区间终点_nm: 14,
      波长_nm: 12,
      原始值: 14,
      修复值: 14,
      最大偏离σ: 12,
      方法: 36,
      理由: 76,
      AI辅助说明: 50,
    },
  );
  add('AI分析报告', report, ['项目', '内容'], { 项目: 34, 内容: 100 });
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export async function exportAssistantWorkbook(input: AssistantExportInput) {
  const data = await buildAssistantWorkbook(input);
  const base = input.parsed.fileName.replace(/\.[^.]+$/, '');
  downloadBlob(
    new Blob([data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename(`${base}-AI光谱处理`, 'xlsx'),
  );
}
