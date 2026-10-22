import { numeric, spectrumStats } from './math';
import type { Point } from './types';

export interface PeakMetrics {
  peak: number | null;
  intensity: number | null;
  fwhm: number | null;
  area: number | null;
  from: number | null;
  to: number | null;
  stokes: number | null;
}

/**
 * Peak characteristics of one emission spectrum.
 * The area is the trapezoidal integral over the measured range and the Stokes
 * shift is the emission maximum minus the excitation wavelength, both in nm.
 */
export function peakMetrics(points: Point[], excitation?: string | number | null): PeakMetrics {
  const stats = spectrumStats(points),
    ex = typeof excitation === 'number' ? excitation : numeric(excitation);
  const validExcitation = ex !== null && Number.isFinite(ex) && ex > 0 ? ex : null;
  return {
    peak: stats?.peak ?? null,
    intensity: stats?.max ?? null,
    fwhm: stats?.fwhm ?? null,
    area: stats?.area ?? null,
    from: points[0]?.x ?? null,
    to: points.at(-1)?.x ?? null,
    stokes: stats && validExcitation !== null ? stats.peak - validExcitation : null,
  };
}
