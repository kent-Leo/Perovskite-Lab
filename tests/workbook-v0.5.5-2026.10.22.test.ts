import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHEET_NAMES,
  MAX_SHEETS,
  WORKBOOK_IDS,
  applyPayload,
  blankGrid,
  capturePayload,
  createSheet,
  defaultPayload,
  defaultRawMapping,
  defaultRawSheet,
  deleteSheet,
  ensureWorkbooks,
  renameSheet,
  sheetSnapshots,
  switchSheet,
  workbookOf,
  type CalibrationSheetPayload,
  type GradientSheetPayload,
  type RawSheetPayload,
  type ScreeningSheetPayload,
  type SheetPayload,
  type WorkbookHost,
} from '../src/domain/workbook';
import type { ObjectRow, Spectrum, WorkbookId, WorkbookTab } from '../src/domain/types';
import {
  blankWorkspace,
  demoWorkspace,
  normalizeWorkspaceUnits,
  type Workspace,
} from '../src/state/workspace';

const LEGACY_NAMES: Record<WorkbookId, string> = {
  raw: '旧原始表',
  screening: '旧筛选表',
  calibration: '旧校准表',
  gradient: '旧梯度表',
  recognition: '多探针猝灭率',
};

const spectrum = (id: string, name: string): Spectrum => ({
  id,
  name,
  role: 'target',
  concentration: '1',
  unit: 'µmol/L',
  color: '#157c65',
  visible: true,
  points: [{ x: 500, y: 10 }],
  source: '测试数据',
});

const objectRow = (id: string, name: string): ObjectRow => ({
  id,
  name,
  role: 'target',
  concentration: '1',
  unit: 'µmol/L',
  intensity: '100',
  notes: '',
});

/** Small workspace-shaped host with only the fields the workbook model touches. */
function minimalHost(overrides: Partial<WorkbookHost> = {}): WorkbookHost {
  return {
    calUnit: 'µmol/L',
    spectra: [],
    objects: [],
    blankId: '',
    screenMode: 'ratio',
    calibration: [],
    calMode: 'quench',
    calF0: '',
    blankRepeats: '',
    manualSigma: '',
    sigmaSource: 'replicates',
    lodFactor: 3.3,
    fitMin: '',
    fitMax: '',
    gradient: {
      stock: '100',
      volume: '10',
      fixed: '0',
      targets: '0, 0.1, 0.5, 1, 2, 5, 10',
      unit: 'µmol/L',
      targetUnit: 'µmol/L',
    },
    ...overrides,
  };
}

/** Workspace saved by v0.4.5 and earlier: no workbooks, no raw sheet draft. */
function legacyWorkspace(): Workspace {
  const w = demoWorkspace();
  delete w.workbooks;
  delete w.rawSheet;
  w.sheetNames = { ...LEGACY_NAMES, raw: `  ${LEGACY_NAMES.raw}  ` };
  return w;
}

function withPayload<T extends WorkbookHost>(
  host: T,
  page: WorkbookId,
  payload: SheetPayload,
): T {
  return { ...host, ...applyPayload(host, page, payload) };
}

function rawPayload(id: string, grid: string[][], excitation: string): RawSheetPayload {
  return {
    grid,
    mapping: { ...defaultRawMapping('µmol/L'), x: 1, ys: [1] },
    spectra: [spectrum(id, `光谱 ${id}`)],
    rawSpectra: [],
    rawColumnSpectra: { '0': id },
    excitation,
  };
}

interface RawFixture {
  host: Workspace;
  a: RawSheetPayload;
  b: RawSheetPayload;
  c: RawSheetPayload;
}

/** Raw workbench with tabs raw / raw-2 / raw-3; raw is active, the rest live in store. */
function rawMultiSheet(): RawFixture {
  const base = ensureWorkbooks(blankWorkspace());
  const a = rawPayload('a', [['a1', 'a2'], ['a3', 'a4']], '400');
  const b = rawPayload('b', [['b1', 'b2'], ['b3', 'b4']], '450');
  const c = rawPayload('c', [['c1', 'c2'], ['c3', 'c4']], '500');
  const host: Workspace = {
    ...withPayload(base, 'raw', a),
    workbooks: {
      ...base.workbooks,
      raw: {
        tabs: [
          { id: 'raw', name: DEFAULT_SHEET_NAMES.raw },
          { id: 'raw-2', name: 'Sheet 2' },
          { id: 'raw-3', name: 'Sheet 3' },
        ],
        activeId: 'raw',
        store: { 'raw-2': b, 'raw-3': c },
      },
    },
  };
  return { host, a, b, c };
}

const ids = (tabs: WorkbookTab[]) => tabs.map((tab) => tab.id);

describe('ensureWorkbooks: v0.4.5 migration', () => {
  it('gives every page one tab for a workspace saved by v0.4.5', () => {
    const legacy = legacyWorkspace();
    const migrated = ensureWorkbooks(legacy);

    expect(Object.keys(migrated.workbooks).sort()).toEqual([...WORKBOOK_IDS].sort());
    for (const page of WORKBOOK_IDS) {
      expect(migrated.workbooks[page]).toEqual({
        tabs: [{ id: page, name: LEGACY_NAMES[page] }],
        activeId: page,
        store: {},
      });
    }
    // Custom legacy sheet names survive (trimmed) and sheetNames stays in sync.
    expect(migrated.sheetNames).toEqual(LEGACY_NAMES);
    // Legacy workspaces had no raw sheet draft: seed the default 6x3 grid + mapping.
    expect(migrated.rawSheet).toEqual(defaultRawSheet(migrated.calUnit));
    expect(migrated.rawSheet.grid).toEqual(blankGrid());
    expect(migrated.rawSheet.grid).toHaveLength(6);
    expect(migrated.rawSheet.grid[0]).toHaveLength(3);
    // Top-level legacy data is untouched, and the input object is not mutated.
    expect(migrated.spectra).toEqual(legacy.spectra);
    expect(migrated.objects).toEqual(legacy.objects);
    expect(migrated.calibration).toEqual(legacy.calibration);
    expect(migrated.gradient).toEqual(legacy.gradient);
    expect(migrated.calF0).toBe(legacy.calF0);
    expect(legacy.workbooks).toBeUndefined();
    expect(legacy.rawSheet).toBeUndefined();
  });

  it('falls back to the built-in names when a legacy workspace has no sheetNames', () => {
    const legacy = legacyWorkspace();
    delete legacy.sheetNames;
    const migrated = ensureWorkbooks(legacy);

    expect(migrated.sheetNames).toEqual({ ...DEFAULT_SHEET_NAMES });
    for (const page of WORKBOOK_IDS) {
      expect(migrated.workbooks[page].tabs).toEqual([
        { id: page, name: DEFAULT_SHEET_NAMES[page] },
      ]);
    }
  });

  it('is idempotent for migrated and already-current workspaces', () => {
    const once = ensureWorkbooks(legacyWorkspace());
    const twice = ensureWorkbooks(once);
    expect(twice).toEqual(once);

    const demo = ensureWorkbooks(demoWorkspace());
    expect(ensureWorkbooks(demo)).toEqual(demo);
  });

  it('keeps existing multi-tab workbooks and drops the active payload from store', () => {
    const base = ensureWorkbooks(blankWorkspace());
    const stored: SheetPayload = {
      ...(defaultPayload('raw', base.calUnit) as RawSheetPayload),
      grid: [['stored']],
    };
    const staleActive: SheetPayload = {
      ...(defaultPayload('raw', base.calUnit) as RawSheetPayload),
      grid: [['stale']],
    };
    const host: WorkbookHost = {
      ...base,
      workbooks: {
        ...base.workbooks,
        raw: {
          tabs: [
            { id: 'raw', name: '原始光谱' },
            { id: 'raw-2', name: '实验组' },
          ],
          activeId: 'raw-2',
          store: { raw: stored, 'raw-2': staleActive },
        },
      },
    };

    const out = ensureWorkbooks(host);
    expect(out.workbooks.raw.tabs).toEqual([
      { id: 'raw', name: '原始光谱' },
      { id: 'raw-2', name: '实验组' },
    ]);
    expect(out.workbooks.raw.activeId).toBe('raw-2');
    // The invariant is that the active payload lives in the top-level fields only.
    expect(out.workbooks.raw.store).toEqual({ raw: stored });
  });

  it('fills missing store payloads with the default payload of each page', () => {
    const base = ensureWorkbooks(blankWorkspace());
    const host: WorkbookHost = {
      ...base,
      workbooks: {
        ...base.workbooks,
        raw: {
          tabs: [
            { id: 'raw', name: '原始光谱' },
            { id: 'raw-2', name: 'Sheet 2' },
            { id: 'raw-3', name: 'Sheet 3' },
          ],
          activeId: 'raw',
          store: {},
        },
        screening: {
          tabs: [
            { id: 'screening', name: '对象筛选' },
            { id: 'screening-2', name: 'Sheet 2' },
          ],
          activeId: 'screening',
          store: {},
        },
      },
    };

    const out = ensureWorkbooks(host);
    expect(out.workbooks.raw.store['raw-2']).toEqual(defaultPayload('raw', out.calUnit));
    expect(out.workbooks.raw.store['raw-3']).toEqual(defaultPayload('raw', out.calUnit));
    expect(out.workbooks.screening.store['screening-2']).toEqual(
      defaultPayload('screening', out.calUnit),
    );
    // Calibration and gradient keep their single default tab.
    expect(out.workbooks.calibration.tabs).toHaveLength(1);
    expect(out.workbooks.gradient.tabs).toHaveLength(1);
  });

  it('repairs malformed persisted tabs and caps their number at MAX_SHEETS', () => {
    expect(MAX_SHEETS).toBe(20);
    const base = ensureWorkbooks(blankWorkspace());
    const dirty = [
      null,
      'not-a-tab',
      { name: '没有 id' },
      { id: '   ', name: '空白 id' },
      { id: 'raw', name: '   ' },
      { id: 'raw', name: '重复 id' },
      { id: 'raw-2', name: 'x'.repeat(41) },
      { id: 'raw-3', name: '重复名称' },
      { id: 'raw-4', name: '重复名称' },
    ] as unknown as WorkbookTab[];
    const repaired = ensureWorkbooks({
      ...base,
      workbooks: {
        ...base.workbooks,
        raw: {
          tabs: dirty,
          activeId: 'ghost',
          store: { ghost: defaultPayload('raw', base.calUnit) },
        },
      },
    });
    expect(ids(repaired.workbooks.raw.tabs)).toEqual(['raw', 'raw-2', 'raw-3', 'raw-4']);
    expect(repaired.workbooks.raw.tabs.map((tab) => tab.name)).toEqual([
      DEFAULT_SHEET_NAMES.raw,
      `${DEFAULT_SHEET_NAMES.raw} (2)`,
      '重复名称',
      '重复名称 (2)',
    ]);
    expect(repaired.workbooks.raw.activeId).toBe('raw');
    expect(repaired.workbooks.raw.store.ghost).toBeUndefined();

    const many = Array.from({ length: MAX_SHEETS + 5 }, (_, index) => ({
      id: `raw-${index + 1}`,
      name: `Sheet ${index + 1}`,
    }));
    const capped = ensureWorkbooks({
      ...base,
      workbooks: {
        ...base.workbooks,
        raw: { tabs: many, activeId: 'raw-3', store: {} },
      },
    });
    expect(capped.workbooks.raw.tabs).toHaveLength(MAX_SHEETS);
    expect(capped.workbooks.raw.activeId).toBe('raw-3');
  });

  it('normalizes legacy concentration labels while migrating', () => {
    const legacy = legacyWorkspace();
    legacy.calUnit = 'μM';
    legacy.spectra[0].unit = 'μM';
    legacy.objects[0].unit = 'nM';
    legacy.gradient.unit = 'μM';
    delete legacy.gradient.targetUnit;
    legacy.sheetNames = { raw: LEGACY_NAMES.raw };

    const migrated = ensureWorkbooks(normalizeWorkspaceUnits(legacy));
    expect(migrated.calUnit).toBe('µmol/L');
    expect(migrated.rawSheet.mapping.unit).toBe('µmol/L');
    expect(migrated.spectra[0].unit).toBe('µmol/L');
    expect(migrated.objects[0].unit).toBe('nmol/L');
    expect(migrated.gradient.unit).toBe('µmol/L');
    expect(migrated.gradient.targetUnit).toBe('µmol/L');
    expect(migrated.workbooks.raw.tabs).toEqual([{ id: 'raw', name: LEGACY_NAMES.raw }]);
    expect(migrated.sheetNames).toEqual({
      raw: LEGACY_NAMES.raw,
      screening: DEFAULT_SHEET_NAMES.screening,
      calibration: DEFAULT_SHEET_NAMES.calibration,
      gradient: DEFAULT_SHEET_NAMES.gradient,
      recognition: DEFAULT_SHEET_NAMES.recognition,
    });
  });
});

describe('capturePayload / applyPayload', () => {
  it('round-trips the raw grid, mapping, spectra and metadata', () => {
    const host = blankWorkspace();
    const payload: RawSheetPayload = {
      grid: [
        ['名称', '浓度', '强度'],
        ['A', '1', '12000'],
      ],
      mapping: { kind: 'long', start: 2, header: true, x: 1, ys: [1], name: 0, concentration: 0, unit: 'nmol/L' },
      spectra: [spectrum('s-1', 'A')],
      rawSpectra: [spectrum('s-1', 'A')],
      rawColumnSpectra: { '1': 's-1' },
      excitation: '450',
    };
    const next = withPayload(host, 'raw', payload);

    expect(next.rawSheet).toEqual({ grid: payload.grid, mapping: payload.mapping });
    expect(next.spectra).toEqual(payload.spectra);
    expect(next.rawSpectra).toEqual(payload.rawSpectra);
    expect(next.rawColumnSpectra).toEqual(payload.rawColumnSpectra);
    expect(next.excitation).toBe('450');
    expect(capturePayload(next, 'raw')).toEqual(payload);
  });

  it('falls back to a default raw draft when a legacy workspace has none', () => {
    const payload = capturePayload(minimalHost(), 'raw') as RawSheetPayload;
    expect(payload.grid).toEqual(blankGrid());
    expect(payload.mapping).toEqual(defaultRawMapping('µmol/L'));
    expect(payload.spectra).toEqual([]);
    expect(payload.rawColumnSpectra).toEqual({});
    expect(payload.excitation).toBe('');
  });

  it('round-trips the screening payload', () => {
    const payload: ScreeningSheetPayload = {
      objects: [objectRow('o-1', 'Blank'), objectRow('o-2', 'Cd2+')],
      blankId: 'o-1',
      screenMode: 'inverse',
    };
    const next = withPayload(blankWorkspace(), 'screening', payload);

    expect(next.objects).toEqual(payload.objects);
    expect(next.blankId).toBe('o-1');
    expect(next.screenMode).toBe('inverse');
    expect(capturePayload(next, 'screening')).toEqual(payload);
  });

  it('round-trips every calibration field', () => {
    const payload: CalibrationSheetPayload = {
      calibration: [{ id: 'c-1', concentration: '1', intensity: '2', included: true }],
      calMode: 'percent',
      calUnit: 'nmol/L',
      calF0: '12000',
      blankRepeats: '11980, 12020, 11990',
      manualSigma: '35',
      sigmaSource: 'manual',
      lodFactor: 3,
      fitMin: '0.1',
      fitMax: '9',
    };
    const next = withPayload(blankWorkspace(), 'calibration', payload);

    expect(next.calibration).toEqual(payload.calibration);
    expect(next.calMode).toBe('percent');
    expect(next.calUnit).toBe('nmol/L');
    expect(next.calF0).toBe('12000');
    expect(next.blankRepeats).toBe('11980, 12020, 11990');
    expect(next.manualSigma).toBe('35');
    expect(next.sigmaSource).toBe('manual');
    expect(next.lodFactor).toBe(3);
    expect(next.fitMin).toBe('0.1');
    expect(next.fitMax).toBe('9');
    expect(capturePayload(next, 'calibration')).toEqual(payload);
  });

  it('round-trips the gradient settings', () => {
    const payload: GradientSheetPayload = {
      gradient: {
        stock: '100',
        volume: '10',
        fixed: '1',
        targets: '0, 1, 10',
        unit: 'mmol/L',
        targetUnit: 'nmol/L',
      },
    };
    const next = withPayload(blankWorkspace(), 'gradient', payload);

    expect(next.gradient).toEqual(payload.gradient);
    expect(capturePayload(next, 'gradient')).toEqual(payload);
  });
});

describe('switchSheet', () => {
  it('moves the current payload into store and the target payload onto the top level', () => {
    const { host, a, b } = rawMultiSheet();
    const patch = switchSheet(host, 'raw', 'raw-2');
    const wb = patch.workbooks?.raw;

    expect(wb?.activeId).toBe('raw-2');
    expect(ids(wb?.tabs ?? [])).toEqual(['raw', 'raw-2', 'raw-3']);
    expect(wb?.store.raw).toEqual(capturePayload(host, 'raw'));
    expect(wb?.store.raw).toEqual(a);
    expect(wb?.store['raw-2']).toBeUndefined();
    const next = { ...host, ...patch };
    expect(capturePayload(next, 'raw')).toEqual(b);
  });

  it('restores the previous sheet on switching back without polluting either payload', () => {
    const { host, a, b } = rawMultiSheet();
    const atB = { ...host, ...switchSheet(host, 'raw', 'raw-2') };
    const back = { ...atB, ...switchSheet(atB, 'raw', 'raw') };

    expect(workbookOf(back, 'raw').activeId).toBe('raw');
    expect(capturePayload(back, 'raw')).toEqual(a);
    expect(workbookOf(back, 'raw').store['raw-2']).toEqual(b);
    expect(workbookOf(back, 'raw').store.raw).toBeUndefined();
    expect(back.spectra).toEqual(a.spectra);
    // The invariant still holds after a round trip through the real update pipeline.
    expect(ensureWorkbooks(back).workbooks).toEqual(back.workbooks);
  });

  it('is a no-op for an unknown id or the already-active sheet', () => {
    const { host } = rawMultiSheet();
    expect(switchSheet(host, 'raw', 'ghost')).toEqual({});
    expect(switchSheet(host, 'raw', 'raw')).toEqual({});
    // A legacy workspace without a workbook still exposes its single fallback tab.
    expect(switchSheet(minimalHost(), 'raw', 'raw-2')).toEqual({});
  });

  it('switches a non-raw page and falls back to an empty payload when store is missing', () => {
    const base = ensureWorkbooks(blankWorkspace());
    const current: ScreeningSheetPayload = {
      objects: [objectRow('o-1', 'Blank')],
      blankId: 'o-1',
      screenMode: 'F',
    };
    const host: WorkbookHost = {
      ...withPayload(base, 'screening', current),
      workbooks: {
        ...base.workbooks,
        screening: {
          tabs: [
            { id: 'screening', name: '对象筛选' },
            { id: 'screening-2', name: 'Sheet 2' },
          ],
          activeId: 'screening',
          store: {},
        },
      },
    };
    const patch = switchSheet(host, 'screening', 'screening-2');
    expect(patch.workbooks?.screening?.store.screening).toEqual(current);
    const next = { ...host, ...patch };
    expect(next.objects).toEqual([]);
    expect(next.blankId).toBe('');
    expect(next.screenMode).toBe('ratio');
  });
});

describe('createSheet', () => {
  it('creates Sheet 2, activates it and parks the old data in store', () => {
    const base = withPayload(ensureWorkbooks(blankWorkspace()), 'raw', rawPayload('a', [['a1']], '400'));
    const patch = createSheet(base, 'raw');
    const wb = patch.workbooks?.raw;

    expect(wb?.tabs).toEqual([
      { id: 'raw', name: '原始光谱' },
      { id: 'raw-2', name: 'Sheet 2' },
    ]);
    expect(wb?.activeId).toBe('raw-2');
    expect(wb?.store.raw).toEqual(capturePayload(base, 'raw'));
    expect(wb?.store['raw-2']).toBeUndefined();

    const next = ensureWorkbooks({ ...base, ...patch });
    expect(workbookOf(next, 'raw').activeId).toBe('raw-2');
    expect(capturePayload(next, 'raw')).toEqual(defaultPayload('raw', next.calUnit));
    expect(next.rawSheet).toEqual(defaultRawSheet(next.calUnit));
    expect(next.spectra).toEqual([]);
  });

  it('skips sheet ids and names that are already taken', () => {
    const { host } = rawMultiSheet();
    const patch = createSheet(host, 'raw');
    const tabs = patch.workbooks?.raw?.tabs ?? [];
    expect(ids(tabs)).toEqual(['raw', 'raw-2', 'raw-3', 'raw-4']);
    expect(tabs[tabs.length - 1]).toEqual({ id: 'raw-4', name: 'Sheet 4' });
    expect(patch.workbooks?.raw?.activeId).toBe('raw-4');
  });

  it('creates the page-specific empty payload for non-raw pages', () => {
    const base = ensureWorkbooks(blankWorkspace());
    const patch = createSheet(base, 'screening');
    expect(patch.workbooks?.screening?.tabs).toEqual([
      { id: 'screening', name: DEFAULT_SHEET_NAMES.screening },
      { id: 'screening-2', name: 'Sheet 2' },
    ]);
    expect(capturePayload({ ...base, ...patch }, 'screening')).toEqual(
      defaultPayload('screening', base.calUnit),
    );
  });

  it('stops creating new sheets at MAX_SHEETS', () => {
    let host: WorkbookHost = ensureWorkbooks(blankWorkspace());
    for (let index = 2; index <= MAX_SHEETS; index++) {
      host = { ...host, ...createSheet(host, 'raw') };
    }
    expect(workbookOf(host, 'raw').tabs).toHaveLength(MAX_SHEETS);
    expect(workbookOf(host, 'raw').tabs[MAX_SHEETS - 1]).toEqual({
      id: `raw-${MAX_SHEETS}`,
      name: `Sheet ${MAX_SHEETS}`,
    });
    expect(workbookOf(host, 'raw').activeId).toBe(`raw-${MAX_SHEETS}`);

    expect(createSheet(host, 'raw')).toEqual({});
    expect(workbookOf(host, 'raw').tabs).toHaveLength(MAX_SHEETS);
  });
});

describe('renameSheet', () => {
  it('renames a non-legacy tab and leaves sheetNames untouched', () => {
    const { host } = rawMultiSheet();
    const atB = { ...host, ...switchSheet(host, 'raw', 'raw-2') };
    const patch = renameSheet(atB, 'raw', '实验组 A');

    expect(patch.workbooks?.raw?.tabs).toEqual([
      { id: 'raw', name: '原始光谱' },
      { id: 'raw-2', name: '实验组 A' },
      { id: 'raw-3', name: 'Sheet 3' },
    ]);
    expect(patch.sheetNames).toBeUndefined();
  });

  it('renames the legacy page tab and syncs sheetNames', () => {
    const { host } = rawMultiSheet();
    const patch = renameSheet(host, 'raw', '样品组');

    expect(patch.workbooks?.raw?.tabs[0]).toEqual({ id: 'raw', name: '样品组' });
    expect(patch.sheetNames).toEqual({ ...DEFAULT_SHEET_NAMES, raw: '样品组' });
    const next = ensureWorkbooks({ ...host, ...patch });
    expect(next.workbooks.raw.tabs[0].name).toBe('样品组');
    expect(next.sheetNames.raw).toBe('样品组');
  });

  it('rejects blank and over-long names, trims valid ones and ignores no-ops', () => {
    const { host } = rawMultiSheet();
    const atB = { ...host, ...switchSheet(host, 'raw', 'raw-2') };

    expect(renameSheet(atB, 'raw', '')).toEqual({});
    expect(renameSheet(atB, 'raw', '   ')).toEqual({});
    expect(renameSheet(atB, 'raw', '名'.repeat(41))).toEqual({});
    expect(renameSheet(atB, 'raw', 'Sheet 2')).toEqual({});

    const forty = renameSheet(atB, 'raw', '名'.repeat(40));
    expect(forty.workbooks?.raw?.tabs.find((tab) => tab.id === 'raw-2')?.name).toBe(
      '名'.repeat(40),
    );
    const trimmed = renameSheet(atB, 'raw', '  消解组  ');
    expect(trimmed.workbooks?.raw?.tabs.find((tab) => tab.id === 'raw-2')?.name).toBe('消解组');
  });
});

describe('deleteSheet', () => {
  it('refuses to delete the last sheet or an unknown id', () => {
    const single = ensureWorkbooks(blankWorkspace());
    expect(deleteSheet(single, 'raw', 'raw')).toEqual({});
    expect(deleteSheet(single, 'raw', 'ghost')).toEqual({});
    expect(deleteSheet(single, 'screening', 'screening')).toEqual({});
  });

  it('deleting a non-active sheet keeps the top-level data intact', () => {
    const { host, a, c } = rawMultiSheet();
    const patch = deleteSheet(host, 'raw', 'raw-2');

    expect(patch.workbooks?.raw).toEqual({
      tabs: [
        { id: 'raw', name: '原始光谱' },
        { id: 'raw-3', name: 'Sheet 3' },
      ],
      activeId: 'raw',
      store: { 'raw-3': c },
    });
    expect('rawSheet' in patch).toBe(false);
    expect('spectra' in patch).toBe(false);
    expect(patch.sheetNames).toEqual(host.sheetNames);
    expect(capturePayload({ ...host, ...patch }, 'raw')).toEqual(a);
  });

  it('deleting the active legacy tab activates its neighbour and restores its payload', () => {
    const { host, b, c } = rawMultiSheet();
    const patch = deleteSheet(host, 'raw', 'raw');

    expect(patch.workbooks?.raw).toEqual({
      tabs: [
        { id: 'raw-2', name: 'Sheet 2' },
        { id: 'raw-3', name: 'Sheet 3' },
      ],
      activeId: 'raw-2',
      store: { 'raw-3': c },
    });
    const expectedNames: Partial<Record<WorkbookId, string>> = { ...DEFAULT_SHEET_NAMES };
    delete expectedNames.raw;
    expect(patch.sheetNames).toEqual(expectedNames);
    expect(capturePayload({ ...host, ...patch }, 'raw')).toEqual(b);
  });

  it('deleting the active middle tab activates the right neighbour', () => {
    const { host, a, c } = rawMultiSheet();
    const atB = { ...host, ...switchSheet(host, 'raw', 'raw-2') };
    const patch = deleteSheet(atB, 'raw', 'raw-2');

    expect(ids(patch.workbooks?.raw?.tabs ?? [])).toEqual(['raw', 'raw-3']);
    expect(patch.workbooks?.raw?.activeId).toBe('raw-3');
    expect(patch.workbooks?.raw?.store.raw).toEqual(a);
    expect(capturePayload({ ...atB, ...patch }, 'raw')).toEqual(c);
  });

  it('deleting the active last tab activates the left neighbour', () => {
    const { host, b } = rawMultiSheet();
    const atC = { ...host, ...switchSheet(host, 'raw', 'raw-3') };
    const patch = deleteSheet(atC, 'raw', 'raw-3');

    expect(patch.workbooks?.raw?.activeId).toBe('raw-2');
    expect(ids(patch.workbooks?.raw?.tabs ?? [])).toEqual(['raw', 'raw-2']);
    expect(capturePayload({ ...atC, ...patch }, 'raw')).toEqual(b);
  });
});

describe('sheetSnapshots', () => {
  it('returns one snapshot per tab, with the active payload equal to the top level', () => {
    const { host, a, b, c } = rawMultiSheet();
    const snapshots = sheetSnapshots(host, 'raw');

    expect(snapshots).toHaveLength(3);
    expect(ids(snapshots.map((snapshot) => snapshot.tab))).toEqual(['raw', 'raw-2', 'raw-3']);
    expect(snapshots[0].payload).toEqual(a);
    expect(snapshots[0].payload).toEqual(capturePayload(host, 'raw'));
    expect(snapshots[1].payload).toEqual(b);
    expect(snapshots[2].payload).toEqual(c);
  });

  it('follows switching, creating and deleting sheets', () => {
    const base = withPayload(ensureWorkbooks(blankWorkspace()), 'raw', rawPayload('a', [['a1']], '400'));
    const created = { ...base, ...createSheet(base, 'raw') };

    const afterCreate = sheetSnapshots(created, 'raw');
    expect(afterCreate).toHaveLength(2);
    expect(afterCreate[0].payload).toEqual(capturePayload(base, 'raw'));
    expect(afterCreate[1].payload).toEqual(capturePayload(created, 'raw'));

    const afterDelete = sheetSnapshots({ ...created, ...deleteSheet(created, 'raw', 'raw-2') }, 'raw');
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0].payload).toEqual(capturePayload(base, 'raw'));
  });
});
