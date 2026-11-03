import { describe, expect, it } from 'vitest';
import { pastedSpectrumIssues, preparePastedSpectra, suggestPasteMapping } from '../src/services/paste-2026.10.18';

const positions = (grid: string[][], mapping = suggestPasteMapping(grid, 'µmol/L')) =>
  pastedSpectrumIssues(grid, mapping).map(({ row, column }) => [row, column]);

describe('spectral plot validation locates the original draft cells', () => {
  it('locates bad and missing numbers without marking headers, separators or unused metadata', () => {
    const grid = [['Instrument', '', ''], ['nm', 'F', '备注'], ['500', 'bad', '样本'],
      ['', '', ''], ['510', '', '样本'], ['oops', '20', '样本'], ['520', '30', '']];
    const mapping = { ...suggestPasteMapping(grid, 'µmol/L'), start: 2, header: true, x: 0, ys: [1] };
    expect(positions(grid, mapping).sort()).toEqual([[2, 1], [4, 1], [5, 0]].sort());
    const original = structuredClone(grid);
    expect(() => preparePastedSpectra(grid, mapping, 'source')).toThrow(/无效记录/);
    expect(grid).toEqual(original);
  });

  it('marks every repeated wavelength including different textual representations and clears after correction', () => {
    const grid = [['nm', 'F'], ['500', '10'], ['5e2', '20'], ['520', '30']];
    const mapping = suggestPasteMapping(grid, 'µmol/L');
    expect(positions(grid, mapping)).toEqual([[1, 0], [2, 0]]);
    expect(() => preparePastedSpectra(grid, mapping, 'source')).toThrow(/重复波长/);
    grid[2][0] = '510';
    expect(positions(grid, mapping)).toEqual([]);
    expect(preparePastedSpectra(grid, mapping, 'source').spectra[0].points).toEqual([
      { x: 500, y: 10 }, { x: 510, y: 20 }, { x: 520, y: 30 },
    ]);
  });

  it('locates a one-point curve while preserving signed intensities and unsorted wavelengths', () => {
    const grid = [['nm', 'F'], ['510', '-20']];
    expect(positions(grid)).toEqual([[1, 1]]);
    expect(() => preparePastedSpectra(grid, suggestPasteMapping(grid, 'µmol/L'), 'source')).toThrow(/少于 2/);
    grid.push(['500', '0']);
    expect(positions(grid)).toEqual([]);
    expect(preparePastedSpectra(grid, suggestPasteMapping(grid, 'µmol/L'), 'source').spectra[0].points)
      .toEqual([{ x: 500, y: 0 }, { x: 510, y: -20 }]);
  });

  it('checks duplicates per curve and preserves intentional blanks in processed spectrum sheets', () => {
    const grid = [['nm', 'A', 'B'], ['500', '10', ''], ['500', '', '20'], ['510', '30', '40']];
    const mapping = { ...suggestPasteMapping(grid, 'µmol/L'), allowEmptyIntensity: true };
    expect(positions(grid, mapping)).toEqual([]);
    const result = preparePastedSpectra(grid, mapping, 'processed');
    expect(result.spectra.map((s) => s.points)).toEqual([
      [{ x: 500, y: 10 }, { x: 510, y: 30 }], [{ x: 500, y: 20 }, { x: 510, y: 40 }],
    ]);
    grid[3][2] = '';
    expect(positions(grid, mapping)).toEqual([[1, 2], [2, 2], [3, 2]]);
    expect(positions(grid, { ...mapping, ys: [1] })).toEqual([]);
    grid[2][2] = 'invalid';
    expect(positions(grid, mapping)).toEqual([[2, 2]]);
  });
});
