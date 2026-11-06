import { numeric, sampleSD } from './math';
import {
  defaultStyle, palette, uid,
  type GroupedBarCell, type GroupedBarOptions, type GroupedBarSheet,
  type GroupedErrorMode, type GroupedInputMode, type PlotData,
} from './types';
import { structureAxis, structureCount, structureStart, STRUCTURE_LIMITS, type WorksheetStructureAction } from './worksheet-structure-2026.11.5';

export const emptyGroupedCell = (): GroupedBarCell => ({
  mean: '', sd: '', sem: '', manualError: '', replicates: [],
});

export const defaultGroupedOptions = (): GroupedBarOptions => ({
  inputMode: 'statistics', errorMode: 'none', barWidth: 28, innerGap: 5,
  groupGap: 24, fill: 'solid', borderColor: '#243b39', borderWidth: 0,
  errorColor: '#243b39', errorWidth: 1.5, errorCapWidth: 10, categoryAngle: -30,
});

export function defaultGroupedBar(): GroupedBarSheet {
  return {
    categories: [],
    series: Array.from({ length: 3 }, (_, i) => ({
      id: uid(), name: `系列 ${i + 1}`, color: palette[i], visible: true,
    })),
    options: defaultGroupedOptions(),
    style: { ...defaultStyle('screening'), yLabel: 'Mean', legend: 'right', grid: false },
  };
}

export interface GroupedStatistics {
  mean: number | null;
  sd: number | null;
  sem: number | null;
  n: number | null;
  error: number | null;
}

function optionalNumber(value: string | undefined, label: string, nonnegative = false): number | null {
  if (!value?.trim()) return null;
  const parsed = numeric(value);
  if (parsed === null || (nonnegative && parsed < 0))
    throw new Error(`${label}必须是${nonnegative ? '非负' : '有效'}数值`);
  return parsed;
}

/** Missing replicates are omitted; invalid non-empty entries must not be silently dropped. */
export function groupedStatistics(
  input: GroupedBarCell | undefined,
  inputMode: GroupedInputMode,
  errorMode: GroupedErrorMode,
): GroupedStatistics {
  const cell = input ?? emptyGroupedCell();
  let mean: number | null = null, sd: number | null = null, sem: number | null = null;
  let n: number | null = null;
  if (inputMode === 'replicates') {
    const values = (cell.replicates ?? []).flatMap((raw) => {
      const value = optionalNumber(raw, '重复测量值');
      return value === null ? [] : [value];
    });
    n = values.length;
    if (n) mean = values.reduce((sum, value) => sum + value / n!, 0);
    if (n >= 2) {
      sd = sampleSD(values);
      sem = sd / Math.sqrt(n);
      if (!Number.isFinite(sd) || !Number.isFinite(sem)) throw new Error('重复测量统计结果超出数值范围');
    }
  } else {
    mean = optionalNumber(cell.mean, '平均值');
    sd = optionalNumber(cell.sd, '标准差', true);
    sem = optionalNumber(cell.sem, '标准误', true);
  }
  const manual = optionalNumber(cell.manualError, '手动误差值', true);
  if (mean !== null && !Number.isFinite(mean)) throw new Error('平均值超出数值范围');
  return { mean, sd, sem, n, error: errorMode === 'sd' ? sd : errorMode === 'sem' ? sem : errorMode === 'manual' ? manual : null };
}

export type GroupedCellField = 'mean' | 'sd' | 'sem' | 'manualError' | 'replicates';
export const splitReplicates = (value: string) => value === '' ? [] : value.split(/[,;，；\n]/);

export function groupedGrid(sheet: GroupedBarSheet, field: GroupedCellField): string[][] {
  return sheet.categories.map((category) => [category.name, ...sheet.series.map((series) => {
    const cell = category.cells[series.id];
    return field === 'replicates' ? (cell?.replicates ?? []).join(';') : cell?.[field] ?? '';
  })]);
}

/** Editing one view never replaces hidden measurements or the other input mode. */
export function editGroupedGrid(sheet: GroupedBarSheet, rows: string[][], field: GroupedCellField): GroupedBarSheet {
  return { ...sheet, categories: Array.from({ length: Math.max(rows.length, sheet.categories.length) }, (_, index) => {
    const previous = sheet.categories[index], row = rows[index] ?? [];
    const cells = { ...previous?.cells };
    sheet.series.forEach((series, column) => {
      const raw = row[column + 1] ?? '';
      cells[series.id] = { ...emptyGroupedCell(), ...cells[series.id],
        [field]: field === 'replicates' ? splitReplicates(raw) : raw };
    });
    // Worksheet trims rows whose EDITABLE cells are all empty. In the error
    // view the name is read-only, so a trimmed row must retain its category.
    const name = field === 'mean' || field === 'replicates' ? row[0] ?? '' : previous?.name ?? row[0] ?? '';
    return { id: previous?.id ?? uid(), name, cells };
  }) };
}

export function groupedStructureReason(sheet: GroupedBarSheet, action: WorksheetStructureAction): string | null {
  const count = structureCount(action.count), start = structureStart(action);
  if (structureAxis(action) === 'column') {
    if (start === 0) return '第一列为分析对象名称，请在数据系列列上操作';
    if (action.type === 'delete-column' && sheet.series.length - Math.min(count, sheet.series.length - (start - 1)) < 1)
      return '至少保留一个数据系列';
    if (action.type !== 'delete-column' && sheet.series.length + count >= STRUCTURE_LIMITS.columns)
      return `最多支持 ${STRUCTURE_LIMITS.columns - 1} 个数据系列`;
  } else if (action.type !== 'delete-row' && sheet.categories.length + count > STRUCTURE_LIMITS.rows) {
    return '工作表已达到行数上限';
  }
  return null;
}

/** Stable IDs keep cells attached to their series through reorder / insertion. */
export function structureGrouped(sheet: GroupedBarSheet, action: WorksheetStructureAction): GroupedBarSheet {
  const reason = groupedStructureReason(sheet, action);
  if (reason) throw new Error(reason);
  const count = structureCount(action.count);
  if (structureAxis(action) === 'row') {
    const at = action.type === 'append-row' ? sheet.categories.length : Math.min(structureStart(action), sheet.categories.length);
    const categories = [...sheet.categories];
    if (action.type === 'delete-row') categories.splice(at, count);
    else categories.splice(at, 0, ...Array.from({ length: count }, () => ({ id: uid(), name: '', cells: {} })));
    return { ...sheet, categories };
  }
  const at = action.type === 'append-column' ? sheet.series.length : Math.min(structureStart(action) - 1, sheet.series.length);
  const series = [...sheet.series];
  if (action.type === 'delete-column') {
    const removed = new Set(series.splice(at, count).map((item) => item.id));
    return { ...sheet, series, categories: sheet.categories.map((category) => ({ ...category,
      cells: Object.fromEntries(Object.entries(category.cells).filter(([id]) => !removed.has(id))),
    })) };
  }
  const names = new Set(series.map((item) => item.name));
  const added = Array.from({ length: count }, (_, index) => {
    let suffix = 1;
    while (names.has(`系列 ${suffix}`)) suffix++;
    const name = `系列 ${suffix}`;
    names.add(name);
    return { id: uid(), name, color: palette[(series.length + index) % palette.length], visible: true };
  });
  series.splice(at, 0, ...added);
  return { ...sheet, series };
}

/** Import into a NEW sheet. Header and input mode are explicit choices in the UI. */
export function importGroupedTable(rows: unknown[][], header: boolean, inputMode: GroupedInputMode): GroupedBarSheet {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width < 2) throw new Error('需要一列对象名称和至少一列数据系列');
  if (width > STRUCTURE_LIMITS.columns || rows.length > STRUCTURE_LIMITS.rows)
    throw new Error(`表格过大，最多 ${STRUCTURE_LIMITS.columns - 1} 个系列、${STRUCTURE_LIMITS.rows} 行`);
  const sheet = defaultGroupedBar();
  sheet.options.inputMode = inputMode;
  sheet.series = Array.from({ length: width - 1 }, (_, i) => ({
    id: uid(), name: (header ? String(rows[0]?.[i + 1] ?? '').trim() : '') || `系列 ${i + 1}`,
    color: palette[i % palette.length], visible: true,
  }));
  const data = rows.slice(header ? 1 : 0).map((row) => Array.from({ length: width }, (_, i) => String(row[i] ?? '')));
  // Only trim completely empty trailing rows; interior blanks preserve category order.
  while (data.length && data.at(-1)!.every((cell) => !cell.trim())) data.pop();
  if (!data.length) throw new Error('表格中没有数据行');
  return editGroupedGrid(sheet, data, inputMode === 'replicates' ? 'replicates' : 'mean');
}

/** Separate sheets retain both original input modes and all calculated statistics. */
export function groupedExportTables(sheet: GroupedBarSheet): { name: string; rows: (string | number | null)[][] }[] {
  const summary: (string | number | null)[][] = [['分析对象', '系列', '显示', '输入方式', 'Mean', 'SD', 'SEM', 'n', '误差类型', '误差值']];
  const raw: (string | number | null)[][] = [['分析对象', '系列', '重复序号', '原始值']];
  for (const category of sheet.categories) for (const series of sheet.series) {
    const cell = category.cells[series.id] ?? emptyGroupedCell();
    const stats = groupedStatistics(cell, sheet.options.inputMode, sheet.options.errorMode);
    summary.push([category.name, series.name, series.visible ? '是' : '否', sheet.options.inputMode,
      stats.mean, stats.sd, stats.sem, stats.n, sheet.options.errorMode, stats.error]);
    cell.replicates.forEach((value, index) => raw.push([category.name, series.name, index + 1, value]));
  }
  const input = (field: GroupedCellField) => [['分析对象', ...sheet.series.map((s) => s.name)], ...groupedGrid(sheet, field)];
  return [
    { name: '当前图表数据', rows: input(sheet.options.inputMode === 'replicates' ? 'replicates' : 'mean') },
    { name: '统计结果', rows: summary }, { name: '原始重复测量', rows: raw },
    { name: '输入平均值', rows: input('mean') }, { name: '输入SD', rows: input('sd') },
    { name: '输入SEM', rows: input('sem') }, { name: '手动误差', rows: input('manualError') },
    { name: '系列设置', rows: [['系列', '颜色', '显示', '单位', '备注'], ...sheet.series.map((s) => [s.name, s.color, s.visible ? '是' : '否', s.unit ?? '', s.comment ?? ''])] },
  ];
}

/** Visible series retain their positions even when an individual cell is empty. */
export function groupedPlotData(sheet: GroupedBarSheet): PlotData {
  const options = { ...defaultGroupedOptions(), ...sheet.options };
  const categories = sheet.categories.map((category) => category.name);
  const series = sheet.series.filter((item) => item.visible).map((item) => ({
    name: item.name,
    color: item.color,
    kind: 'bar' as const,
    points: sheet.categories.flatMap((category, index) => {
      let stats: GroupedStatistics;
      try {
        stats = groupedStatistics(category.cells[item.id], options.inputMode, options.errorMode);
      } catch (error) {
        throw new Error(`${category.name || `第 ${index + 1} 行`} / ${item.name}：${(error as Error).message}`);
      }
      if (stats.mean === null) return [];
      if (!category.name.trim()) throw new Error(`第 ${index + 1} 行有数据，请填写分析对象名称`);
      return [{ x: index, y: stats.mean, error: stats.error }];
    }),
  }));
  return { categories, series, groupedBars: options };
}
