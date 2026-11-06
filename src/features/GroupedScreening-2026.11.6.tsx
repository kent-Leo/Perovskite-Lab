import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2, Upload } from 'lucide-react';
import { Worksheet } from '../components/Worksheet-v0.2.0-2026.10.19';
import { ErrorNote, Field, SectionHead } from '../components/ui';
import {
  editGroupedGrid, groupedGrid, groupedStatistics, groupedStructureReason, importGroupedTable,
  structureGrouped, type GroupedCellField,
} from '../domain/grouped-bar-2026.11.6';
import { fmt, numeric } from '../domain/math';
import { createSheetWithPayload } from '../domain/workbook';
import type { GroupedBarSheet, GroupedBarSeries, GroupedInputMode } from '../domain/types';
import type { WorksheetColumn } from '../domain/worksheet-v0.2.0-2026.10.19';
import type { WorksheetStructureAction } from '../domain/worksheet-structure-2026.11.5';
import { readDataFile, type ImportFile } from '../services/import';
import { exportGroupedExcel } from '../services/download';
import { useWorkspace } from '../state/workspace';
import type { WorkbookApi } from '../state/useWorkbook';
import type { SheetHistoryApi } from '../state/useSheetHistory-2026.11.5';

export type GroupedChange = GroupedBarSheet | ((current: GroupedBarSheet) => GroupedBarSheet);

/** Reuses Worksheet selection, clipboard, history and row/column context menus. */
export function GroupedScreening({ sheet, onChange, workbook, history }: {
  sheet: GroupedBarSheet;
  onChange: (change: GroupedChange) => void;
  workbook: WorkbookApi;
  history: SheetHistoryApi;
}) {
  const { update, notify } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ImportFile | null>(null);
  const [tableIndex, setTableIndex] = useState(0);
  const [header, setHeader] = useState(true);
  const [importMode, setImportMode] = useState<GroupedInputMode>('statistics');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const field: GroupedCellField = sheet.options.inputMode === 'replicates' ? 'replicates' : 'mean';
  const errorField: GroupedCellField | null = sheet.options.errorMode === 'manual' ? 'manualError'
    : sheet.options.inputMode === 'statistics' && sheet.options.errorMode !== 'none' ? sheet.options.errorMode : null;
  const errorLabel = sheet.options.errorMode === 'sd' ? 'SD' : sheet.options.errorMode === 'sem' ? 'SEM' : '手动误差';
  const setSeries = (id: string, patch: Partial<GroupedBarSeries>) => onChange((current) => ({ ...current,
    series: current.series.map((series) => series.id === id ? { ...series, ...patch } : series),
  }));
  function structure(action: WorksheetStructureAction) {
    try { onChange(structureGrouped(sheet, action)); } catch (cause) { notify((cause as Error).message); }
  }
  function moveSeries(from: number, to: number) {
    if (to < 0 || to >= sheet.series.length) return;
    const series = [...sheet.series];
    series.splice(to, 0, series.splice(from, 1)[0]);
    onChange({ ...sheet, series });
  }
  const columns: WorksheetColumn[] = [
    { key: 'category', title: '分析对象名称', designation: 'Label', headerFields: [] },
    ...sheet.series.map((series): WorksheetColumn => ({ key: series.id, title: series.name,
      unit: series.unit, comment: series.comment, designation: 'Y', type: field === 'replicates' ? undefined : 'number' })),
  ];
  const shared = { externalHistory: history, minRows: Math.max(6, sheet.categories.length),
    onStructure: structure, canStructure: (action: WorksheetStructureAction) => groupedStructureReason(sheet, action) };
  const summaries = sheet.categories.flatMap((category) => sheet.series.map((series) => {
    try {
      return { category, series, stats: groupedStatistics(category.cells[series.id], sheet.options.inputMode, sheet.options.errorMode), error: '' };
    } catch (cause) { return { category, series, stats: null, error: (cause as Error).message }; }
  }));
  const hasInvalid = summaries.some((row) => row.error);
  async function read(file: File | undefined) {
    if (!file) return;
    setReading(true); setError('');
    try { setPending(await readDataFile(file)); setTableIndex(0); }
    catch (cause) { setError((cause as Error).message); }
    finally { setReading(false); if (input.current) input.current.value = ''; }
  }
  function importNewSheet() {
    if (!pending) return;
    try {
      const table = pending.sheets[tableIndex];
      const groupedScreening = importGroupedTable(table.rows, header, importMode);
      update((previous) => createSheetWithPayload(previous, 'screening', table.name === '数据' ? pending.name.replace(/\.[^.]+$/, '') : table.name,
        { objects: [], blankId: '', screenMode: 'F', screeningChartType: 'grouped', groupedScreening }));
      setPending(null); setError(''); notify('已导入为新的分组柱状图 Sheet');
    } catch (cause) { setError((cause as Error).message); }
  }
  return <section className="panel grouped-data" data-testid="grouped-data">
    <SectionHead title="分组柱状图数据" detail="空白表示缺失；零值保留。每个系列对应一列，原单系列数据单独保留。"
      action={<div className="button-group">
        <button className="small-button" disabled={reading} onClick={() => input.current?.click()}><Upload size={15} />{reading ? '读取中…' : '导入宽表'}</button>
        <button className="small-button" onClick={() => structure({ type: 'append-row', count: 1 })}><Plus size={15} />添加分类</button>
        <button className="small-button primary" onClick={() => structure({ type: 'append-column', count: 1 })}><Plus size={15} />添加系列</button>
      </div>} />
    <input ref={input} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" hidden aria-label="分组数据文件" onChange={(event) => void read(event.target.files?.[0])} />
    {pending && <div className="grouped-import" role="region" aria-label="导入分组宽表">
      <p><strong>{pending.name}</strong> · 将创建新 Sheet，现有数据保留。</p>
      <div className="form-grid">
        <Field label="文件中的工作表"><select value={tableIndex} onChange={(e) => setTableIndex(Number(e.target.value))}>{pending.sheets.map((table, i) => <option key={i} value={i}>{table.name}</option>)}</select></Field>
        <Field label="导入数值类型"><select value={importMode} onChange={(e) => setImportMode(e.target.value as GroupedInputMode)}><option value="statistics">平均值宽表</option><option value="replicates">重复测量宽表（单元格内分号分隔）</option></select></Field>
      </div>
      <label className="check-line"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />第一行为系列名称</label>
      <pre className="grouped-import-preview">{pending.sheets[tableIndex].rows.slice(0, 4).map((row) => row.map((value) => String(value ?? '')).join('\t')).join('\n')}</pre>
      <div className="button-group"><button className="small-button primary" onClick={importNewSheet}>导入到新 Sheet</button><button className="small-button" onClick={() => setPending(null)}>取消</button></div>
    </div>}
    {error && <ErrorNote>{error}</ErrorNote>}
    <div className="analysis-controls">
      <Field label="分组数据输入"><select value={sheet.options.inputMode} onChange={(e) => onChange({ ...sheet, options: { ...sheet.options, inputMode: e.target.value as GroupedInputMode } })}>
        <option value="statistics">直接输入统计结果</option><option value="replicates">输入重复测量</option>
      </select></Field>
      <Field label="误差棒"><select value={sheet.options.errorMode} onChange={(e) => onChange({ ...sheet, options: { ...sheet.options, errorMode: e.target.value as GroupedBarSheet['options']['errorMode'] } })}>
        <option value="none">不显示</option><option value="sd">标准差 SD</option><option value="sem">标准误 SEM</option><option value="manual">手动误差</option>
      </select></Field>
      <p className="inline-explainer">{field === 'replicates' ? '每个单元格填写如 10;12;14。空项不计入 n；n < 2 时 SD / SEM 留空。' : '主表填写平均值，选中误差类型后在下方误差表填写。'} 两种输入分别保存，切换不覆盖。</p>
    </div>
    <details className="grouped-series" open>
      <summary>数据系列 · {sheet.series.length} 组</summary>
      <div className="grouped-series-list">{sheet.series.map((series, index) => <div className="grouped-series-row" key={series.id}>
        <label className="check-line"><input type="checkbox" aria-label={`显示系列 ${index + 1}`} checked={series.visible} onChange={(e) => setSeries(series.id, { visible: e.target.checked })} />{index + 1}</label>
        <input aria-label={`系列名称 ${index + 1}`} value={series.name} onChange={(e) => setSeries(series.id, { name: e.target.value })} />
        <input type="color" aria-label={`系列颜色 ${index + 1}`} value={series.color} onChange={(e) => setSeries(series.id, { color: e.target.value })} />
        <div className="row-actions">
          <button aria-label={`上移系列 ${index + 1}`} disabled={!index} onClick={() => moveSeries(index, index - 1)}><ChevronUp size={15} /></button>
          <button aria-label={`下移系列 ${index + 1}`} disabled={index === sheet.series.length - 1} onClick={() => moveSeries(index, index + 1)}><ChevronDown size={15} /></button>
          <button aria-label={`删除系列 ${index + 1}`} disabled={sheet.series.length === 1} onClick={() => {
            if (window.confirm(`删除系列「${series.name}」及其中的数据？可撤销恢复。`)) structure({ type: 'delete-column', index: index + 1, count: 1 });
          }}><Trash2 size={15} /></button>
        </div>
      </div>)}</div>
    </details>
    <Worksheet {...shared} book={field === 'replicates' ? '分组重复测量' : '分组平均值'} sheet={workbook.activeName}
      sheetTabs={workbook.tabs} activeSheetId={workbook.activeId} onSelectSheet={workbook.select}
      onCreateSheet={workbook.create} onDeleteSheet={workbook.remove} onRenameSheet={workbook.rename}
      columns={columns} rows={groupedGrid(sheet, field)}
      onChange={(rows) => onChange(editGroupedGrid(sheet, rows, field))}
      onMetadataChange={(column, name, value) => {
        const series = sheet.series[column - 1];
        if (series) setSeries(series.id, { [name === 'title' ? 'name' : name]: value });
      }}
      onMoveRow={(from, to) => {
        if (from === to || !sheet.categories[from] || to < 0 || to >= sheet.categories.length) return;
        const categories = [...sheet.categories];
        categories.splice(to, 0, categories.splice(from, 1)[0]); onChange({ ...sheet, categories });
      }}
      cellLabel={(row, column) => column ? `分组数值 ${row + 1} ${column}` : `分组对象 ${row + 1}`}
      invalidCell={(row, column) => {
        if (!column) return !sheet.categories[row]?.name.trim() && summaries.some((entry) => entry.category === sheet.categories[row] && entry.stats?.mean != null);
        const cell = sheet.categories[row]?.cells[sheet.series[column - 1]?.id];
        try { groupedStatistics(cell, sheet.options.inputMode, sheet.options.errorMode); return false; } catch { return true; }
      }} />
    {errorField && <div className="grouped-error-table" data-testid="grouped-errors">
      <SectionHead title={`${errorLabel} 输入`} detail="非负数；空白表示未提供误差，不生成误差棒。" />
      <Worksheet {...shared} book={errorLabel} sheet={workbook.activeName} columns={columns.map((column, index) => ({ ...column, readOnly: !index, type: index ? 'number' : undefined }))}
        rows={groupedGrid(sheet, errorField)} onChange={(rows) => onChange(editGroupedGrid(sheet, rows, errorField))}
        cellLabel={(row, column) => column ? `分组误差 ${row + 1} ${column}` : `误差对象 ${row + 1}`}
        invalidCell={(row, column) => {
          const value = column ? sheet.categories[row]?.cells[sheet.series[column - 1]?.id]?.[errorField] : '';
          return typeof value === 'string' && !!value.trim() && (numeric(value) === null || numeric(value)! < 0);
        }} />
    </div>}
    <details className="grouped-statistics"><summary>统计结果（Mean / SD / SEM / n）</summary>
      <div className="grouped-statistics-scroll"><table><thead><tr>{['分析对象', '系列', 'Mean', 'SD', 'SEM', 'n', '当前误差'].map((name) => <th key={name}>{name}</th>)}</tr></thead>
        <tbody>{summaries.map(({ category, series, stats, error: problem }) => <tr key={`${category.id}-${series.id}`}>
          <td>{category.name || '未命名'}</td><td>{series.name}</td>{stats ? [stats.mean, stats.sd, stats.sem, stats.n, stats.error].map((value, i) => <td key={i}>{value === null ? '—' : fmt(value, 8)}</td>) : <td colSpan={5}>{problem}</td>}
        </tr>)}</tbody></table></div>
      <p className="muted">直接输入统计结果时 n 未知；重复测量使用样本标准差（n−1），SEM = SD / √n。所有系列均保留在统计与数据导出中，隐藏系列不绘图。</p>
    </details>
    <div className="panel-foot"><span className="muted">右键可插入或删除行 / 系列列，撤销重做包含结构与样式修改。</span>
      <button className="text-button" disabled={!sheet.categories.length || hasInvalid} onClick={() => exportGroupedExcel(sheet).catch((cause) => notify(cause.message))}>导出分组数据 Excel</button>
    </div>
  </section>;
}
