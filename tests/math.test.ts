import { describe, it, expect } from 'vitest';
import {
  numeric,
  response,
  regress,
  sampleSD,
  detectionLimits,
  interpolate,
  spectrumStats,
  convertConcentration,
  gradient,
  parseNumbers,
} from '../src/domain/math';
import { chartSVG } from '../src/domain/chart';
import { defaultStyle } from '../src/domain/types';
describe('scientific calculations', () => {
  it('does not interpret missing or infinite values as zero', () => {
    for (const v of ['', null, undefined, 'Infinity', 'abc']) expect(numeric(v)).toBeNull();
    expect(numeric('0')).toBe(0);
    expect(numeric('1.2e-3')).toBe(0.0012);
  });
  it('computes response modes and rejects divisions by zero', () => {
    expect(response(25, 100, 'ratio')).toBe(0.25);
    expect(response(25, 100, 'inverse')).toBe(4);
    expect(response(25, 100, 'quench')).toBe(0.75);
    expect(response(25, 100, 'percent')).toBe(75);
    expect(() => response(0, 100, 'inverse')).toThrow();
    expect(() => response(25, 0, 'ratio')).toThrow();
    expect(response(-1, 0, 'F')).toBe(-1);
  });
  it('fits a decreasing calibration and keeps LOD positive', () => {
    const fit = regress([
      { x: 0, y: 100 },
      { x: 1, y: 80 },
      { x: 2, y: 60 },
    ]);
    expect(fit.slope).toBe(-20);
    expect(fit.intercept).toBe(100);
    expect(fit.r2).toBe(1);
    expect(detectionLimits(2, fit.slope, 3.3).lod).toBeCloseTo(0.33);
    expect(detectionLimits(2, fit.slope, 3.3).loq).toBe(1);
  });
  it('computes an independently known nonperfect fit', () => {
    const f = regress([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 5 },
    ]);
    expect(f.slope).toBe(1.5);
    expect(f.intercept).toBeCloseTo(2 / 3);
    expect(f.r2).toBeCloseTo(27 / 28);
  });
  it('rejects equal concentrations and distinguishes constant response', () => {
    expect(() =>
      regress([
        { x: 1, y: 3 },
        { x: 1, y: 4 },
      ]),
    ).toThrow();
    expect(
      regress([
        { x: 0, y: 4 },
        { x: 1, y: 4 },
      ]).r2,
    ).toBeNull();
    expect(
      regress([
        { x: 0, y: 4 },
        { x: 1, y: 3 },
      ]).residualSD,
    ).toBeNull();
    expect(() => detectionLimits(0, 1, 3)).toThrow();
    expect(() => detectionLimits(1, 0, 3)).toThrow();
  });
  it('uses sample SD and correct normalized sigma', () => {
    expect(sampleSD([10, 12, 14])).toBe(2);
    const sigma = sampleSD([10, 12, 14].map((f) => response(f, 12, 'quench')));
    expect(sigma).toBeCloseTo(2 / 12);
    const inverse = sampleSD([10, 12, 14].map((f) => response(f, 12, 'inverse')));
    expect(inverse).toBeCloseTo(sampleSD([1.2, 1, 12 / 14]));
  });
  it('interpolates but never extrapolates', () => {
    const p = [
      { x: 500, y: 10 },
      { x: 502, y: 20 },
    ];
    expect(interpolate(p, 501)).toBe(15);
    expect(interpolate(p, 502)).toBe(20);
    expect(interpolate(p, 503)).toBeNull();
  });
  it('calculates triangle peak, FWHM and area', () => {
    const p = [
      { x: 0, y: 0 },
      { x: 1, y: 10 },
      { x: 2, y: 0 },
    ];
    expect(spectrumStats(p)).toEqual({ peak: 1, max: 10, fwhm: 1, area: 10 });
    expect(
      spectrumStats([
        { x: 0, y: 9 },
        { x: 1, y: 10 },
        { x: 2, y: 9 },
      ])?.fwhm,
    ).toBeNull();
  });
  it('converts only compatible units', () => {
    expect(convertConcentration(1, 'μM', 'nM')).toBeCloseTo(1000);
    expect(convertConcentration(1, 'mg/L', 'μg/L')).toBe(1000);
    expect(() => convertConcentration(1, 'μM', 'mg/L')).toThrow();
  });
  it('accounts for fixed additions in dilution and rejects overfill', () => {
    expect(gradient(100, 10, [1], 1)[0]).toEqual({
      index: 1,
      concentration: 1,
      stockUL: 100,
      fixedML: 1,
      solventML: 8.9,
      finalML: 10,
    });
    expect(() => gradient(100, 10, [101])).toThrow();
    expect(() => gradient(100, 10, [95], 1)).toThrow();
    expect(() => gradient(0, 10, [1])).toThrow();
  });
  it('parses scientific notation and rejects malformed blank repeats', () => {
    expect(parseNumbers('1e2, 101\n99；100')).toEqual([100, 101, 99, 100]);
    expect(() => parseNumbers('100,wrong,101')).toThrow();
  });
  it('escapes user names in SVG and checks axis bounds', () => {
    const d = {
      series: [
        {
          name: '<script>bad</script>',
          color: '#157c65',
          points: [
            { x: 1, y: 3 },
            { x: 2, y: 5 },
          ],
        },
      ],
    };
    const s = defaultStyle('spectra');
    expect(chartSVG(d, s)).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(chartSVG(d, s)).not.toContain('<script>');
    expect(() => chartSVG(d, { ...s, xMin: '5', xMax: '1' })).toThrow();
  });
});
