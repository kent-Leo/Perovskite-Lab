import { describe, expect, it } from 'vitest';
import {
  cellInSelection,
  columnSelection,
  rowSelection,
  selectionBounds,
  selectionName,
} from '../src/domain/worksheet-v0.2.0-2026.10.19';

describe('Excel 式整行整列选中', () => {
  it('整列选区覆盖全部行', () => {
    const s = columnSelection(2, 10);
    expect(s).toEqual({ anchor: { row: 0, column: 2 }, focus: { row: 9, column: 2 } });
    expect(cellInSelection({ row: 5, column: 2 }, s)).toBe(true);
    expect(cellInSelection({ row: 5, column: 1 }, s)).toBe(false);
  });

  it('Shift 连选多列时保留锚点列', () => {
    const s = columnSelection(5, 10, 2);
    expect(selectionBounds(s)).toEqual({ top: 0, bottom: 9, left: 2, right: 5 });
    expect(selectionName(s)).toBe('C1:F10');
  });

  it('反向拖动时选区仍然连续', () => {
    expect(selectionName(columnSelection(1, 4, 4))).toBe('B1:E4');
  });

  it('整行选区覆盖全部列', () => {
    const s = rowSelection(3, 6);
    expect(s).toEqual({ anchor: { row: 3, column: 0 }, focus: { row: 3, column: 5 } });
    expect(selectionName(s)).toBe('A4:F4');
  });

  it('Shift 连选多行时保留锚点行', () => {
    const s = rowSelection(7, 4, 2);
    expect(selectionBounds(s)).toEqual({ top: 2, bottom: 7, left: 0, right: 3 });
  });

  it('空表不会产生负坐标', () => {
    expect(columnSelection(0, 0)).toEqual({
      anchor: { row: 0, column: 0 },
      focus: { row: 0, column: 0 },
    });
    expect(rowSelection(0, 0).focus.column).toBe(0);
  });
});
