import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  defaultStyle,
  palette,
  uid,
  type Spectrum,
  type ObjectRow,
  type CalibrationRow,
  type ChartStyle,
  type ResponseMode,
} from '../domain/types';
export type WorksheetId = 'raw' | 'samples' | 'screening' | 'calibration' | 'gradient';
export type ColumnMetadata = Partial<Record<'title' | 'unit' | 'comment', string>>;
export interface Workspace {
  sheetMetadata?: Partial<Record<WorksheetId, Record<string, ColumnMetadata>>>;
  sheetNames?: Partial<Record<WorksheetId, string>>;
  version: 1;
  demo: boolean;
  spectra: Spectrum[];
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
  gradient: { stock: string; volume: string; fixed: string; targets: string; unit: string };
}
export function demoWorkspace(): Workspace {
  const names = ['Blank', 'Sample A', 'Sample B', 'Sample C', 'Sample D', 'Sample E'];
  const concentrations = [0, 1, 2, 4, 6, 8];
  const spectra: Spectrum[] = names.map((name, i) => ({
    id: uid(),
    name,
    role: i === 0 ? 'blank' : 'target',
    concentration: String(concentrations[i]),
    unit: 'μM',
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
    unit: 'μM',
    intensity: String([12000, 11750, 11350, 11000, 2800, 10850][i]),
    notes: '',
  }));
  return {
    version: 1,
    demo: true,
    spectra,
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
    calUnit: 'μM',
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
      unit: 'μM',
    },
  };
}
const KEY = 'perovskite-lab-workspace-v1';
function load(): Workspace {
  try {
    const raw = localStorage.getItem(KEY);
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
        return w;
    }
  } catch {
    /* recover corrupt storage */
  }
  return demoWorkspace();
}
type ContextValue = {
  w: Workspace;
  update: (patch: Partial<Workspace> | ((w: Workspace) => Partial<Workspace>)) => void;
  storageError: string;
  notice: string;
  notify: (s: string) => void;
};
const Context = createContext<ContextValue | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [w, setW] = useState(load),
    [storageError, setStorageError] = useState(''),
    [notice, setNotice] = useState('');
  const update = useCallback(
    (patch: Partial<Workspace> | ((w: Workspace) => Partial<Workspace>)) => {
      setW((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
    },
    [],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(w));
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
