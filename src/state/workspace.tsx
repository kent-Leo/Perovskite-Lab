import { normalizeConcentrationUnit } from '../domain/math';
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import {
  defaultStyle,
  palette,
  uid,
  type Spectrum,
  type ObjectRow,
  type CalibrationRow,
  type ChartStyle,
  type ColumnMetadata,
  type ResponseMode,
} from '../domain/types';
import {
  DEFAULT_SHEET_NAMES,
  defaultPayload,
  defaultRawSheet,
  emptyWorkbooks,
  ensureWorkbooks,
  seedSheetChartTitles,
  type CalibrationSheetPayload,
  type GradientSheetPayload,
  type WorkbookHost,
} from '../domain/workbook';
export type WorksheetId = 'raw' | 'samples' | 'screening' | 'calibration' | 'gradient';
export interface Workspace extends WorkbookHost {
  // Column header metadata keyed by sheet id ('raw', 'screening', new sheet ids…).
  sheetMetadata?: Partial<Record<string, Record<string, ColumnMetadata>>>;
  version: 1;
  demo: boolean;
  spectra: Spectrum[];
  // Plot points come from the last confirmed raw table/import; sample rows supply metadata.
  rawSpectra?: Spectrum[];
  objects: ObjectRow[];
  calibration: CalibrationRow[];
  styles: Record<'spectra' | 'screening' | 'calibration', ChartStyle>;
  blankId: string;
  screenMode: ResponseMode;
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
export function demoWorkspace(): Workspace {
  const names = ['Blank', 'Sample A', 'Sample B', 'Sample C', 'Sample D', 'Sample E'];
  const concentrations = [0, 1, 2, 4, 6, 8];
  const spectra: Spectrum[] = names.map((name, i) => ({
    id: uid(),
    name,
    role: i === 0 ? 'blank' : 'target',
    concentration: String(concentrations[i]),
    unit: 'µmol/L',
    color: palette[i],
    visible: true,
    source: '人工生成示例',
    points: Array.from({ length: 161 }, (_, j) => ({
      x: 440 + j,
      y: Math.round(
        (12000 - 1050 * concentrations[i]) *
          Math.exp(-0.5 * ((440 + j - 516 - i * 0.25) / 10.4) ** 2) +
          30 +
          8 * Math.sin(j * 0.63 + i),
      ),
    })),
  }));
  const objects: ObjectRow[] = [
    'Blank',
    'Object A',
    'Object B',
    'Object C',
    'Object D',
    'Object E',
  ].map((name, i) => ({
    id: uid(),
    name,
    role: i === 0 ? 'blank' : i === 4 ? 'target' : 'interferent',
    concentration: i === 0 ? '0' : '10',
    unit: 'µmol/L',
    intensity: String([12000, 11750, 11350, 11000, 2800, 10850][i]),
    notes: '',
  }));
  return {
    version: 1,
    demo: true,
    spectra,
    rawSpectra: spectra,
    rawColumnSpectra: {},
    rawSheet: defaultRawSheet(),
    excitation: '450',
    objects,
    calibration: concentrations.map((c, i) => ({
      id: uid(),
      concentration: String(c),
      intensity: String([12000, 10920, 9940, 7780, 5730, 3580][i]),
      included: true,
    })),
    styles: {
      spectra: defaultStyle('spectra'),
      screening: defaultStyle('screening'),
      calibration: defaultStyle('calibration'),
    },
    blankId: objects[0].id,
    screenMode: 'ratio',
    calMode: 'quench',
    calUnit: 'µmol/L',
    calF0: '12000',
    blankRepeats: '11980, 12020, 11990, 12010, 12000',
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
    workbooks: emptyWorkbooks(),
    sheetNames: { ...DEFAULT_SHEET_NAMES },
    sheetMetadata: {},
  };
}
/** A blank workspace: every page keeps one empty sheet (v0.5.5 "新建空白工作区"). */
export function blankWorkspace(): Workspace {
  const calUnit = 'µmol/L';
  const cal = defaultPayload('calibration', calUnit) as CalibrationSheetPayload,
    gradient = defaultPayload('gradient', calUnit) as GradientSheetPayload;
  return {
    version: 1,
    demo: false,
    spectra: [],
    rawSpectra: [],
    rawColumnSpectra: {},
    rawSheet: defaultRawSheet(calUnit),
    excitation: '',
    objects: [],
    blankId: '',
    calibration: [],
    styles: {
      spectra: defaultStyle('spectra'),
      screening: defaultStyle('screening'),
      calibration: defaultStyle('calibration'),
    },
    screenMode: 'ratio',
    calMode: cal.calMode,
    calUnit: cal.calUnit,
    calF0: '',
    blankRepeats: '',
    manualSigma: '',
    sigmaSource: 'replicates',
    lodFactor: 3.3,
    fitMin: '',
    fitMax: '',
    gradient: gradient.gradient,
    workbooks: emptyWorkbooks(),
    sheetNames: { ...DEFAULT_SHEET_NAMES },
    sheetMetadata: {},
  };
}
export function normalizeWorkspaceUnits(w: Workspace): Workspace {
  const normalizeLabel = (label: string) => label.replace(
    /μmol\/L|\bmmol\/L|[μµu]M\b|\bnM\b|\bmM\b|[μu]g\/L/g,
    normalizeConcentrationUnit,
  );
  return {
    ...w,
    excitation: w.excitation ?? '',
    rawColumnSpectra: w.rawColumnSpectra ?? {},
    rawSheet: w.rawSheet
      ? {
          ...w.rawSheet,
          mapping: {
            ...w.rawSheet.mapping,
            unit: normalizeConcentrationUnit(w.rawSheet.mapping.unit),
          },
        }
      : w.rawSheet,
    spectra: w.spectra.map((s) => ({ ...s, unit: normalizeConcentrationUnit(s.unit) })),
    objects: w.objects.map((s) => ({ ...s, unit: normalizeConcentrationUnit(s.unit) })),
    calUnit: normalizeConcentrationUnit(w.calUnit),
    gradient: {
      ...w.gradient,
      unit: normalizeConcentrationUnit(w.gradient.unit),
      targetUnit: normalizeConcentrationUnit(w.gradient.targetUnit ?? w.gradient.unit),
    },
    styles: Object.fromEntries(Object.entries(w.styles).map(([key, style]) => [key, {
      ...style, xLabel: normalizeLabel(style.xLabel), yLabel: normalizeLabel(style.yLabel),
      axes: style.axes && Object.fromEntries(Object.entries(style.axes).map(([side, axis]) =>
        [side, { ...axis, label: normalizeLabel(axis.label ?? '') }],
      )),
    }])) as Workspace['styles'],
    sheetMetadata: w.sheetMetadata && Object.fromEntries(Object.entries(w.sheetMetadata).map(
      ([sheet, columns]) => [sheet, Object.fromEntries(Object.entries(columns ?? {}).map(
        ([key, metadata]) => [key, { ...metadata, ...(metadata.unit === undefined ? {} : {
          unit: normalizeConcentrationUnit(metadata.unit),
        }) }],
      ))],
    )),
  };
}
const CHART_STYLE_WORKBOOKS = [
  ['spectra', 'raw'],
  ['screening', 'screening'],
  ['calibration', 'calibration'],
] as const;
/**
 * Up to v0.5.5 the chart title was one shared `styles[kind].title`. From
 * v0.6.0 every sheet keeps its own title, so seed each sheet of a plotting
 * page with the previously shared title once and clear the legacy field.
 * Sheets that already carry their own title are never overwritten.
 */
function migrateSheetChartTitles(w: Workspace): Workspace {
  let changed = false,
    styles = w.styles;
  const workbooks = { ...(w.workbooks ?? {}) };
  for (const [kind, page] of CHART_STYLE_WORKBOOKS) {
    const legacy = w.styles?.[kind]?.title ?? '';
    const workbook = workbooks[page];
    if (!workbook) continue;
    const seeded = seedSheetChartTitles(workbook, legacy);
    if (!seeded) continue;
    workbooks[page] = seeded;
    styles = { ...styles, [kind]: { ...styles[kind], title: '' } };
    changed = true;
  }
  return changed ? { ...w, styles, workbooks } : w;
}
const KEY = 'perovskite-lab-workspace-v1';

/**
 * 项目文件 / 草稿读回来的工作区统一走一遍迁移：
 * 单位归一、补齐多 sheet 结构、把旧版共享图表标题灌到各 sheet。
 */
export function prepareWorkspace(w: Workspace): Workspace {
  return migrateSheetChartTitles(ensureWorkbooks(normalizeWorkspaceUnits(w)));
}

function load(storageKey: string): Workspace {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const w = JSON.parse(raw);
      if (
        w.version === 1 &&
        Array.isArray(w.spectra) &&
        Array.isArray(w.objects) &&
        Array.isArray(w.calibration) &&
        w.styles &&
        w.gradient
      )
        return prepareWorkspace(w);
    }
  } catch {
    /* recover corrupt storage */
  }
  return ensureWorkbooks(demoWorkspace());
}
type ContextValue = {
  w: Workspace;
  update: (patch: Partial<Workspace> | ((w: Workspace) => Partial<Workspace>)) => void;
  storageError: string;
  notice: string;
  notify: (s: string) => void;
  /** 当前工作区自上次保存项目文件以来是否有修改。 */
  dirty: boolean;
  /** 整体替换工作区（打开项目 / 新建项目 / 载入示例）。 */
  replaceWorkspace: (next: Workspace, options?: { dirty?: boolean; storageKey?: string }) => void;
  /** 保存成功后重置未保存标记。 */
  markSaved: () => void;
  /** 项目身份变化（另存为）后切换自动保存草稿的键。 */
  setStorageKey: (key: string) => void;
};
const Context = createContext<ContextValue | null>(null);
export function WorkspaceProvider({
  children,
  initialWorkspace,
  storageKey,
  initialDirty = false,
}: {
  children: ReactNode;
  /** 首帧使用的工作区；缺省时读取浏览器自动保存。 */
  initialWorkspace?: Workspace;
  /** 自动保存键；桌面端按项目身份区分，浏览器沿用旧键。 */
  storageKey?: string;
  initialDirty?: boolean;
}) {
  const keyRef = useRef(storageKey ?? KEY);
  const initialRef = useRef<Workspace | null>(null);
  if (!initialRef.current) initialRef.current = initialWorkspace ?? load(keyRef.current);
  // 已落盘（或从未修改）的工作区快照：与它相同就不必写草稿，避免覆盖/串用项目文件内容。
  const savedSnapshot = useRef<string | null>(
    initialWorkspace && !initialDirty ? JSON.stringify(initialRef.current) : null,
  );
  const wRef = useRef(initialRef.current);
  /** 保存 / 切换项目后作废尚未触发的草稿写入，避免刚保存又写回旧草稿。 */
  const writeGeneration = useRef(0);
  const [w, setW] = useState(() => initialRef.current!),
    [storageError, setStorageError] = useState(''),
    [dirty, setDirty] = useState(initialDirty),
    [notice, setNotice] = useState('');
  wRef.current = w;
  const update = useCallback(
    (patch: Partial<Workspace> | ((w: Workspace) => Partial<Workspace>)) => {
      setW((prev) =>
        ensureWorkbooks({
          ...prev,
          ...(typeof patch === 'function' ? patch(prev) : patch),
        }),
      );
      setDirty(true);
    },
    [],
  );
  const replaceWorkspace = useCallback<ContextValue['replaceWorkspace']>((next, options) => {
    if (options?.storageKey) keyRef.current = options.storageKey;
    writeGeneration.current += 1;
    const value = ensureWorkbooks(next);
    const nextDirty = options?.dirty ?? false;
    savedSnapshot.current = nextDirty ? null : JSON.stringify(value);
    setW(value);
    setDirty(nextDirty);
  }, []);
  const markSaved = useCallback(() => {
    savedSnapshot.current = JSON.stringify(wRef.current);
    writeGeneration.current += 1;
    setDirty(false);
  }, []);
  const setStorageKey = useCallback((key: string) => {
    keyRef.current = key;
  }, []);
  useEffect(() => {
    const text = JSON.stringify(w);
    // 没有未保存修改时不留草稿：正式项目文件才是内容的唯一来源。
    if (savedSnapshot.current === text) return;
    const generation = writeGeneration.current;
    const timer = window.setTimeout(() => {
      if (generation !== writeGeneration.current) return;
      try {
        localStorage.setItem(keyRef.current, text);
        setStorageError('');
      } catch {
        setStorageError('浏览器存储已满，本次修改仅保留在当前页面。请导出数据备份。');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [w]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(''), 7000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  return (
    <Context.Provider
      value={{
        w,
        update,
        storageError,
        notice,
        notify: setNotice,
        dirty,
        replaceWorkspace,
        markSaved,
        setStorageKey,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const c = useContext(Context);
  if (!c) throw new Error('Missing workspace provider');
  return c;
}
