import { describe, expect, it } from 'vitest';
import {
  emptyPasteGrid,
  pasteIntoGrid,
  preparePastedSpectra,
  suggestPasteMapping,
  trimPasteGrid,
  growPasteGrid,
} from '../src/services/paste-2026.10.18';

describe('pasted raw spectra', () => {
  it('retains all wide-table names and original measured values from Excel TSV', () => {
    const grid = pasteIntoGrid(
      emptyPasteGrid(),
      '波长\t空白\tCd²⁺ + 河水\r\n510\t100.25\t5E1\r\n500\t80\t40\r\n',
    );
    const m = suggestPasteMapping(grid, 'μM');
    expect(m).toMatchObject({ header: true, start: 1, x: 0, ys: [1, 2] });
    const r = preparePastedSpectra(grid, m, '粘贴光谱-2026.10.18');
    expect(r.spectra.map((s) => s.name)).toEqual(['空白', 'Cd²⁺ + 河水']);
    expect(r.spectra[0].points).toEqual([
      { x: 500, y: 80 },
      { x: 510, y: 100.25 },
    ]);
    expect(r.spectra[1].points[1].y).toBe(50);
  });
  it('handles headerless CSV without losing the first point or treating trailing empty columns as spectra', () => {
    const grid = pasteIntoGrid(emptyPasteGrid(), '500,10,\n501,20,\n');
    const m = suggestPasteMapping(grid, 'μM');
    expect(m.header).toBe(false);
    expect(m.ys).toEqual([1]);
    expect(preparePastedSpectra(grid, m, 'source').spectra[0].points).toHaveLength(2);
  });
  it('allows headers and numeric rows to be pasted in separate steps', () => {
    let grid = pasteIntoGrid(emptyPasteGrid(), 'Wavelength\tA\tB');
    const m = suggestPasteMapping(grid, 'μM');
    expect(m).toMatchObject({ header: true, ys: [1, 2] });
    grid = pasteIntoGrid(grid, '500\t1\t2\n501\t3\t4', 1, 0);
    expect(preparePastedSpectra(grid, m, 'source').spectra).toHaveLength(2);
    expect(suggestPasteMapping(pasteIntoGrid(emptyPasteGrid(), '500'), 'μM').ys).toEqual([1]);
  });
  it('places a rectangular paste at the focused cell without overwriting surrounding cells', () => {
    let grid = pasteIntoGrid(emptyPasteGrid(), 'Sample 1');
    grid = pasteIntoGrid(grid, '500\t1\n501\t2', 1, 1);
    expect(grid[0]).toEqual(['Sample 1', '', '']);
    expect(grid[1]).toEqual(['', '500', '1']);
    expect(grid[2]).toEqual(['', '501', '2']);
  });
  it('supports preambles, renamed/reordered columns and quoted CSV sample names', () => {
    const grid = pasteIntoGrid(
      emptyPasteGrid(),
      'Instrument export\n\n"Sample A, repeat 1",Wavelength\n10,500\n20,501',
    );
    const m = suggestPasteMapping(grid, 'μM');
    expect(m).toMatchObject({ start: 3, header: true, x: 1, ys: [0] });
    expect(preparePastedSpectra(grid, m, 'source').spectra[0].name).toBe('Sample A, repeat 1');
  });
  it('rejects invalid values, one-point curves and duplicates so drawing never silently drops data', () => {
    for (const [text, error] of [
      ['nm,F\n500,1\n501,bad\n502,3', /无效记录/],
      ['nm,F\n500,1\n500,2', /重复波长/],
      ['nm,F\n500,1', /少于 2/],
    ] as const) {
      const grid = pasteIntoGrid(emptyPasteGrid(), text);
      expect(() => preparePastedSpectra(grid, suggestPasteMapping(grid, 'μM'), 'source')).toThrow(
        error,
      );
    }
  });
  it('keeps empty rows aligned and rejects oversize pastes without mutating the draft', () => {
    const grid = emptyPasteGrid();
    expect(trimPasteGrid(pasteIntoGrid(grid, '500\t1\n\n502\t3'))).toEqual([
      ['500', '1'],
      ['', ''],
      ['502', '3'],
    ]);
    expect(() => pasteIntoGrid(grid, '1\t2', 0, 63)).toThrow(/64 列/);
    expect(() => growPasteGrid(grid, 100002, 3)).toThrow(/100001 行/);
    expect(grid).toEqual(emptyPasteGrid());
  });
});
