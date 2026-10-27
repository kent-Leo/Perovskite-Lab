import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { processSpectra, processedSegments, type ProcessingPlan } from '../src/domain/spectrum-processing-v0.9.1-2026.10.27';
import { buildProcessingWorkbook, type ProcessingAudit } from '../src/services/processing-export-v0.9.1-2026.10.27';
import { validateAnalysis, validateSuggestion } from '../shared/ai-contract-v0.9.1-2026.10.27';
import type { Spectrum } from '../src/domain/types';
const sample = (id = 'sample'): Spectrum => ({ id, name: id, color: '#177962', role: 'target',
  unit: 'µmol/L', concentration: '1', visible: true, source: '样品-2026.10.24.txt',
  points: [400, 401, 402, 403, 404].map((x, i) => ({ x, y: [10, 12, 100, 15, 10][i] })),
});
const plan = (): ProcessingPlan => ({ regions: [{ id: 'r1', spectrumId: 'sample', fromNm: 402,
  toNm: 402, reason: '确认干扰', enabled: true, origin: 'manual' }],
  blank: null, subtractBlank: false, sameConditions: false, protectedRange: null,
});
describe('可追溯光谱处理', () => {
  it('only masks confirmed points, preserves originals and separates chart segments', () => {
    const source = sample(), before = JSON.stringify(source), settings = plan();
    const result = processSpectra([source], settings);
    expect(JSON.stringify(source)).toBe(before);
    expect(result.spectra[0].points.map((p) => p.y)).toEqual([10, 12, null, 15, 10]);
    expect(processedSegments(result.spectra[0].points).map((run) => run.map((p) => p.x)))
      .toEqual([[400, 401], [403, 404]]);
    source.points[0].y = 999;
    settings.regions[0].reason = 'later edit';
    expect(result.originals[0].points[0].y).toBe(10);
    expect(result.plan.regions[0].reason).toBe('确认干扰');
  });
  it('does not apply unconfirmed AI suggestions or no-op plans', () => {
    const settings = plan(); settings.regions[0].enabled = false;
    expect(() => processSpectra([sample()], settings)).toThrow('请勾选');
  });
  it('blocks protected overlaps, invalid ranges, unknown samples and off-grid ranges', () => {
    const settings = plan(); settings.protectedRange = { fromNm: 402, toNm: 404 };
    expect(() => processSpectra([sample()], settings)).toThrow('保护区');
    settings.protectedRange = null;
    for (const region of [
      { fromNm: 403, toNm: 401 }, { fromNm: 399, toNm: 400 },
      { fromNm: 401.2, toNm: 401.8 }, { spectrumId: 'unknown' },
    ]) expect(() => processSpectra([sample()], { ...settings,
      regions: [{ ...settings.regions[0], ...region }] })).toThrow();
  });
  it('interpolates blank only within measured range, keeps negative values and needs confirmation', () => {
    const blank = { ...sample('blank'), points: [{ x: 400, y: 20 }, { x: 404, y: 28 }] };
    const settings = { ...plan(), regions: [], blank, subtractBlank: true, sameConditions: true };
    const result = processSpectra([sample()], settings);
    expect(result.spectra[0].points.map((p) => p.y)).toEqual([-10, -10, 76, -11, -18]);
    expect(() => processSpectra([sample()], { ...settings, sameConditions: false })).toThrow('条件一致');
    expect(() => processSpectra([sample()], { ...settings, blank: { ...blank,
      points: [{ x: 401, y: 20 }, { x: 404, y: 28 }] } })).toThrow('不能外推');
    expect(() => processSpectra([sample()], { ...settings, blank: sample() })).toThrow('空白不能');
  });
  it('exports an editable workbook with real blanks, exact raw values and four audit sheets', async () => {
    const result = processSpectra([sample()], plan());
    const audit: ProcessingAudit = { sheet: '测试 sheet', excitation: '350', solvent: '水',
      appliedOn: '2026.10.24', ai: null };
    const bytes = await buildProcessingWorkbook(result, audit);
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toEqual(['原始数据', '处理数据', '修改记录', '处理参数']);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.处理数据, { defval: '' });
    expect(rows[2].处理强度).toBe('');
    expect(rows[2].原始强度).toBe(100);
    expect(rows[2].状态).toBe('已排除');
    expect(wb.Sheets.处理数据.F4?.f).toBeUndefined();
    expect(XLSX.utils.sheet_to_json(wb.Sheets.修改记录)).toHaveLength(1);
    expect(JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets.处理参数))).not.toMatch(/apiKey|Authorization/);
  });
});
describe('AI 输入输出验证', () => {
  const input = () => ({ spectra: [sample()], excitationNm: 350, solvent: '水', blank: null, protectedRange: null });
  it('rejects duplicate / unordered / nonfinite points and incomplete protection', () => {
    for (const points of [[{ x: 400, y: 1 }, { x: 400, y: 2 }],
      [{ x: 401, y: 1 }, { x: 400, y: 2 }], [{ x: 400, y: Infinity }, { x: 401, y: 2 }]])
      expect(() => validateAnalysis({ ...input(), spectra: [{ ...sample(), points }] })).toThrow();
    expect(() => validateAnalysis({ ...input(), protectedRange: { fromNm: 400 } })).toThrow();
    expect(() => validateAnalysis({ ...input(), excitationNm: 0 })).toThrow();
  });
  it('does not silently downsample over-limit data or trust hallucinated sample ids', () => {
    expect(() => validateAnalysis({ ...input(), spectra: [0, 1].map((n) => ({ ...sample(String(n)),
      points: Array.from({ length: 7000 }, (_, i) => ({ x: 1 + i, y: i })) })) })).toThrow('不会自动抽稀');
    expect(() => validateSuggestion({ summary: '测试', regions: [{ spectrumId: 'invented', fromNm: 400,
      toNm: 401, reason: 'test' }] }, [sample()])).toThrow('不属于');
    expect(() => validateSuggestion({ summary: '测试', regions: [{ spectrumId: 'sample', fromNm: 399,
      toNm: 401, reason: 'test' }] }, [sample()])).toThrow('超出');
    expect(() => validateSuggestion({ summary: '测试', regions: [{ spectrumId: 'sample', fromNm: 400.1,
      toNm: 400.2, reason: 'test' }] }, [sample()])).toThrow('没有测量点');
  });
});
