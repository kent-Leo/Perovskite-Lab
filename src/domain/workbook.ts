import type {
  CalibrationRow,
  GradientSettings,
  ObjectRow,
  ResponseMode,
  SheetMapping,
  Spectrum,
  WorkbookId,
  WorkbookTab,
} from './types';

/**
 * Multi-sheet workbook model shared by the four table areas.
 *
 * Invariant: the active tab's payload lives in the workspace's top-level fields
 * (spectra/objects/calibration/gradient…); every other tab's payload lives in
 * `store`. Switching tabs captures the top-level fields into the old tab and
 * applies the target payload back to the top-level fields, so all existing page
 * components keep reading the same fields they always did.
 */
export const WORKBOOK_IDS: WorkbookId[] = ['raw', 'screening', 'calibration', 'gradient'];

export const WORKBOOK_LABELS: Record<WorkbookId, string> = {
  raw: '光谱工作台',
  screening: '对象筛选',
  calibration: '校准与检出限',
  gradient: '浓度梯度',
};

export const DEFAULT_SHEET_NAMES: Record<WorkbookId, string> = {
  raw: '原始光谱',
  screening: '分析对象',
  calibration: '校准数据',
  gradient: '梯度配液',
};

export const MAX_SHEETS = 20;

export interface RawSheetState {
  grid: string[][];
  mapping: SheetMapping;
}

export interface RawSheetPayload {
  grid: string[][];
  mapping: SheetMapping;
  spectra: Spectrum[];
  rawSpectra?: Spectrum[];
  rawColumnSpectra: Record<string, string>;
  excitation?: string;
}

export interface ScreeningSheetPayload {
  objects: ObjectRow[];
  blankId: string;
  screenMode: ResponseMode;
}

export interface CalibrationSheetPayload {
  calibration: CalibrationRow[];
  calMode: ResponseMode;
  calUnit: string;
  calF0: string;
  blankRepeats: string;
  manualSigma: string;
  sigmaSource: 'replicates' | 'manual';
  lodFactor: 3 | 3.3;
  fitMin: string;
  fitMax: string;
}

export interface GradientSheetPayload {
  gradient: GradientSettings;
}

export type SheetPayload =
  | RawSheetPayload
  | ScreeningSheetPayload
  | CalibrationSheetPayload
  | GradientSheetPayload;

export interface WorkbookState {
  tabs: WorkbookTab[];
  activeId: string;
  /** Payloads for inactive tabs; the active tab is stored in the top-level fields. */
  store: Record<string, SheetPayload>;
}

export type Workbooks = Record<WorkbookId, WorkbookState>;

/** Fields the workbook model reads from / writes to the workspace. */
export interface WorkbookHost {
  calUnit: string;
  excitation?: string;
  rawColumnSpectra?: Record<string, string>;
  rawSheet?: RawSheetState;
  rawSpectra?: Spectrum[];
  spectra: Spectrum[];
  objects: ObjectRow[];
  blankId: string;
  screenMode: ResponseMode;
  calibration: CalibrationRow[];
  calMode: ResponseMode;
  calF0: string;
  blankRepeats: string;
  manualSigma: string;
  sigmaSource: 'replicates' | 'manual';
  lodFactor: 3 | 3.3;
  fitMin: string;
  fitMax: string;
  gradient: GradientSettings;
  sheetNames?: Partial<Record<WorkbookId, string>>;
  workbooks?: Partial<Record<WorkbookId, WorkbookState>>;
}

export function blankGrid(rows = 6, columns = 3): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => ''));
}

export function defaultRawMapping(unit = 'µmol/L'): SheetMapping {
  return {
    kind: 'wide',
    start: 1,
    header: false,
    x: 0,
    ys: [1],
    name: 0,
    concentration: 0,
    unit,
  };
}

export function defaultRawSheet(unit = 'µmol/L'): RawSheetState {
  return { grid: blankGrid(), mapping: defaultRawMapping(unit) };
}

/** Empty payload for a freshly created sheet of the given page. */
export function defaultPayload(
  page: WorkbookId,
  unit = 'µmol/L',
): SheetPayload {
  switch (page) {
    case 'raw':
      return {
        grid: blankGrid(),
        mapping: defaultRawMapping(unit),
        spectra: [],
        rawColumnSpectra: {},
        excitation: '',
      };
    case 'screening':
      return { objects: [], blankId: '', screenMode: 'ratio' };
    case 'calibration':
      return {
        calibration: [],
        calMode: 'quench',
        calUnit: unit,
        calF0: '',
        blankRepeats: '',
        manualSigma: '',
        sigmaSource: 'replicates',
        lodFactor: 3.3,
        fitMin: '',
        fitMax: '',
      };
    case 'gradient':
      return {
        gradient: {
          stock: '100',
          volume: '10',
          fixed: '0',
          targets: '0, 0.1, 0.5, 1, 2, 5, 10',
          unit,
          targetUnit: unit,
        },
      };
  }
}

/** New sheets inherit the working unit of their page (gradient keeps its own unit). */
function defaultUnitFor(w: WorkbookHost, page: WorkbookId): string {
  return page === 'gradient' ? w.gradient.unit || w.calUnit : w.calUnit;
}

export function emptyWorkbook(page: WorkbookId, name = DEFAULT_SHEET_NAMES[page]): WorkbookState {
  return { tabs: [{ id: page, name }], activeId: page, store: {} };
}

export function emptyWorkbooks(
  names?: Partial<Record<WorkbookId, string>>,
): Workbooks {
  return Object.fromEntries(
    WORKBOOK_IDS.map((page) => [
      page,
      emptyWorkbook(page, names?.[page]?.trim() || DEFAULT_SHEET_NAMES[page]),
    ]),
  ) as Workbooks;
}

export function workbookOf(
  w: Pick<WorkbookHost, 'workbooks'>,
  page: WorkbookId,
): WorkbookState {
  return w.workbooks?.[page] ?? emptyWorkbook(page);
}

export function activeTabOf(
  w: Pick<WorkbookHost, 'workbooks'>,
  page: WorkbookId,
): WorkbookTab {
  const wb = workbookOf(w, page);
  return wb.tabs.find((tab) => tab.id === wb.activeId) ?? wb.tabs[0] ?? {
    id: page,
    name: DEFAULT_SHEET_NAMES[page],
  };
}

export function activeSheetIdOf(
  w: Pick<WorkbookHost, 'workbooks'>,
  page: WorkbookId,
): string {
  return activeTabOf(w, page).id;
}

function uniqueNames(tabs: WorkbookTab[], page: WorkbookId): WorkbookTab[] {
  const seen = new Set<string>();
  return tabs.map((tab, index) => {
    let name = tab.name.trim();
    if (!name || name.length > 40) name = DEFAULT_SHEET_NAMES[page];
    let candidate = name,
      suffix = 2;
    while (seen.has(candidate.toLowerCase())) candidate = `${name} (${suffix++})`;
    seen.add(candidate.toLowerCase());
    return { ...tab, id: tab.id, name: candidate };
  });
}

/** Longest accepted per-sheet chart title (characters). */
export const MAX_CHART_TITLE = 100;

/** Normalize a per-sheet chart title; blank means "use the page default title". */
function cleanChartTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, MAX_CHART_TITLE) : undefined;
}

/** One sheet's effective chart title: its own title, or the page default. */
export function sheetChartTitle(tab: WorkbookTab | undefined, fallback: string): string {
  return tab?.chartTitle?.trim() || fallback;
}

/** Store a chart title on the active sheet only; other sheets keep their own. */
export function setActiveSheetChartTitle(
  w: WorkbookHost,
  page: WorkbookId,
  title: string,
): Partial<WorkbookHost> {
  const clean = cleanChartTitle(title);
  const wb = workbookOf(w, page);
  const tabs = wb.tabs.map((tab) =>
    tab.id === wb.activeId ? { ...tab, chartTitle: clean } : tab,
  );
  if (tabs.every((tab, index) => tab.chartTitle === wb.tabs[index].chartTitle)) return {};
  return { workbooks: workbooksWith(w, page, { ...wb, tabs }) };
}

/**
 * Seed a legacy page-shared chart title onto every sheet that has no title yet.
 * Returns null when the workbook already carries per-sheet titles (or the
 * legacy title is blank), so callers can keep the old object untouched.
 */
export function seedSheetChartTitles(
  workbook: WorkbookState,
  legacyTitle: string,
): WorkbookState | null {
  const legacy = cleanChartTitle(legacyTitle);
  if (!legacy) return null;
  let changed = false;
  const tabs = workbook.tabs.map((tab) => {
    if (tab.chartTitle?.trim()) return tab;
    changed = true;
    return { ...tab, chartTitle: legacy };
  });
  return changed ? { ...workbook, tabs } : null;
}

function repairTabs(
  input: unknown,
  page: WorkbookId,
  defaultName: string,
): WorkbookTab[] {
  const tabs: WorkbookTab[] = [];
  const ids = new Set<string>();
  if (Array.isArray(input)) {
    for (const value of input) {
      if (!value || typeof value !== 'object') continue;
      const raw = value as { id?: unknown; name?: unknown; chartTitle?: unknown };
      if (typeof raw.id !== 'string' || !raw.id.trim() || ids.has(raw.id)) continue;
      ids.add(raw.id);
      const chartTitle = cleanChartTitle(raw.chartTitle);
      tabs.push({
        id: raw.id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : defaultName,
        ...(chartTitle ? { chartTitle } : {}),
      });
      if (tabs.length >= MAX_SHEETS) break;
    }
  }
  if (!tabs.length) tabs.push({ id: page, name: defaultName });
  return uniqueNames(tabs, page);
}

function repairWorkbook(
  existing: WorkbookState | undefined,
  page: WorkbookId,
  defaultName: string,
  unit: string,
): WorkbookState {
  const tabs = repairTabs(existing?.tabs, page, defaultName);
  const ids = new Set(tabs.map((tab) => tab.id));
  const activeId =
    typeof existing?.activeId === 'string' && ids.has(existing.activeId)
      ? existing.activeId
      : tabs[0].id;
  const fallback = defaultPayload(page, unit);
  const store: Record<string, SheetPayload> = {};
  if (existing?.store && typeof existing.store === 'object') {
    for (const [id, payload] of Object.entries(existing.store)) {
      // The active payload always lives in the top-level fields; avoid a stale copy.
      if (!ids.has(id) || id === activeId || !payload || typeof payload !== 'object') continue;
      store[id] = payload;
    }
  }
  for (const tab of tabs)
    if (tab.id !== activeId && !store[tab.id]) store[tab.id] = fallback;
  return { tabs, activeId, store };
}

function normalizeRawMapping(
  mapping: SheetMapping,
  unit: string,
): SheetMapping {
  const ys = mapping.ys;
  const valid =
    !!mapping &&
    typeof mapping.header === 'boolean' &&
    Number.isInteger(mapping.start) &&
    mapping.start >= 1 &&
    Number.isInteger(mapping.x) &&
    mapping.x >= 0 &&
    Array.isArray(ys) &&
    ys.every((column) => Number.isInteger(column) && column >= 0) &&
    ys.every((column, index) => index === 0 || column > ys[index - 1]) &&
    typeof mapping.unit === 'string' &&
    mapping.unit.length > 0;
  if (valid) return mapping;
  return {
    ...defaultRawMapping(unit),
    ...mapping,
    header: !!mapping?.header,
    start: Number.isInteger(mapping?.start) && mapping.start >= 1 ? mapping.start : 1,
    x: Number.isInteger(mapping?.x) && mapping.x >= 0 ? mapping.x : 0,
    ys: Array.isArray(ys)
      ? [...new Set(ys.filter((column) => Number.isInteger(column) && column >= 0))].sort(
          (a, b) => a - b,
        )
      : [1],
    unit: typeof mapping?.unit === 'string' && mapping.unit ? mapping.unit : unit,
  };
}

/**
 * Keep the active raw draft valid. Hot path: an already-valid sheet is returned
 * as-is so typing in a large table does not copy every row on each keystroke.
 */
function normalizeRawSheet(
  input: RawSheetState | undefined,
  unit: string,
): RawSheetState {
  if (
    !input ||
    !Array.isArray(input.grid) ||
    !input.mapping ||
    !Array.isArray(input.mapping.ys)
  )
    return defaultRawSheet(unit);
  const gridOk =
    input.grid.length >= 6 &&
    input.grid.every(
      (row) =>
        Array.isArray(row) &&
        row.length >= 3 &&
        row.every((value) => typeof value === 'string'),
    );
  const mapping = normalizeRawMapping(input.mapping, unit);
  if (gridOk && mapping === input.mapping) return input;
  let grid = input.grid;
  if (!gridOk) {
    const source = input.grid.map((row) =>
      Array.isArray(row) ? row.map((value) => String(value ?? '')) : [],
    );
    const width = Math.max(3, ...source.map((row) => row.length));
    const height = Math.max(6, source.length);
    grid = Array.from({ length: height }, (_, row) =>
      Array.from({ length: width }, (_, column) => source[row]?.[column] ?? ''),
    );
  }
  return { grid, mapping };
}

/**
 * Normalize / migrate a workspace so every page has a valid multi-sheet
 * workbook. Supports workspaces saved by v0.4.5 and earlier (no workbooks,
 * no raw worksheet draft).
 */
export function ensureWorkbooks<T extends WorkbookHost>(
  w: T,
): T & {
  rawSheet: RawSheetState;
  workbooks: Workbooks;
  sheetNames: Partial<Record<WorkbookId, string>>;
} {
  const workbooks = {} as Workbooks;
  const sheetNames: Partial<Record<WorkbookId, string>> = {};
  for (const page of WORKBOOK_IDS) {
    const legacyName =
      w.sheetNames?.[page]?.trim() || DEFAULT_SHEET_NAMES[page];
    const workbook = repairWorkbook(
      w.workbooks?.[page],
      page,
      legacyName,
      defaultUnitFor(w, page),
    );
    workbooks[page] = workbook;
    const legacyTab = workbook.tabs.find((tab) => tab.id === page);
    if (legacyTab) sheetNames[page] = legacyTab.name;
  }
  return {
    ...w,
    rawSheet: normalizeRawSheet(w.rawSheet, w.calUnit),
    workbooks,
    sheetNames,
  };
}

/** Read the active tab's data out of the top-level workspace fields. */
export function capturePayload(w: WorkbookHost, page: WorkbookId): SheetPayload {
  switch (page) {
    case 'raw':
      return {
        grid: w.rawSheet?.grid ?? blankGrid(),
        mapping: w.rawSheet?.mapping ?? defaultRawMapping(w.calUnit),
        spectra: w.spectra,
        rawSpectra: w.rawSpectra,
        rawColumnSpectra: w.rawColumnSpectra ?? {},
        excitation: w.excitation ?? '',
      };
    case 'screening':
      return { objects: w.objects, blankId: w.blankId, screenMode: w.screenMode };
    case 'calibration':
      return {
        calibration: w.calibration,
        calMode: w.calMode,
        calUnit: w.calUnit,
        calF0: w.calF0,
        blankRepeats: w.blankRepeats,
        manualSigma: w.manualSigma,
        sigmaSource: w.sigmaSource,
        lodFactor: w.lodFactor,
        fitMin: w.fitMin,
        fitMax: w.fitMax,
      };
    case 'gradient':
      return { gradient: w.gradient };
  }
}

/** Patch that makes a stored payload the active data of the page. */
export function applyPayload(
  w: WorkbookHost,
  page: WorkbookId,
  payload: SheetPayload,
): Partial<WorkbookHost> {
  switch (page) {
    case 'raw': {
      const raw = payload as RawSheetPayload;
      return {
        rawSheet: { grid: raw.grid, mapping: raw.mapping },
        spectra: raw.spectra ?? [],
        rawSpectra: raw.rawSpectra,
        rawColumnSpectra: raw.rawColumnSpectra ?? {},
        excitation: raw.excitation ?? '',
      };
    }
    case 'screening': {
      const rows = payload as ScreeningSheetPayload;
      return { objects: rows.objects, blankId: rows.blankId, screenMode: rows.screenMode };
    }
    case 'calibration': {
      const cal = payload as CalibrationSheetPayload;
      return {
        calibration: cal.calibration,
        calMode: cal.calMode,
        calUnit: cal.calUnit,
        calF0: cal.calF0,
        blankRepeats: cal.blankRepeats,
        manualSigma: cal.manualSigma,
        sigmaSource: cal.sigmaSource,
        lodFactor: cal.lodFactor,
        fitMin: cal.fitMin,
        fitMax: cal.fitMax,
      };
    }
    case 'gradient':
      return { gradient: (payload as GradientSheetPayload).gradient };
  }
}

function workbooksWith(
  w: WorkbookHost,
  page: WorkbookId,
  workbook: WorkbookState,
): Partial<Record<WorkbookId, WorkbookState>> {
  return { ...(w.workbooks ?? {}), [page]: workbook };
}

/** Switch the active sheet of one page, moving payloads between top-level fields and store. */
export function switchSheet(
  w: WorkbookHost,
  page: WorkbookId,
  targetId: string,
): Partial<WorkbookHost> {
  const wb = workbookOf(w, page);
  if (targetId === wb.activeId || !wb.tabs.some((tab) => tab.id === targetId)) return {};
  const payload = wb.store[targetId] ?? defaultPayload(page, defaultUnitFor(w, page));
  const store = { ...wb.store };
  delete store[targetId];
  if (wb.tabs.some((tab) => tab.id === wb.activeId)) {
    store[wb.activeId] = capturePayload(w, page);
  }
  return {
    workbooks: workbooksWith(w, page, { tabs: wb.tabs, activeId: targetId, store }),
    ...applyPayload(w, page, payload),
  };
}

function nextSheetIdentity(
  wb: WorkbookState,
  page: WorkbookId,
): { id: string; name: string } {
  const ids = new Set(wb.tabs.map((tab) => tab.id));
  const names = new Set(wb.tabs.map((tab) => tab.name.trim().toLowerCase()));
  for (let index = 2; index <= MAX_SHEETS + 2; index++) {
    const id = `${page}-${index}`,
      name = `Sheet ${index}`;
    if (!ids.has(id) && !names.has(name.toLowerCase())) return { id, name };
  }
  return { id: `${page}-${Date.now().toString(36)}`, name: `Sheet ${Date.now().toString(36)}` };
}

/** Empty payload for a new sheet; calibration inherits the current method settings. */
function newSheetPayload(w: WorkbookHost, page: WorkbookId): SheetPayload {
  const payload = defaultPayload(page, defaultUnitFor(w, page));
  if (page === 'calibration')
    return {
      ...(payload as CalibrationSheetPayload),
      calMode: w.calMode,
      calUnit: w.calUnit,
      calF0: w.calF0,
      blankRepeats: w.blankRepeats,
      manualSigma: w.manualSigma,
      sigmaSource: w.sigmaSource,
      lodFactor: w.lodFactor,
      fitMin: '',
      fitMax: '',
    };
  return payload;
}

/** Create a blank sheet for the page and switch to it. */
export function createSheet(
  w: WorkbookHost,
  page: WorkbookId,
): Partial<WorkbookHost> {
  const wb = workbookOf(w, page);
  if (wb.tabs.length >= MAX_SHEETS) return {};
  const tab = nextSheetIdentity(wb, page);
  const staged: WorkbookHost = {
    ...w,
    workbooks: workbooksWith(w, page, {
      tabs: [...wb.tabs, tab],
      activeId: wb.activeId,
      store: { ...wb.store, [tab.id]: newSheetPayload(w, page) },
    }),
  };
  return switchSheet(staged, page, tab.id);
}

/** Rename the active sheet; the legacy sheetNames entry follows the original tab. */
export function renameSheet(
  w: WorkbookHost,
  page: WorkbookId,
  name: string,
): Partial<WorkbookHost> {
  const clean = name.trim();
  const wb = workbookOf(w, page);
  if (!clean || clean.length > 40) return {};
  if (wb.tabs.find((tab) => tab.id === wb.activeId)?.name === clean) return {};
  const tabs = wb.tabs.map((tab) =>
    tab.id === wb.activeId ? { ...tab, name: clean } : tab,
  );
  const patch: Partial<WorkbookHost> = {
    workbooks: workbooksWith(w, page, { ...wb, tabs }),
  };
  if (wb.activeId === page)
    patch.sheetNames = { ...(w.sheetNames ?? {}), [page]: clean };
  return patch;
}

/** Delete a sheet; deleting the active one activates its neighbour. */
export function deleteSheet(
  w: WorkbookHost,
  page: WorkbookId,
  id: string,
): Partial<WorkbookHost> {
  const wb = workbookOf(w, page);
  if (wb.tabs.length <= 1 || !wb.tabs.some((tab) => tab.id === id)) return {};
  const index = wb.tabs.findIndex((tab) => tab.id === id);
  const tabs = wb.tabs.filter((tab) => tab.id !== id);
  const store = { ...wb.store };
  delete store[id];
  const sheetNames = { ...(w.sheetNames ?? {}) };
  if (id === page) delete sheetNames[page];
  if (id !== wb.activeId) {
    return {
      workbooks: workbooksWith(w, page, { tabs, activeId: wb.activeId, store }),
      sheetNames,
    };
  }
  const nextTab = tabs[Math.min(index, tabs.length - 1)];
  const payload = store[nextTab.id] ?? defaultPayload(page, defaultUnitFor(w, page));
  delete store[nextTab.id];
  return {
    workbooks: workbooksWith(w, page, { tabs, activeId: nextTab.id, store }),
    sheetNames,
    ...applyPayload(w, page, payload),
  };
}

export interface SheetSnapshot {
  tab: WorkbookTab;
  payload: SheetPayload;
}

/** Payload of every tab, including the active one (used by the all-sheets gallery). */
export function sheetSnapshots(w: WorkbookHost, page: WorkbookId): SheetSnapshot[] {
  const wb = workbookOf(w, page);
  return wb.tabs.map((tab) => ({
    tab,
    payload:
      tab.id === wb.activeId
        ? capturePayload(w, page)
        : (wb.store[tab.id] ?? defaultPayload(page, defaultUnitFor(w, page))),
  }));
}
