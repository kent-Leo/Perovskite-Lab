import { APP_VERSION } from '../version-v0.9.0-2026.10.27';
import { finiteValue, preprocessingLabel, type AnalysisTable, type RecognitionAnalysis, type RecognitionData } from '../domain/recognition-2026.10.27';
import { dateStamp, downloadBlob, filename } from './download';

/** Single source for on-screen result sheets, saved snapshots and full-precision XLSX. */
export function recognitionTables(d: RecognitionData, a: RecognitionAnalysis): AnalysisTable[] {
  const meta = ['样本 ID', '离子种类', '平行编号'];
  const metadata = (i: number) => [d.rows[i].sample, d.rows[i].ion, d.rows[i].replicate];
  const pcs = a.pca?.explained.map((_, i) => `PC${i + 1}`) ?? [];
  const rank = a.pca?.rank ?? 0;
  const pcX = d.settings.pcX < rank ? d.settings.pcX : 0;
  const pcY = d.settings.pcY < rank && d.settings.pcY !== pcX ? d.settings.pcY : pcX === 0 ? 1 : 0;
  const tables: AnalysisTable[] = [
    { name: '猝灭率', headers: [...meta, ...d.probes.flatMap((p) => [`${p.name} q`, `${p.name} Q (%)`])],
      rows: a.q.map((row, i) => [...metadata(i), ...row.flatMap((q) => [q, q === null ? null : q * 100])]) },
    { name: 'PCA得分', headers: [...meta, ...pcs], rows: a.pca?.scores.map((row, i) => [...metadata(i), ...row]) ?? [] },
    { name: 'PCA载荷', headers: ['探针', '探针 ID', ...pcs], rows: a.pca?.loadings.map((row, i) => [a.selected[i].name, a.selected[i].id, ...row]) ?? [] },
    { name: '方差解释率', headers: ['主成分', '特征值', '解释率 (%)', '累计解释率 (%)'],
      rows: a.pca?.explained.map((value, i) => [`PC${i + 1}`, a.pca!.eigenvalues[i], value * 100, a.pca!.cumulative[i] * 100]) ?? [] },
    { name: '聚类结果', headers: [...meta, '簇编号', '实验行 ID'], rows: a.clusters?.map((cluster, i) => [...metadata(i), cluster, d.rows[i].id]) ?? [] },
    { name: 'Ward合并', headers: ['新节点 (0-based)', '左节点', '右节点', 'Ward距离', '样本数'],
      rows: a.hierarchy?.merges.map((m, i) => [d.rows.length + i, m.left, m.right, m.height, m.size]) ?? [] },
  ];
  if (d.intensitySource) {
    const source = d.intensitySource;
    tables.push(
      { name: '历史原始强度', headers: [...meta, '空白批次', '批次 ID', '实验行 ID', ...source.probes.map((p) => `${p.name} F`)],
        rows: source.rows.map((row) => [row.sample, row.ion, row.replicate,
          source.batches.find((b) => b.id === row.batchId)?.name ?? '', row.batchId, row.id,
          ...source.probes.map((p) => finiteValue(row.values[p.id]) ?? row.values[p.id] ?? '')]) },
      { name: '历史空白与批次', headers: ['批次', '批次 ID', ...source.probes.map((p) => `${p.name} F₀`)],
        rows: source.batches.map((batch) => [batch.name, batch.id,
          ...source.probes.map((p) => finiteValue(batch.values[p.id]) ?? batch.values[p.id] ?? '')]) },
    );
  }
  tables.push({ name: '分析设置', headers: ['设置', '值'], rows: [
    ['软件版本', `v${APP_VERSION}`], ['导出日期', dateStamp()], ['数据来源', d.demo ? '演示数据（人工生成）' : '用户录入'],
    ['输入方式', d.inputMode === 'q' ? '直接录入猝灭率 q；带 % 的数值除以 100' : '历史强度换算'],
    ['响应公式', 'q=(F₀−F)/F₀; Q=q×100%'], ['预处理', preprocessingLabel(d.settings.preprocessing)],
    ['Z-score标准差', '样本标准差 ddof=1'], ['聚类输入', '完整所选探针响应矩阵，与 PCA 采用相同预处理'],
    ['距离', '欧氏距离'], ['连接方法', 'Ward'], ['平行实验', '每行独立保留；不求平均'],
    ['载荷定义', '协方差矩阵单位特征向量；得分=X预处理×载荷；符号不唯一'],
    ['缺失值', '阻止分析；不补零、不删样本'], ['实际样本数', d.rows.length], ['有效主成分数', a.pca?.rank ?? 0],
    ['聚类截断', d.settings.cutMode === 'count' ? `簇数=${d.settings.clusterCount}` : `高度=${d.settings.cutHeight}`],
    ['热图', d.settings.heatmap === 'q' ? '原始 q' : 'Z-score (ddof=1)'],
    ['横轴主成分 (1-based)', pcX + 1], ['纵轴主成分 (1-based)', rank < 2 ? '无二维图' : pcY + 1],
    ['显示小数位（内部与导出不舍入）', d.settings.decimals],
    ...d.probes.map((p): (string | number)[] => [`探针 ${p.id}`, JSON.stringify(p)]),
    ...a.selected.flatMap((p, i) => [[`预处理均值 ${p.id}`, a.prepared?.means[i] ?? ''], [`预处理缩放 ${p.id}`, a.prepared?.scales[i] ?? '']]),
    ['全部设置 JSON', JSON.stringify(d.settings)],
  ] });
  return tables;
}
export async function recognitionExcel(d: RecognitionData, a: RecognitionAnalysis) {
  if (a.errors.length || !a.pca || !a.clusters) throw new Error('请先修正数据，再导出完整分析结果');
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const table of recognitionTables(d, a)) {
    const ws = XLSX.utils.aoa_to_sheet([table.headers, ...table.rows]);
    ws['!cols'] = table.headers.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws, table.name);
  }
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename('多探针识别分析', 'xlsx'));
}
