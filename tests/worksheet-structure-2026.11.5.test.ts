import { describe, expect, it } from 'vitest';
import {
  deleteGridColumns,
  deleteGridRows,
  deleteConfirmMessage,
  insertGridColumns,
  insertGridRows,
  needsDeleteConfirm,
  remapIndex,
  structureAxis,
  structureCount,
  structureStart,
  type WorksheetStructureAction,
} from '../src/domain/worksheet-structure-2026.11.5';
import {
  deleteRawSheetColumns,
  deleteRawSheetRows,
  insertRawSheetColumns,
  insertRawSheetRows,
} from '../src/domain/raw-sheet-edit';
import { defaultRawMapping } from '../src/domain/workbook';
import { syncRawMapping } from '../src/domain/raw-spectra';
import type { SheetMapping } from '../src/domain/types';

const grid = [
  ['nm', 'A', 'B'],
  ['500', '10', '30'],
  ['510', '20', '40'],
];
const rawSheet = () => {
  const mapping: SheetMapping = syncRawMapping(grid, { ...defaultRawMapping(), x: 0, ys: [1, 2] });
  return { grid: grid.map((row) => [...row]), mapping };
};

describe('行列结构操作的数量与范围', () => {
  it('数量归一化到 1–200', () => {
    expect(structureCount(undefined)).toBe(1);
    expect(structureCount(0)).toBe(1);
    expect(structureCount(-4)).toBe(1);
    expect(structureCount(6.7)).toBe(6);
    expect(structureCount(9999)).toBe(200);
  });

  it('追加操作没有起始位置', () => {
    expect(structureStart({ type: 'append-row', count: 1 })).toBe(-1);
    expect(structureStart({ type: 'insert-row', index: 3, count: 2 })).toBe(3);
    expect(structureAxis({ type: 'delete-column', index: 0, count: 1 })).toBe('column');
  });

  it('插入行保留列宽并在指定位置前插入', () => {
    const next = insertGridRows(grid, 1, 2);
    expect(next).toHaveLength(5);
    expect(next[1]).toEqual(['', '', '']);
    expect(next[3]).toEqual(['500', '10', '30']);
  });

  it('删除行真正改变表格结构而不是清空单元格', () => {
    const next = deleteGridRows(grid, 1, 1);
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual(['510', '20', '40']);
  });

  it('插入与删除列改变每一行的宽度', () => {
    const wide = insertGridColumns(grid, 1, 2);
    expect(wide[0]).toEqual(['nm', '', '', 'A', 'B']);
    const narrow = deleteGridColumns(wide, 1, 2);
    expect(narrow).toEqual(grid);
  });

  it('超出范围的索引被夹到边界而不是抛错', () => {
    expect(deleteGridRows(grid, 99, 1)).toEqual(grid);
    expect(insertGridRows(grid, -5, 1)[0]).toEqual(['', '', '']);
    expect(deleteGridColumns(grid, 0, 99)[0]).toEqual([]);
  });

  it('索引在删除区间内返回 -1，之后的索引前移', () => {
    expect(remapIndex(0, 1, 2)).toBe(0);
    expect(remapIndex(2, 1, 2)).toBe(-1);
    expect(remapIndex(3, 1, 2)).toBe(1);
  });
});

describe('删除确认', () => {
  it('少量空白行列直接删除', () => {
    const blank = Array.from({ length: 6 }, () => ['', '', '']);
    expect(needsDeleteConfirm({ type: 'delete-row', index: 0, count: 1 }, blank)).toBe(false);
    expect(needsDeleteConfirm({ type: 'delete-column', index: 0, count: 1 }, blank)).toBe(false);
    expect(needsDeleteConfirm({ type: 'insert-row', index: 0, count: 40 }, blank)).toBe(false);
  });

  it('批量删除或包含大量数据时要求确认', () => {
    expect(needsDeleteConfirm({ type: 'delete-row', index: 0, count: 20 }, grid)).toBe(true);
    expect(needsDeleteConfirm({ type: 'delete-column', index: 1, count: 4 }, grid)).toBe(true);
    const big = Array.from({ length: 60 }, (_, i) => [String(i), 'x', 'y']);
    expect(needsDeleteConfirm({ type: 'delete-row', index: 0, count: 30 }, big)).toBe(true);
  });

  it('确认文案说明可用撤销恢复', () => {
    expect(deleteConfirmMessage({ type: 'delete-row', index: 0, count: 3 })).toContain('撤销');
    expect(deleteConfirmMessage({ type: 'delete-column', index: 0, count: 2 })).toContain('列');
  });
});

describe('原始光谱表的行列结构', () => {
  it('插入多行时起始行整体下移', () => {
    const sheet = rawSheet();
    const next = insertRawSheetRows(sheet, 0, 2);
    expect(next.grid).toHaveLength(5);
    expect(next.mapping.start).toBe(3);
    expect(next.grid[2]).toEqual(['nm', 'A', 'B']);
  });

  it('在数据区插入行不影响起始行', () => {
    const sheet = rawSheet();
    const next = insertRawSheetRows(sheet, 2, 1);
    expect(next.mapping.start).toBe(1);
    expect(next.grid[2]).toEqual(['', '', '']);
  });

  it('删除表头上方的行时起始行上移', () => {
    const sheet = rawSheet();
    const shifted = insertRawSheetRows(sheet, 0, 1);
    expect(shifted.mapping.start).toBe(2);
    const next = deleteRawSheetRows(shifted, 0, 1);
    expect(next.mapping.start).toBe(1);
    expect(next.grid[0]).toEqual(['nm', 'A', 'B']);
  });

  it('插入两列会平移波长列、强度列、列头元数据与列→光谱映射', () => {
    const sheet = rawSheet();
    const result = insertRawSheetColumns(
      sheet,
      { 'raw-1': { title: 'A' }, 'raw-2': { title: 'B' } },
      { 'raw-1': 'id-a', 'raw-2': 'id-b' },
      1,
      2,
    );
    expect(result.rawSheet.grid[0]).toEqual(['nm', '', '', 'A', 'B']);
    expect(result.rawSheet.mapping.x).toBe(0);
    expect(result.rawSheet.mapping.ys).toEqual([3, 4]);
    expect(result.metadata).toEqual({ 'raw-3': { title: 'A' }, 'raw-4': { title: 'B' } });
    expect(result.columnSpectra).toEqual({ 'raw-3': 'id-a', 'raw-4': 'id-b' });
    expect(result.removedColumns).toEqual([]);
  });

  it('删除强度列会同时移除映射并返回被删列号', () => {
    const sheet = rawSheet();
    const result = deleteRawSheetColumns(
      sheet,
      { 'raw-1': { title: 'A' }, 'raw-2': { title: 'B' } },
      { 'raw-1': 'id-a', 'raw-2': 'id-b' },
      1,
      1,
    );
    expect(result.rawSheet.grid[0]).toEqual(['nm', 'B']);
    expect(result.rawSheet.mapping.ys).toEqual([1]);
    expect(result.metadata).toEqual({ 'raw-1': { title: 'B' } });
    expect(result.columnSpectra).toEqual({ 'raw-1': 'id-b' });
    expect(result.removedColumns).toEqual([1]);
  });

  it('波长列与最后一列不能删除', () => {
    const sheet = rawSheet();
    expect(() => deleteRawSheetColumns(sheet, {}, {}, 0, 1)).toThrow(/波长列/);
    expect(() => deleteRawSheetColumns(sheet, {}, {}, 0, 3)).toThrow(/波长列/);
    // 只删除强度列后仍保留波长列，表格不会变成零列。
    expect(deleteRawSheetColumns(sheet, {}, {}, 1, 2).rawSheet.grid[0]).toEqual(['nm']);
  });
});
