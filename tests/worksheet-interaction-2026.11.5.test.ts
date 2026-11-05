import { describe, expect, it } from 'vitest';
import {
  cellInSelection,
  columnSelection,
  copyWorksheetRange,
  pasteOrigin,
  pasteWorksheetRange,
  selectionBounds,
  selectionName,
  type CellSelection,
  type WorksheetColumn,
} from '../src/domain/worksheet-v0.2.0-2026.10.19';

const columns: WorksheetColumn[] = [
  { key: 'x', title: '波长', type: 'number', designation: 'X' },
  { key: 'y', title: '强度', type: 'number', designation: 'Y' },
  { key: 'result', title: '响应', readOnly: true },
];
const grid = [
  ['500', '10', '0.5'],
  ['510', '20', '1'],
  ['520', '30', '1.5'],
];
const selection = (anchorRow: number, anchorCol: number, focusRow: number, focusCol: number) => ({
  anchor: { row: anchorRow, column: anchorCol },
  focus: { row: focusRow, column: focusCol },
});
/** Excel 粘贴：从选区左上角开始，正向与反向框选得到同一结果。 */
const pasteAtSelection = (rows: string[][], s: CellSelection, text: string) =>
  pasteWorksheetRange(rows, columns, pasteOrigin(s), text);

describe('Excel 式粘贴起点', () => {
  it('正向框选从左上角开始粘贴', () => {
    const s = selection(1, 0, 2, 1);
    expect(pasteOrigin(s)).toEqual({ row: 1, column: 0 });
    const pasted = pasteAtSelection(grid, s, '600\t40\n610\t50');
    expect(pasted.rows.map((row) => row.slice(0, 2))).toEqual([
      ['500', '10'],
      ['600', '40'],
      ['610', '50'],
    ]);
    expect(selectionName(pasted.selection)).toBe('A2:B3');
  });

  it('反向框选与正向框选得到完全相同的表格与选区', () => {
    const forward = selection(1, 0, 2, 1),
      backward = selection(2, 1, 1, 0),
      text = '600\t40\n610\t50';
    expect(pasteOrigin(backward)).toEqual(pasteOrigin(forward));
    expect(pasteAtSelection(grid, backward, text)).toEqual(pasteAtSelection(grid, forward, text));
  });

  it('单击单元格后以该单元格为起点', () => {
    const s = selection(2, 1, 2, 1);
    expect(pasteOrigin(s)).toEqual({ row: 2, column: 1 });
    expect(pasteAtSelection(grid, s, '99').rows[2][1]).toBe('99');
  });

  it('整列选区粘贴仍从列首开始', () => {
    expect(pasteOrigin(columnSelection(1, 4))).toEqual({ row: 0, column: 1 });
  });

  it('粘贴后选区覆盖新数据块，且反向选区同样成立', () => {
    const s = selection(2, 1, 0, 0);
    const pasted = pasteAtSelection(grid, s, '1\t2\n4\t5');
    expect(selectionBounds(pasted.selection)).toEqual({ top: 0, bottom: 1, left: 0, right: 1 });
    expect(pasted.rows[1].slice(0, 2)).toEqual(['4', '5']);
  });
});

describe('批量粘贴的原子性', () => {
  it('单元格类型校验失败时整批失败，不产生部分写入', () => {
    const before = grid.map((row) => [...row]);
    expect(() => pasteAtSelection(grid, selection(0, 0, 0, 0), '700\tabc')).toThrow(/只接受数值/);
    expect(grid).toEqual(before);
  });

  it('单元格类型校验失败时也不返回结果行（调用方无从写入）', () => {
    let result: unknown = null;
    try {
      result = pasteAtSelection(grid, selection(0, 0, 0, 0), '700\t20\t1');
    } catch {
      result = null;
    }
    expect(result).toBeNull();
  });

  it('只读计算列禁止被粘贴覆盖，整批拒绝', () => {
    expect(() => pasteAtSelection(grid, selection(0, 2, 0, 2), '9')).toThrow(/只读/);
  });

  it('粘贴超出列数或行数时给出明确提示', () => {
    expect(() => pasteAtSelection(grid, selection(0, 2, 0, 2), '1\t2')).toThrow(/列数/);
    expect(() => pasteAtSelection(grid, selection(100000, 0, 100000, 0), '1\n2')).toThrow(/行上限/);
  });
});

describe('复制与行列结构', () => {
  it('多行多列复制使用 TSV 且反向选区结果一致', () => {
    const forward = copyWorksheetRange(grid, selection(0, 0, 1, 1)),
      backward = copyWorksheetRange(grid, selection(1, 1, 0, 0));
    expect(forward).toBe('500\t10\n510\t20');
    expect(backward).toBe(forward);
  });

  it('选区覆盖整列时所有行都被选中', () => {
    const s = columnSelection(2, 3);
    expect(cellInSelection({ row: 2, column: 2 }, s)).toBe(true);
    expect(cellInSelection({ row: 3, column: 2 }, s)).toBe(false);
  });
});
