import { describe, expect, it } from 'vitest';
import { editGroupedGrid, groupedExportTables, groupedGrid, groupedPlotData, groupedStatistics, importGroupedTable, structureGrouped } from '../src/domain/grouped-bar-2026.11.6';
import { readTextTable } from '../src/services/import';

describe('分组宽表编辑与数据导出', () => {
  const fixture = () => importGroupedTable([['离子', '探针 A', '探针 B', '探针 C'], ['Cd²⁺', 520, 700, 680], ['Ca²⁺', '', 0, -3]], true, 'statistics');
  it('导入 CSV 保留缺失、零、负值、系列名称及顺序', () => {
    const sheet = importGroupedTable(readTextTable('离子,A,B\nCd²⁺,10,20\nCa²⁺,,0').rows, true, 'statistics');
    expect(groupedGrid(sheet, 'mean')).toEqual([['Cd²⁺', '10', '20'], ['Ca²⁺', '', '0']]);
    expect(groupedPlotData(sheet).series[0].points).toHaveLength(1);
    expect(groupedPlotData(sheet).series[1].points[1].y).toBe(0);
  });
  it('插入、重排和删除系列按稳定 ID 保留正确的测量值', () => {
    const original = fixture(), id = original.series[1].id;
    const inserted = structureGrouped(original, { type: 'insert-column', index: 2, count: 2 });
    expect(inserted.series[3].id).toBe(id);
    expect(inserted.categories[0].cells[id].mean).toBe('700');
    const reordered = { ...inserted, series: [...inserted.series].reverse() };
    expect(groupedGrid(reordered, 'mean')[0]).toEqual(['Cd²⁺', '680', '700', '', '', '520']);
    const removed = structureGrouped(inserted, { type: 'delete-column', index: 4, count: 1 });
    expect(removed.categories[0].cells[id]).toBeUndefined();
    expect(original.categories[0].cells[id].mean).toBe('700');
  });
  it('删除名称列和最后一个系列被禁止，行结构不串联其他分类', () => {
    const sheet = fixture();
    expect(() => structureGrouped(sheet, { type: 'delete-column', index: 0, count: 1 })).toThrow('第一列');
    expect(() => structureGrouped(sheet, { type: 'delete-column', index: 1, count: 3 })).toThrow('至少');
    const inserted = structureGrouped(sheet, { type: 'insert-row', index: 1, count: 2 });
    expect(inserted.categories[3]).toEqual(sheet.categories[1]);
    expect(structureGrouped(inserted, { type: 'delete-row', index: 1, count: 2 }).categories).toEqual(sheet.categories);
  });
  it('切换输入与误差表编辑不覆盖隐藏的原始测量或用户统计值', () => {
    let sheet = fixture();
    sheet = editGroupedGrid(sheet, [['Cd²⁺', '1;;3', '2;4'], ['Ca²⁺', '', '0']], 'replicates');
    sheet = editGroupedGrid(sheet, [['Cd²⁺', '0.2', '0.4']], 'sd');
    expect(groupedGrid(sheet, 'mean')[0]).toEqual(['Cd²⁺', '520', '700', '680']);
    expect(sheet.categories[0].cells[sheet.series[0].id].replicates).toEqual(['1', '', '3']);
    expect(sheet.categories).toHaveLength(2);
    expect(sheet.categories[1].name).toBe('Ca²⁺');
    expect(groupedGrid(sheet, 'mean')[1]).toEqual(['Ca²⁺', '', '0', '-3']);
    expect(groupedStatistics(sheet.categories[0].cells[sheet.series[0].id], 'replicates', 'sd').mean).toBe(2);
  });
  it('无表头重复输入保存空项；非空无效值必须暴露，不能过滤', () => {
    const sheet = importGroupedTable([['Cd²⁺', '1;;3'], ['Ca²⁺', 'invalid']], false, 'replicates');
    expect(groupedGrid(sheet, 'replicates')[0]).toEqual(['Cd²⁺', '1;;3']);
    expect(() => groupedPlotData(sheet)).toThrow('Ca²⁺');
  });
  it('Excel 表同时保留原始值、统计、隐藏系列、误差；空值不转为零', () => {
    const sheet = fixture();
    sheet.series[0].visible = false;
    sheet.options.errorMode = 'sd';
    const tables = groupedExportTables(sheet), summary = tables.find((table) => table.name === '统计结果')!.rows;
    expect(summary).toHaveLength(7);
    expect(summary[4]).toEqual(['Ca²⁺', '探针 A', '否', 'statistics', null, null, null, null, 'sd', null]);
    expect(summary[5][4]).toBe(0);
    expect(tables.find((table) => table.name === '输入平均值')!.rows[2]).toEqual(['Ca²⁺', '', '0', '-3']);
  });
});
