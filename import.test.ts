import { describe, it, expect } from 'vitest';
import {
  readDataFile,
  mappedImport,
  mergeImport,
  inferMapping,
  type Mapping,
} from '../src/services/import';
import { demoWorkspace } from '../src/state/workspace';
const wide: Mapping = {
  kind: 'wide',
  start: 1,
  header: true,
  x: 0,
  ys: [1, 2],
  name: 0,
  concentration: 1,
  unit: 'μM',
};
const fixture = {
  name: 'test.csv',
  sheets: [
    {
      name: 'data',
      rows: [
        ['nm', 'A', 'B'],
        [502, 20, 30],
        [500, 10, 15],
        ['bad', 8, 9],
      ],
    },
  ],
};
describe('data imports', () => {
  it('automatically maps two-column object files without requiring concentration', async () => {
    const file = await readDataFile(new File(['名称,强度\nBlank,12000\nCd2+,2800'], 'objects.csv'));
    const m = inferMapping(file.sheets[0], 'objects', 'μM');
    expect(m).toMatchObject({ header: true, name: 0, concentration: -1, ys: [1] });
    expect(mappedImport(file, 0, m).objects).toHaveLength(2);
  });
  it('uses column names rather than position for reordered numeric columns', async () => {
    const file = await readDataFile(
      new File(['Intensity,Wavelength\n1,500\n2,501'], 'spectrum.csv'),
    );
    const m = inferMapping(file.sheets[0], 'wide', 'μM');
    expect(m).toMatchObject({ x: 1, ys: [0] });
    expect(mappedImport(file, 0, m).spectra[0].points[0]).toEqual({ x: 500, y: 1 });
  });
  it('preserves the first point of headerless long-form data', async () => {
    const file = await readDataFile(new File(['Blank,500,1\nBlank,501,2'], 'long.csv'));
    const m = inferMapping(file.sheets[0], 'long', 'μM');
    expect(m.header).toBe(false);
    expect(mappedImport(file, 0, m).spectra[0].points).toHaveLength(2);
  });
  it('detects delimiters beyond preambles and preserves physical start rows', async () => {
    const text = 'Instrument,metadata\n' + '\n'.repeat(31) + '波长;强度\n500;1\n501;2\n';
    const file = await readDataFile(new File([text], 'instrument.csv'));
    const m = inferMapping(file.sheets[0], 'wide', 'μM');
    expect(m.start).toBe(33);
    expect(mappedImport(file, 0, m).spectra[0].points).toHaveLength(2);
  });
  it('supports Excel sep directives and BOM-marked UTF-16 text', async () => {
    const text = 'sep=;\r\nWavelength;Intensity\r\n500;1\r\n501;2';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) {
      bytes[2 + i * 2] = text.charCodeAt(i) & 255;
      bytes[3 + i * 2] = text.charCodeAt(i) >> 8;
    }
    const file = await readDataFile(new File([bytes], 'unicode.csv'));
    expect(
      mappedImport(file, 0, inferMapping(file.sheets[0], 'wide', 'μM')).spectra[0].points,
    ).toHaveLength(2);
  });
  it('explains unrecognized separators, missing columns and nonnumeric cells', async () => {
    const file = await readDataFile(
      new File(['Wavelength;Intensity\n500;1\n501;2'], 'f.csv'),
      'utf-8',
      ',',
    );
    expect(() => mappedImport(file, 0, { ...wide, ys: [1] })).toThrow(/只识别到 1 列/);
    expect(() => mappedImport(fixture, 0, { ...wide, ys: [5] })).toThrow(/强度列不存在/);
    const units = await readDataFile(
      new File(['Wavelength,Intensity\n500 nm,1 a.u.\n501 nm,2 a.u.'], 'f.csv'),
    );
    expect(() => mappedImport(units, 0, { ...wide, ys: [1] })).toThrow(/波长不是数值/);
  });
  it('maps multiple spectra, sorts wavelengths and counts malformed rows', () => {
    const r = mappedImport(fixture, 0, wide);
    expect(r.spectra).toHaveLength(2);
    expect(r.spectra[0].points).toEqual([
      { x: 500, y: 10 },
      { x: 502, y: 20 },
    ]);
    expect(r.skipped).toBe(1);
  });
  it('rejects duplicate wavelengths rather than silently averaging', () => {
    expect(() =>
      mappedImport(
        {
          ...fixture,
          sheets: [
            {
              name: 'd',
              rows: [
                ['nm', 'A'],
                [500, 1],
                [500, 2],
              ],
            },
          ],
        },
        0,
        { ...wide, ys: [1] },
      ),
    ).toThrow(/重复/);
  });
  it('groups long-form samples without requiring predefined names', () => {
    const r = mappedImport(
      {
        name: 'long.csv',
        sheets: [
          {
            name: 'd',
            rows: [
              ['sample', 'nm', 'F'],
              ['河水 + Cd²⁺', 500, 1],
              ['Blank', 500, 3],
              ['河水 + Cd²⁺', 501, 2],
              ['Blank', 501, 4],
            ],
          },
        ],
      },
      0,
      { ...wide, kind: 'long', x: 1, ys: [2], name: 0 },
    );
    expect(r.spectra.map((s) => s.name)).toEqual(['河水 + Cd²⁺', 'Blank']);
  });
  it('preserves quoted commas and reads whitespace TXT with no header', async () => {
    const f = new File(['nm,"A, blank"\n500,1\n501,2'], 'f.csv');
    const r = await readDataFile(f);
    expect(r.sheets[0].rows[0][1]).toBe('A, blank');
    const t = await readDataFile(new File(['500 1\n501 2'], 'f.txt'));
    expect(mappedImport(t, 0, { ...wide, ys: [1], header: false }).spectra[0].points).toHaveLength(
      2,
    );
  });
  it('reads XLSX workbooks with multiple sheets', async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['nm', 'F'],
        [500, 10],
        [501, 20],
      ]),
      'First',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['nm', 'F'],
        [510, 15],
        [511, 25],
      ]),
      'Second',
    );
    for (const bookType of ['xlsx', 'xls'] as const) {
      const file = new File([XLSX.write(wb, { type: 'array', bookType })], `workbook.${bookType}`);
      const r = await readDataFile(file);
      expect(r.sheets.map((s) => s.name)).toEqual(['First', 'Second']);
      expect(mappedImport(r, 1, { ...wide, ys: [1] }).spectra[0].points[0].x).toBe(510);
    }
  });
  it('imports objects without a concentration column', () => {
    const r = mappedImport(
      {
        name: 'obj.csv',
        sheets: [
          {
            name: 'd',
            rows: [
              ['Name', 'F'],
              ['任意对象', 123],
            ],
          },
        ],
      },
      0,
      { ...wide, kind: 'objects', ys: [1], concentration: -1 },
    );
    expect(r.objects[0].name).toBe('任意对象');
    expect(r.objects[0].concentration).toBe('');
  });
  it('clears all demo datasets and empty-response defaults on first import', () => {
    const d = demoWorkspace();
    const r = mappedImport(fixture, 0, wide);
    const p = mergeImport(d, r, 'μM');
    expect(p.objects).toEqual([]);
    expect(p.calibration).toEqual([]);
    expect(p.spectra).toHaveLength(2);
    expect(p.calF0).toBe('');
    expect(p.blankRepeats).toBe('');
  });
  it('converts appended calibration data without reinterpreting existing units', () => {
    const d = { ...demoWorkspace(), demo: false };
    const r = {
      spectra: [],
      objects: [],
      calibration: [{ id: '1', concentration: '1000', intensity: '11000', included: true }],
      count: 1,
      skipped: 0,
    };
    const p = mergeImport(d, r, 'nM');
    expect(p.calibration?.at(-1)?.concentration).toBe('1');
    expect(p.calUnit).toBe('µmol/L');
    expect(() => mergeImport(d, r, 'mg/L')).toThrow();
  });
});
