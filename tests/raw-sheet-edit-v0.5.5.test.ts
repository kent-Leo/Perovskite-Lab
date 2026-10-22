import { describe, expect, it } from 'vitest';
import {
  insertRawSheetColumn,
  insertRawSheetRow,
  type RawSheetDraft,
} from '../src/domain/raw-sheet-edit';
import type { SheetMapping } from '../src/domain/types';

const mapping = (patch: Partial<SheetMapping> = {}): SheetMapping => ({
  kind: 'wide',
  start: 2,
  header: true,
  x: 0,
  ys: [1, 2],
  name: 0,
  concentration: 0,
  unit: 'µmol/L',
  ...patch,
});

const draft = (): RawSheetDraft => ({
  grid: [
    ['nm', 'A', 'B'],
    ['500', '10', '30'],
    ['510', '20', '40'],
  ],
  mapping: mapping(),
});

describe('insertRawSheetRow', () => {
  it('inserts a blank row above the header and pushes the start row down', () => {
    const next = insertRawSheetRow(draft(), 0);
    expect(next.grid).toEqual([
      ['', '', ''],
      ['nm', 'A', 'B'],
      ['500', '10', '30'],
      ['510', '20', '40'],
    ]);
    expect(next.mapping.start).toBe(3);
  });

  it('inserts between data rows without moving the start row', () => {
    const next = insertRawSheetRow(draft(), 2);
    expect(next.grid[1]).toEqual(['500', '10', '30']);
    expect(next.grid[2]).toEqual(['', '', '']);
    expect(next.grid[3]).toEqual(['510', '20', '40']);
    expect(next.mapping.start).toBe(2);
  });

  it('appends at the end and clamps out-of-range indexes', () => {
    const appended = insertRawSheetRow(draft(), 99);
    expect(appended.grid).toHaveLength(4);
    expect(appended.grid.at(-1)).toEqual(['', '', '']);
    expect(appended.mapping.start).toBe(2);
    const negative = insertRawSheetRow(draft(), -5);
    expect(negative.grid[0]).toEqual(['', '', '']);
    expect(negative.mapping.start).toBe(3);
  });

  it('pads ragged rows to the widest row and keeps the mapping object shape', () => {
    const next = insertRawSheetRow(
      { grid: [['nm', 'A', 'B'], ['500', '10']], mapping: mapping() },
      1,
    );
    expect(next.grid[1]).toEqual(['', '', '']);
    expect(next.grid[0]).toEqual(['nm', 'A', 'B']);
    expect(next.mapping).toMatchObject({ x: 0, ys: [1, 2], header: true });
  });
});

describe('insertRawSheetColumn', () => {
  it('inserts a column before the wavelength column and shifts x/ys', () => {
    const result = insertRawSheetColumn(draft(), undefined, undefined, 0);
    expect(result.rawSheet.grid[0]).toEqual(['', 'nm', 'A', 'B']);
    expect(result.rawSheet.grid[1]).toEqual(['', '500', '10', '30']);
    expect(result.rawSheet.mapping.x).toBe(1);
    expect(result.rawSheet.mapping.ys).toEqual([2, 3]);
    expect(result.rawSheet.mapping.start).toBe(2);
  });

  it('inserts between intensity columns and shifts metadata plus column→spectrum keys', () => {
    const result = insertRawSheetColumn(
      draft(),
      {
        'raw-0': { title: '波长', unit: 'nm' },
        'raw-1': { title: '光谱 A', color: '#ff0000' },
        'raw-2': { title: '光谱 B' },
      },
      { 'raw-1': 'spectrum-a', 'raw-2': 'spectrum-b' },
      2,
    );
    expect(result.rawSheet.grid[0]).toEqual(['nm', 'A', '', 'B']);
    expect(result.rawSheet.mapping.x).toBe(0);
    expect(result.rawSheet.mapping.ys).toEqual([1, 3]);
    expect(result.metadata).toEqual({
      'raw-0': { title: '波长', unit: 'nm' },
      'raw-1': { title: '光谱 A', color: '#ff0000' },
      'raw-3': { title: '光谱 B' },
    });
    expect(result.columnSpectra).toEqual({
      'raw-1': 'spectrum-a',
      'raw-3': 'spectrum-b',
    });
  });

  it('appends at the end without shifting existing keys and clamps indexes', () => {
    const result = insertRawSheetColumn(
      draft(),
      { 'raw-1': { title: 'A' } },
      { 'raw-1': 'a' },
      99,
    );
    expect(result.rawSheet.grid[0]).toEqual(['nm', 'A', 'B', '']);
    expect(result.rawSheet.mapping.x).toBe(0);
    expect(result.rawSheet.mapping.ys).toEqual([1, 2]);
    expect(result.metadata).toEqual({ 'raw-1': { title: 'A' } });
    expect(result.columnSpectra).toEqual({ 'raw-1': 'a' });
  });

  it('never mutates the input draft', () => {
    const input = draft();
    const snapshot = JSON.parse(JSON.stringify(input));
    insertRawSheetColumn(input, { 'raw-1': { title: 'A' } }, { 'raw-1': 'a' }, 1);
    insertRawSheetRow(input, 1);
    expect(input).toEqual(snapshot);
  });
});
