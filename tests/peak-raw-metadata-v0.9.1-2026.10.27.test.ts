import { describe, expect, it } from 'vitest';
import { peakMetrics } from '../src/domain/peak';
import { pasteMetadataValues } from '../src/domain/worksheet-v0.3.0-2026.10.27';
import {
  rawColumnIndex,
  rawColumnKey,
  rawSpectrumColor,
  rawSpectrumLabel,
} from '../src/domain/raw-spectra';

const emission = [
  { x: 500, y: 10 },
  { x: 510, y: 50 },
  { x: 520, y: 100 },
  { x: 530, y: 50 },
  { x: 540, y: 10 },
];

describe('peakMetrics', () => {
  it('reports position, intensity, FWHM and trapezoidal area over the measured range', () => {
    expect(peakMetrics(emission, 450)).toEqual({
      peak: 520,
      intensity: 100,
      fwhm: 20,
      area: 2100,
      from: 500,
      to: 540,
      stokes: 70,
    });
  });

  it('leaves the Stokes shift undefined until a positive excitation wavelength exists', () => {
    for (const excitation of ['', 'abc', '0', '-10', null, undefined]) {
      expect(peakMetrics(emission, excitation).stokes).toBeNull();
    }
  });

  it('keeps measured indicators for a flat or negative spectrum without inventing FWHM', () => {
    const flat = peakMetrics(
      [
        { x: 500, y: 5 },
        { x: 510, y: 5 },
        { x: 520, y: 5 },
      ],
      450,
    );
    expect(flat.peak).toBe(500);
    expect(flat.fwhm).toBeNull();
    expect(flat.stokes).toBe(50);
    expect(peakMetrics([], 450)).toMatchObject({ peak: null, area: null, stokes: null });
  });
});

describe('raw spectrum table metadata', () => {
  it('gives the comment priority over the column name and the plotted fallback name', () => {
    expect(rawSpectrumLabel({ title: '名称', comment: '备注' }, '旧名称')).toBe('备注');
    expect(rawSpectrumLabel({ title: '名称', comment: '   ' }, '旧名称')).toBe('名称');
    expect(rawSpectrumLabel({}, '旧名称')).toBe('旧名称');
    expect(rawSpectrumLabel(undefined, '旧名称')).toBe('旧名称');
  });

  it('uses the header color when set and keeps a stable column key', () => {
    expect(rawSpectrumColor({ color: '#ff0000' }, '#157c65')).toBe('#ff0000');
    expect(rawSpectrumColor({}, '#157c65')).toBe('#157c65');
    expect(rawColumnKey(3)).toBe('raw-3');
    expect(rawColumnIndex('raw-12')).toBe(12);
    expect(rawColumnIndex('samples')).toBeNull();
  });
});

describe('pasteMetadataValues', () => {
  it('fills one row from tab-separated data and one column from a vertical list', () => {
    expect(pasteMetadataValues('A\tB\tC')).toEqual(['A', 'B', 'C']);
    expect(pasteMetadataValues('A\nB\nC')).toEqual(['A', 'B', 'C']);
    expect(pasteMetadataValues('A\tB\nC\tD')).toEqual(['A', 'B']);
  });

  it('preserves single values and trailing empty cells while dropping blank trailing rows', () => {
    expect(pasteMetadataValues('Sample 1')).toEqual(['Sample 1']);
    expect(pasteMetadataValues('')).toEqual(['']);
    expect(pasteMetadataValues('A\t\n')).toEqual(['A', '']);
    expect(pasteMetadataValues('A\tB\n\n')).toEqual(['A', 'B']);
  });
});
