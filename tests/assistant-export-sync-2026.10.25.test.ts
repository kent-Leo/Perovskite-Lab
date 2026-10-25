import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSpectrumText } from '../src/services/f7100-2026.10.25';
import {
  ASSISTANT_ALGORITHM_VERSION,
  DEFAULT_ASSISTANT_PARAMETERS,
  processAssistantSpectrum,
} from '../src/domain/assistant-processing-2026.10.25';
import {
  assistantAnomalyRows,
  assistantOriginalRows,
  assistantProcessedRows,
  assistantReportRows,
  buildAssistantWorkbook,
  type AssistantAudit,
  type AssistantExportInput,
} from '../src/services/assistant-export-2026.10.25';
import {
  baseAiSheetName,
  buildAssistantSheetBundle,
  syncAssistantResult,
  type AssistantSheetBuildInput,
} from '../src/services/assistant-sheet-2026.10.25';
import { blankWorkspace } from '../src/state/workspace';
import {
  capturePayload,
  createSheetWithPayload,
  ensureWorkbooks,
  sheetSnapshots,
  switchSheet,
  writeSheetPayload,
} from '../src/domain/workbook';
import type { Point } from '../src/domain/types';

const gaussian = (x: number, centre: number, sigma: number, height: number) =>
  height * Math.exp(-0.5 * ((x - centre) / sigma) ** 2);
const noise = (index: number) => {
  const value = Math.sin(index * 7.17) * 14713.37;
  return (value - Math.floor(value) - 0.5) * 0.4;
};
function points(): Point[] {
  return Array.from({ length: 101 }, (_, index) => {
    const x = 450 + index;
    let y = 10 + gaussian(x, 520, 8, 500) + noise(index);
    if (x === 480) y += 40;
    if (x >= 470 && x <= 473) y += 16;
    return { x, y };
  });
}
function f7100Text(data: Point[]) {
  return `Sample:\t'测试样品
File name:\t测试样品.FDS
Run date:\t'11:18:14, 10/23/2026 - 11:18:21, 10/23/2026
Operator:\tTEST
Comment:\t'

Instrument
Model:\tF-7100 FL Spectrophotometer
Serial number:\t0000-000
ROM Version:\tTEST

Instrument parameters
Measurement type:\tWavelength scan
Scan mode:\tEmission
Data mode:\tFluorescence
EX WL:\t350.0 nm
EM  Start WL:\t450.0 nm
EM  End WL:\t550.0 nm
Scan speed:\t30000 nm/min
Delay:\t0.0 s
EX Slit:\t2.5 nm
EM Slit:\t2.5 nm
PMT Voltage:\t500 V
Response:\t0.002 s
Corrected spectra:\tOff
Shutter control:\tOff

Peak integration
Integration method:\tRectangular
Sensitivity:\t1
Threshold:\t1.000

Peaks
No.\tStart(nm)\tApex(nm)\tEnd(nm)\tHeight(Data)\tValley(nm)\tValley(Data)
1\t500.0\t520.0\t540.0\t500.0\t540.0\t1.000

Data points
nm\tData
${data.map((point) => `${point.x.toFixed(1)}\t${point.y.toFixed(4)}`).join('\n')}
`;
}
const parsed = parseSpectrumText(f7100Text(points()), '测试样品(FDS).TXT');
const result = processAssistantSpectrum({
  points: parsed.points,
  rowNumbers: parsed.rowNumbers,
  excitationNm: parsed.metadata.excitationNm,
  solvent: '水',
  slitNm: parsed.metadata.emSlitNm,
  blank: null,
  subtractBlank: false,
  blankSameConditions: false,
  parameters: DEFAULT_ASSISTANT_PARAMETERS,
});
const audit: AssistantAudit = {
  fileName: parsed.fileName,
  sheetName: baseAiSheetName(parsed.fileName),
  excitationNm: parsed.metadata.excitationNm,
  solvent: '水',
  ai: {
    provider: 'deepseek',
    model: 'deepseek-flash',
    summary: '检测到一处孤立异常尖峰，目标发射峰已保留。',
    notes: ['A1：孤立测量点，支持局部插值。'],
  },
  userInstructions: ['帮我处理异常尖峰', '不要修改主峰附近'],
  exportedOn: '2026-10-25',
};
const exportInput: AssistantExportInput = { parsed, result, audit };
const sheetInput: AssistantSheetBuildInput = {
  ...exportInput,
  unit: 'µmol/L',
  fallbackExcitation: '',
};

describe('AI 光谱助手 Excel 导出', () => {
  it('writes exactly four traceable sheets with every original and processed row', async () => {
    const bytes = await buildAssistantWorkbook(exportInput);
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toEqual(['原始数据', '处理后数据', '杂峰处理记录', 'AI分析报告']);
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.原始数据, { defval: '' });
    const processed = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets.处理后数据,
      { defval: '' },
    );
    expect(raw).toHaveLength(101);
    expect(processed).toHaveLength(101);
    expect(raw[0].波长_nm).toBe(450);
    expect(raw[0].原始强度).toBe(parsed.points[0].y);
    expect(raw[0].来源文件).toBe('测试样品(FDS).TXT');
    expect(processed[0].原始强度).toBe(parsed.points[0].y);
    expect(processed.filter((row) => row.处理状态 === '已修复').map((row) => row.波长_nm)).toEqual(
      [480],
    );
    expect(
      processed.filter((row) => row.处理状态 === '已屏蔽').map((row) => row.波长_nm),
    ).toEqual([470, 471, 472, 473]);
    expect(processed.find((row) => row.波长_nm === 470)?.处理后强度).toBe('');
    expect(processed.find((row) => row.波长_nm === 480)?.处理方法).toContain('局部线性插值');
    const anomalies = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets.杂峰处理记录,
      { defval: '' },
    );
    expect(anomalies).toHaveLength(assistantAnomalyRows(result).length);
    expect(anomalies.some((row) => row.异常类型 === '连续异常区间')).toBe(true);
    expect(anomalies.some((row) => row.修复值 === '')).toBe(true);
    const report = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.AI分析报告, {
      defval: '',
    });
    const lookup = Object.fromEntries(report.map((row) => [row.项目, row.内容]));
    expect(lookup.处理算法版本).toBe(ASSISTANT_ALGORITHM_VERSION);
    expect(lookup.激发波长_nm).toBe(350);
    expect(lookup.文件名称).toBe('测试样品(FDS).TXT');
    expect(lookup.AI分析说明).toContain('孤立异常尖峰');
    expect(String(lookup['质量检查_主发射峰保留'])).toContain('通过');
    expect(JSON.stringify(report)).not.toMatch(/apiKey|Authorization|Bearer/);
    expect(wb.Sheets.处理后数据.F4?.f).toBeUndefined();
    // Numeric cells stay numeric so Origin/Excel can plot them directly.
    expect(typeof processed[1].波长_nm).toBe('number');
    expect(typeof processed[1].处理后强度).toBe('number');
  });

  it('writes the corrected excitation wavelength into the generated Sheet payload', () => {
    const bundle = buildAssistantSheetBundle({
      ...sheetInput,
      audit: { ...audit, excitationNm: 355 },
    });
    expect(bundle.payload.excitation).toBe('355');
  });

  it('shares the same row arrays between direct export and Sheet synchronisation', () => {
    const original = assistantOriginalRows(exportInput);
    const processed = assistantProcessedRows(exportInput);
    const bundle = buildAssistantSheetBundle(sheetInput);
    expect(original).toHaveLength(bundle.payload.grid.length - 1);
    expect(processed).toHaveLength(bundle.payload.grid.length - 1);
    processed.forEach((row, index) => {
      const grid = bundle.payload.grid[index + 1];
      expect(grid[0]).toBe(String(row.波长_nm));
      expect(grid[1]).toBe(String(row.原始强度));
      expect(grid[2]).toBe(row.处理后强度 === '' ? '' : String(row.处理后强度));
    });
    expect(bundle.payload.mapping).toMatchObject({ x: 0, ys: [1, 2], header: true });
    expect(bundle.payload.spectra).toHaveLength(2);
    expect(bundle.payload.rawSpectra?.[1].points.length).toBe(bundle.processedPoints);
    expect(bundle.metadata['raw-2'].title).toBe('处理后强度');
    expect(assistantReportRows(exportInput).length).toBeGreaterThan(20);
  });
});

describe('AI 结果同步到网站 Sheet', () => {
  const base = ensureWorkbooks(blankWorkspace());
  const before = JSON.stringify(capturePayload(base, 'raw'));

  it('creates a new active sheet, keeps the old sheet and plots both curves', () => {
    const outcome = syncAssistantResult(base, sheetInput, {
      mode: 'create',
      sheetName: baseAiSheetName(parsed.fileName),
    });
    expect(outcome.created).toBe(true);
    expect(outcome.sheetName).toBe('测试样品(FDS)_AI处理');
    const next = ensureWorkbooks({ ...base, ...outcome.patch });
    const wb = next.workbooks.raw;
    expect(wb.tabs.map((tab) => tab.name)).toEqual(['原始光谱', '测试样品(FDS)_AI处理']);
    expect(wb.activeId).toBe(outcome.sheetId);
    expect(JSON.stringify(wb.store.raw)).toBe(before);
    expect(next.spectra).toHaveLength(2);
    expect(next.spectra.every((spectrum) => spectrum.visible)).toBe(true);
    expect(next.rawSpectra).toHaveLength(2);
    expect(next.rawColumnSpectra).toEqual({
      'raw-1': next.spectra[0].id,
      'raw-2': next.spectra[1].id,
    });
    expect(next.rawSheet?.grid).toHaveLength(102);
    expect(next.rawSheet?.grid[0]).toEqual([
      '波长 / nm',
      '原始强度',
      '处理后强度',
      '异常标记',
      '处理方法',
    ]);
    expect(next.excitation).toBe('350');
    expect(next.sheetMetadata?.[outcome.sheetId]?.['raw-2']?.title).toBe('处理后强度');
    expect(next.rawSheet?.mapping.ys).toEqual([1, 2]);
    // The processed curve breaks at masked points but the original curve is complete.
    expect(next.rawSpectra?.[0].points).toHaveLength(101);
    expect(next.rawSpectra?.[1].points).toHaveLength(97);
  });

  it('updates the existing AI sheet in place without adding a new one', () => {
    const first = syncAssistantResult(base, sheetInput, {
      mode: 'create',
      sheetName: baseAiSheetName(parsed.fileName),
    });
    const afterCreate = ensureWorkbooks({ ...base, ...first.patch });
    const updatedResult = {
      ...result,
      points: result.points.map((point) => ({ ...point, method: '更新测试' })),
    };
    // Update an inactive AI sheet: the sync must also activate it so the chart is visible.
    const atOriginal = ensureWorkbooks({
      ...afterCreate,
      ...switchSheet(afterCreate, 'raw', 'raw'),
    });
    expect(atOriginal.workbooks.raw.activeId).toBe('raw');
    const second = syncAssistantResult(
      atOriginal,
      { ...sheetInput, result: updatedResult },
      { mode: 'update', targetSheetId: first.sheetId, sheetName: first.sheetName },
    );
    expect(second.created).toBe(false);
    const afterUpdate = ensureWorkbooks({ ...atOriginal, ...second.patch });
    expect(afterUpdate.workbooks.raw.tabs).toHaveLength(2);
    expect(afterUpdate.workbooks.raw.activeId).toBe(first.sheetId);
    expect(afterUpdate.rawSheet?.grid[1][4]).toBe('更新测试');
    expect(afterUpdate.workbooks.raw.store.raw).toEqual(JSON.parse(before));
  });

  it('never overwrites an existing sheet when creating a second version', () => {
    const first = syncAssistantResult(base, sheetInput, {
      mode: 'create',
      sheetName: baseAiSheetName(parsed.fileName),
    });
    const afterFirst = ensureWorkbooks({ ...base, ...first.patch });
    const second = syncAssistantResult(afterFirst, sheetInput, {
      mode: 'create',
      sheetName: baseAiSheetName(parsed.fileName, 2),
    });
    const afterSecond = ensureWorkbooks({ ...afterFirst, ...second.patch });
    expect(second.sheetId).not.toBe(first.sheetId);
    expect(second.sheetName).toBe('测试样品(FDS)_AI处理 v2');
    expect(afterSecond.workbooks.raw.tabs.map((tab) => tab.name)).toEqual([
      '原始光谱',
      '测试样品(FDS)_AI处理',
      '测试样品(FDS)_AI处理 v2',
    ]);
    expect(JSON.stringify(afterSecond.workbooks.raw.store[first.sheetId])).toContain(
      '波长 / nm',
    );
  });

  it('creates unique names and preserves the active payload when used directly', () => {
    const host = ensureWorkbooks(blankWorkspace());
    const activeBefore = capturePayload(host, 'raw');
    const payload = buildAssistantSheetBundle(sheetInput).payload;
    const patch = createSheetWithPayload(host, 'raw', '同名 Sheet', payload);
    const next = ensureWorkbooks({ ...host, ...patch });
    expect(next.workbooks.raw.store.raw).toEqual(activeBefore);
    expect(next.workbooks.raw.tabs.at(-1)?.name).toBe('同名 Sheet');
    const again = ensureWorkbooks({
      ...next,
      ...createSheetWithPayload(next, 'raw', '同名 Sheet', payload),
    });
    expect(again.workbooks.raw.tabs.map((tab) => tab.name)).toContain('同名 Sheet (2)');
    // Writing to an inactive sheet does not change the top-level active payload.
    const inactiveId = again.workbooks.raw.tabs[1].id;
    const write = writeSheetPayload(again, 'raw', inactiveId, {
      ...payload,
      grid: [['changed']],
    });
    expect(write.rawSheet).toBeUndefined();
    expect((write.workbooks?.raw?.store[inactiveId] as { grid: string[][] }).grid).toEqual([
      ['changed'],
    ]);
    expect(sheetSnapshots(again, 'raw')).toHaveLength(again.workbooks.raw.tabs.length);
  });
});
