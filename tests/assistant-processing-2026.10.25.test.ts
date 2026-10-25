import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_ALGORITHM_VERSION,
  DEFAULT_ASSISTANT_PARAMETERS,
  assistantProcessingKey,
  describeAssistantResult,
  mad,
  median,
  normalizeAssistantParameters,
  processAssistantSpectrum,
  processedSegments,
  type AssistantParameters,
  type AssistantProcessInput,
} from '../src/domain/assistant-processing-2026.10.25';
import type { Point } from '../src/domain/types';

const noise = (index: number) => {
  const value = Math.sin(index * 12.9898) * 43758.5453;
  return (value - Math.floor(value) - 0.5) * 0.8;
};
const gaussian = (x: number, centre: number, sigma: number, height: number) =>
  height * Math.exp(-0.5 * ((x - centre) / sigma) ** 2);

/** Main emission peak at 520 nm plus known anomaly signatures. */
function samplePoints(): Point[] {
  return Array.from({ length: 101 }, (_, index) => {
    const x = 450 + index;
    let y = 10 + gaussian(x, 520, 8, 500) + noise(index);
    if (x === 480) y += 40;
    if (x === 490) y += 35;
    if (x === 491) y += 32;
    if (x >= 470 && x <= 473) y += 14 + (x - 470) * 2;
    if (x === 530) y += 300;
    return { x, y };
  });
}
const params = (overrides: Partial<AssistantParameters> = {}): AssistantParameters => ({
  ...DEFAULT_ASSISTANT_PARAMETERS,
  ...overrides,
});
const input = (overrides: Partial<AssistantProcessInput> = {}): AssistantProcessInput => ({
  points: samplePoints(),
  excitationNm: 350,
  solvent: '水',
  slitNm: 2.5,
  blank: null,
  subtractBlank: false,
  blankSameConditions: false,
  parameters: params(),
  ...overrides,
});

describe('AI 光谱助手数值处理', () => {
  it('repairs only isolated spikes, masks an unrepairable run and never touches the protected peak', () => {
    const source = samplePoints(),
      before = JSON.stringify(source);
    const result = processAssistantSpectrum(input());
    expect(JSON.stringify(source)).toBe(before);
    expect(result.algorithmVersion).toBe(ASSISTANT_ALGORITHM_VERSION);
    expect(result.stats).toMatchObject({
      points: 101,
      repaired: 3,
      masked: 4,
      unresolved: 0,
    });
    const repaired = result.anomalies.filter((anomaly) => anomaly.status === 'repaired');
    expect(repaired.map((anomaly) => anomaly.wavelengths)).toEqual([[480], [490, 491]]);
    const masked = result.anomalies.find((anomaly) => anomaly.status === 'masked');
    expect(masked?.kind).toBe('unrepairable');
    expect(masked?.wavelengths).toEqual([470, 471, 472, 473]);
    expect(result.points.filter((point) => point.status === 'masked').map((point) => point.x)).toEqual(
      [470, 471, 472, 473],
    );
    // The unusual point at 530 nm sits inside the protected main peak.
    const protectedPoint = result.points.find((point) => point.x === 530)!;
    expect(protectedPoint.protected).toBe(true);
    expect(protectedPoint.status).toBe('normal');
    expect(protectedPoint.processed).toBe(protectedPoint.original);
    expect(result.mainPeak?.originalX).toBe(520);
    expect(result.mainPeak?.processedY).toBe(result.mainPeak?.correctedY);
    expect(result.checks.find((check) => check.key === 'peak')?.status).toBe('pass');
    expect(result.checks.find((check) => check.key === 'mask')?.status).toBe('warn');
  });

  it('preserves every wavelength and original intensity and produces broken chart segments', () => {
    const source = samplePoints();
    const result = processAssistantSpectrum(input());
    expect(result.points.map((point) => point.x)).toEqual(source.map((point) => point.x));
    expect(result.points.map((point) => point.original)).toEqual(source.map((point) => point.y));
    const segments = processedSegments(result.points);
    expect(segments).toHaveLength(2);
    expect(segments[0].at(-1)!.x).toBe(469);
    expect(segments[1][0].x).toBe(474);
    expect(segments.flat().some((point) => point.x === 470)).toBe(false);
  });

  it('restricts new detections to the requested analysis range and honours manual protection', () => {
    const points = samplePoints().map((point) =>
      point.x === 460 ? { ...point, y: point.y + 40 } : point,
    );
    const ranged = processAssistantSpectrum(
      input({
        points,
        parameters: params({ analysisRange: { fromNm: 490, toNm: 510 } }),
      }),
    );
    expect(ranged.points.find((point) => point.x === 460)?.status).toBe('normal');
    expect(ranged.anomalies.some((anomaly) => anomaly.wavelengths.includes(460))).toBe(false);
    const protectedResult = processAssistantSpectrum(
      input({
        parameters: params({ userProtectedRange: { fromNm: 476, toNm: 484 } }),
      }),
    );
    const point = protectedResult.points.find((entry) => entry.x === 480)!;
    expect(point.protected).toBe(true);
    expect(point.status).toBe('normal');
    expect(point.processed).toBe(point.original);
    expect(() =>
      processAssistantSpectrum(
        input({ parameters: params({ userProtectedRange: { fromNm: 100, toNm: 200 } }) }),
      ),
    ).toThrow('超出测量范围');
  });

  it('uses stronger detection for aggressive settings and never fabricates a long run', () => {
    const points = samplePoints().map((point) =>
      point.x === 460 ? { ...point, y: point.y + 18 } : point,
    );
    const conservative = processAssistantSpectrum(
      input({ points, parameters: params({ thresholdSigma: 6 }) }),
    );
    const aggressive = processAssistantSpectrum(
      input({ points, parameters: params({ thresholdSigma: 3 }) }),
    );
    expect(
      conservative.anomalies.some((anomaly) => anomaly.wavelengths.includes(460)),
    ).toBe(false);
    expect(aggressive.anomalies.some((anomaly) => anomaly.wavelengths.includes(460))).toBe(true);
    const result = processAssistantSpectrum(
      input({ parameters: params({ maskUnrepairable: false }) }),
    );
    const longRun = result.points.filter((point) => point.x >= 470 && point.x <= 473);
    expect(longRun.every((point) => point.status === 'unresolved')).toBe(true);
    expect(longRun.every((point) => point.processed === point.corrected)).toBe(true);
  });

  it('subtracts a same-condition blank only inside its measured range and keeps negative values', () => {
    const points = samplePoints();
    const blank = {
      name: '空白-水',
      points: points.map((point) => ({ x: point.x, y: 12 + gaussian(point.x, 520, 8, 20) })),
    };
    const result = processAssistantSpectrum(
      input({ blank, subtractBlank: true, blankSameConditions: true }),
    );
    expect(result.blank?.name).toBe('空白-水');
    expect(result.points[0].blank).toBeCloseTo(12, 8);
    expect(result.points[0].processed).toBeCloseTo(result.points[0].original - 12, 8);
    expect(result.points.some((point) => (point.processed ?? 0) < 0)).toBe(true);
    expect(() =>
      processAssistantSpectrum(input({ blank, subtractBlank: true, blankSameConditions: false })),
    ).toThrow('测量条件一致');
    const narrow = {
      name: '窄空白',
      points: blank.points.filter((point) => point.x >= 470 && point.x <= 500),
    };
    expect(() =>
      processAssistantSpectrum(
        input({ blank: narrow, subtractBlank: true, blankSameConditions: true }),
      ),
    ).toThrow('未覆盖样品范围');
  });

  it('identifies excitation-related scattering, keeps it untouched by default and masks only when confirmed', () => {
    const points = Array.from({ length: 81 }, (_, index) => {
      const x = 380 + index;
      return {
        x,
        y:
          5 +
          gaussian(x, 400, 1.5, 100) +
          gaussian(x, 430, 8, 400) +
          noise(index),
      };
    });
    const base = input({ points, excitationNm: 400 });
    const suggested = processAssistantSpectrum(base);
    expect(suggested.scattering.map((candidate) => candidate.type)).toContain('rayleigh');
    const rayleigh = suggested.points.find((point) => point.x === 400)!;
    expect(rayleigh.status).toBe('normal');
    expect(rayleigh.processed).toBe(rayleigh.corrected);
    expect(
      suggested.anomalies.some(
        (anomaly) => anomaly.kind === 'scattering' && anomaly.status === 'suggested',
      ),
    ).toBe(true);
    const masked = processAssistantSpectrum({
      ...base,
      parameters: params({ maskScattering: true }),
    });
    expect(masked.points.find((point) => point.x === 400)?.status).toBe('masked');
    expect(masked.points.find((point) => point.x === 400)?.processed).toBeNull();
    expect(masked.points.find((point) => point.x === 430)?.protected).toBe(true);
    expect(masked.checks.find((check) => check.key === 'mask')?.status).toBe('warn');
  });

  it('normalizes parameters, exposes stable keys and writes a natural-language summary', () => {
    expect(
      normalizeAssistantParameters(
        params({ thresholdSigma: 99, windowSize: 8, maxRepairRun: 99, protectExtraNm: -1 }),
      ),
    ).toMatchObject({
      thresholdSigma: 10,
      windowSize: 9,
      maxRepairRun: 10,
      protectExtraNm: 0,
    });
    expect(normalizeAssistantParameters(params({ windowSize: 20 })).windowSize).toBe(15);
    const first = input(),
      key = assistantProcessingKey(first);
    expect(assistantProcessingKey(first)).toBe(key);
    expect(assistantProcessingKey({ ...first, parameters: params({ thresholdSigma: 5 }) })).not.toBe(
      key,
    );
    const result = processAssistantSpectrum(first);
    expect(describeAssistantResult(result)).toContain('主发射峰');
    expect(describeAssistantResult(result)).toContain('局部修复');
    expect(median([3, 1, 2])).toBe(2);
    expect(mad([1, 2, 3])).toBe(1);
  });

  it('rejects invalid spectra and range combinations with actionable messages', () => {
    expect(() =>
      processAssistantSpectrum(input({ points: samplePoints().slice(0, 4) })),
    ).toThrow('少于 5');
    expect(() =>
      processAssistantSpectrum(
        input({
          points: [
            { x: 450, y: 1 },
            { x: 450, y: 2 },
            { x: 451, y: 3 },
            { x: 452, y: 4 },
            { x: 453, y: 5 },
          ],
        }),
      ),
    ).toThrow('严格递增');
    expect(() =>
      processAssistantSpectrum(
        input({
          parameters: params({
            userProtectedRange: { fromNm: 460, toNm: 500 },
            analysisRange: { fromNm: 460, toNm: 500 },
          }),
        }),
      ),
    ).toThrow('完全重叠');
  });
});
