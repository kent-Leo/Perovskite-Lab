import { describe, expect, it } from 'vitest';
import {
  WORKSHEET_VERSION,
  columnLetter,
  cellName,
  selectionName,
  selectionBounds,
  rangeValues,
  copyWorksheetRange,
  selectionStats,
  pasteWorksheetRange,
  clearWorksheetRange,
  trimWorksheetRows,
  type WorksheetColumn,
} from '../src/domain/worksheet-v0.2.0-2026.10.19';

const columns: WorksheetColumn[] = [
  { key: 'x', title: '波长', type: 'number', designation: 'X' },
  { key: 'y', title: '强度', type: 'number', designation: 'Y' },
  { key: 'result', title: '响应', readOnly: true },
];
const rows = [
  ['500', '10', '0.5'],
  ['510', '20', '1'],
];
describe('worksheet v0.2.0', () => {
  it('exports its version and labels columns beyond Z and reversed ranges', () => {
    expect(WORKSHEET_VERSION).toBe('0.2.0');
    expect([0, 25, 26, 63].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'BL']);
    expect(cellName({ row: 10, column: 26 })).toBe('AA11');
    const s = { anchor: { row: 1, column: 2 }, focus: { row: 0, column: 0 } };
    expect(selectionName(s)).toBe('A1:C2');
    expect(selectionBounds(s)).toEqual({ top: 0, bottom: 1, left: 0, right: 2 });
  });
  it('copies a rectangle and excludes text and empty cells from numeric statistics', () => {
    const s = { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } };
    expect(copyWorksheetRange(rows, s)).toBe('500\t10\n510\t20');
    expect(
      selectionStats(
        [
          ['', 'text'],
          ['1e2', '-5'],
        ],
        s,
      ),
    ).toEqual({ cells: 4, numeric: 2, sum: 95, mean: 47.5 });
    expect(rangeValues([], s)).toEqual([
      ['', ''],
      ['', ''],
    ]);
  });
  it('pastes at an offset and expands rows without mutating the source', () => {
    const before = structuredClone(rows);
    const result = pasteWorksheetRange(
      rows,
      columns,
      { row: 1, column: 0 },
      '520\t1.5e2\r\n530\t0\r\n',
    );
    expect(result.rows).toEqual([
      ['500', '10', '0.5'],
      ['520', '1.5e2', '1'],
      ['530', '0', ''],
    ]);
    expect(selectionName(result.selection)).toBe('A2:B3');
    expect(rows).toEqual(before);
  });
  it('clears missing trailing cells in ragged pasted data', () => {
    const result = pasteWorksheetRange(rows, columns, { row: 0, column: 0 }, '520\t12\n530');
    expect(result.rows).toEqual([
      ['520', '12', '0.5'],
      ['530', '', '1'],
    ]);
  });
  it('validates entire pastes atomically and protects computed columns', () => {
    expect(() =>
      pasteWorksheetRange(rows, columns, { row: 0, column: 0 }, '520\t123\n530\tbad'),
    ).toThrow(/数值/);
    expect(() => pasteWorksheetRange(rows, columns, { row: 0, column: 1 }, '25\t99')).toThrow(
      /只读计算列/,
    );
    expect(rows[0]).toEqual(['500', '10', '0.5']);
  });
  it('clears only editable cells and trims rows containing only computed results', () => {
    const result = clearWorksheetRange(rows, columns, {
      anchor: { row: 1, column: 0 },
      focus: { row: 1, column: 2 },
    });
    expect(result).toEqual([
      ['500', '10', '0.5'],
      ['', '', '1'],
    ]);
    expect(trimWorksheetRows(result, columns)).toEqual([['500', '10', '0.5']]);
  });
  it('normalizes select labels, checkboxes and validates colors', () => {
    const schema: WorksheetColumn[] = [
      {
        key: 'role',
        title: '角色',
        type: 'select',
        options: [{ value: 'target', label: '目标物' }],
      },
      { key: 'included', title: '参与拟合', type: 'checkbox' },
      { key: 'color', title: '颜色', type: 'color' },
    ];
    expect(
      pasteWorksheetRange([], schema, { row: 0, column: 0 }, '目标物\t1\t#123abc').rows,
    ).toEqual([['target', 'true', '#123abc']]);
    expect(() => pasteWorksheetRange([], schema, { row: 0, column: 0 }, 'unknown\t1')).toThrow(
      /可选范围/,
    );
    expect(() => pasteWorksheetRange([], schema, { row: 0, column: 2 }, 'red')).toThrow(/颜色/);
  });
  it('preserves free text and quotes embedded tabs for clipboard round trips', () => {
    const schema: WorksheetColumn[] = [{ key: 'name', title: '名称' }];
    expect(pasteWorksheetRange([], schema, { row: 0, column: 0 }, 'Sample 1').rows).toEqual([
      ['Sample 1'],
    ]);
    const copied = copyWorksheetRange([['Sample\tA']], {
      anchor: { row: 0, column: 0 },
      focus: { row: 0, column: 0 },
    });
    expect(copied).toBe('"Sample\tA"');
    expect(pasteWorksheetRange([], schema, { row: 0, column: 0 }, copied).rows).toEqual([
      ['Sample\tA'],
    ]);
  });
  it('rejects invalid positions, excess columns and excessive row counts', () => {
    expect(() => pasteWorksheetRange(rows, columns, { row: 0, column: 3 }, '1')).toThrow(/有效/);
    expect(() => pasteWorksheetRange(rows, columns, { row: 0, column: 2 }, '1\t2')).toThrow(/超出/);
    expect(() => pasteWorksheetRange(rows, columns, { row: 100001, column: 0 }, '1')).toThrow(
      /数据过大/,
    );
  });
  it('leaves an empty clipboard unchanged', () => {
    expect(pasteWorksheetRange(rows, columns, { row: 0, column: 0 }, '').rows).toEqual(rows);
  });
});
