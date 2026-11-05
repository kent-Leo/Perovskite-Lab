import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardPaste, Plus, ArrowDownToLine, Trash2 } from 'lucide-react';
import { useWorkspace } from '../state/workspace';
import { useSheetHistory } from '../state/useSheetHistory-2026.11.5';
import { useWorkbook } from '../state/useWorkbook';
import { palette, type ColumnMetadata, type Spectrum } from '../domain/types';
import { blankGrid, defaultRawMapping, defaultRawSheet } from '../domain/workbook';
import {
  deleteRawSheetColumns,
  deleteRawSheetRows,
  insertRawSheetColumns,
  insertRawSheetRows,
} from '../domain/raw-sheet-edit';
import {
  structureAxis,
  structureCount,
  structureStart,
  STRUCTURE_LIMITS,
  type WorksheetStructureAction,
} from '../domain/worksheet-structure-2026.11.5';
import {
  rawColumnIndex,
  rawColumnKey,
  rawIntensityColumns,
  rawSpectrumColor,
  syncRawMapping,
} from '../domain/raw-spectra';
import type { Mapping } from '../services/import';
import { dateStamp } from '../services/download';
import {
  growPasteGrid,
  pasteIntoGrid,
  pastedSpectrumIssues,
  preparePastedSpectra,
  suggestPasteMapping,
  trimPasteGrid,
} from '../services/paste-2026.10.18';
import { ErrorNote, Field } from './ui';
import { WorkspaceWorksheet as Worksheet } from './WorkspaceWorksheet-v0.3.1-2026.10.19';
import { pasteWorksheetRange, type WorksheetColumn } from '../domain/worksheet-v0.2.0-2026.10.19';

type RawHistory = {
  rawSheet: { grid: string[][]; mapping: Mapping };
  metadata: Record<string, ColumnMetadata>;
  columnSpectra: Record<string, string>;
  spectra: Spectrum[];
  rawSpectra: Spectrum[];
};

export function PasteSpectraTable() {
  const { w, update, notify } = useWorkspace();
  const wb = useWorkbook('raw');
  const [error, setError] = useState(''),
    [plotted, setPlotted] = useState(false);
  const batch = useRef(new Map<number, string>());
  const source = `粘贴光谱-${dateStamp()}`;
  // 整表撤销 / 重做：单元格编辑、行列结构、绘图与列设置共用一条历史。
  const history = useSheetHistory<RawHistory>(
    wb.activeId,
    () => {
      const current = w.rawSheet ?? defaultRawSheet(w.calUnit);
      return {
        rawSheet: {
          grid: current.grid.map((row) => [...row]),
          mapping: { ...current.mapping, ys: [...current.mapping.ys], meta: [...(current.mapping.meta ?? [])] },
        },
        metadata: Object.fromEntries(
          Object.entries(w.sheetMetadata?.[wb.activeId] ?? {}).map(([key, value]) => [key, { ...value }]),
        ),
        columnSpectra: { ...(w.rawColumnSpectra ?? {}) },
        spectra: w.spectra.map((spectrum) => ({ ...spectrum })),
        rawSpectra: (w.rawSpectra ?? []).map((spectrum) => ({ ...spectrum })),
      };
    },
    (snapshot) =>
      update((prev) => ({
        rawSheet: snapshot.rawSheet,
        rawColumnSpectra: snapshot.columnSpectra,
        sheetMetadata: { ...prev.sheetMetadata, [wb.activeId]: snapshot.metadata },
        spectra: snapshot.spectra,
        rawSpectra: snapshot.rawSpectra,
      })),
  );
  const externalHistory = {
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: history.undo,
    redo: history.redo,
  };
  // The draft grid/mapping of the active sheet live in the workspace (w.rawSheet),
  // so editing a sheet and switching sheets persist the table as-is.
  const sheet = useMemo(
    () => w.rawSheet ?? defaultRawSheet(w.calUnit),
    [w.rawSheet, w.calUnit],
  );
  const grid = sheet.grid,
    mapping: Mapping = sheet.mapping;
  const rows = useMemo(() => trimPasteGrid(grid), [grid]);
  const invalidCells = useMemo(() => new Set(
    pastedSpectrumIssues(grid, mapping).map(({ row, column }) => `${row}:${column}`),
  ), [grid, mapping]);
  const columns = Array.from({ length: grid[0]?.length ?? 0 }, (_, i) => i);
  const rawMetadata = w.sheetMetadata?.[wb.activeId] ?? {};
  const metaAt = (column: number): ColumnMetadata => rawMetadata[rawColumnKey(column)] ?? {};
  // Stable per-column default so colors do not jump when intensity columns change.
  const colorAt = (column: number) =>
    metaAt(column).color?.trim() || palette[column % palette.length];
  const defaultTitle = (column: number) => {
    if (column === mapping.x) return '波长';
    const label = mapping.header
      ? String(grid[mapping.start - 1]?.[column] ?? '').trim()
      : '';
    return label || `光谱 ${column + 1}`;
  };
  const result = useMemo(() => {
    if (!rows.length) return { value: null, error: '' };
    try {
      return { value: preparePastedSpectra(rows, mapping, source), error: '' };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  }, [rows, mapping, source]);
  // Switching sheets abandons the in-memory batch and per-sheet plot feedback.
  useEffect(() => {
    batch.current = new Map();
    setPlotted(false);
    setError('');
  }, [wb.activeId]);
  function patchSheet(changes: { grid?: string[][]; mapping?: Mapping }) {
    update((prev) => {
      const current = prev.rawSheet ?? defaultRawSheet(prev.calUnit);
      return {
        rawSheet: {
          grid: changes.grid ?? current.grid,
          mapping: changes.mapping ?? current.mapping,
        },
      };
    });
  }
  /**
   * Keep plotted spectra in step with the raw table: the visible curves are the
   * columns currently marked as intensity columns.
   */
  function updateMapping(next: Mapping, nextGrid?: string[][]) {
    update((prev) => ({
      rawSheet: {
        grid: nextGrid ?? prev.rawSheet?.grid ?? blankGrid(),
        mapping: next,
      },
      spectra: prev.spectra.map((sample) => {
        const entry = Object.entries(prev.rawColumnSpectra ?? {}).find(
          ([, id]) => id === sample.id,
        );
        if (!entry) return sample;
        const column = rawColumnIndex(entry[0]);
        return column === null ? sample : { ...sample, visible: next.ys.includes(column) };
      }),
    }));
  }
  const patch = (changes: Partial<Mapping>) => {
    history.record();
    updateMapping({ ...mapping, ...changes });
    setError('');
  };
  function setWavelengthColumn(x: number) {
    const meta = new Set(mapping.meta ?? []);
    meta.add(mapping.x);
    meta.delete(x);
    const next = { ...mapping, x, meta: [...meta].sort((a, b) => a - b) };
    patch({ x, meta: next.meta, ys: rawIntensityColumns(grid, next) });
  }
  function setIntensityColumn(column: number, checked: boolean) {
    const meta = new Set(mapping.meta ?? []);
    if (checked) meta.delete(column);
    else meta.add(column);
    const next = { ...mapping, meta: [...meta].sort((a, b) => a - b) };
    patch({ meta: next.meta, ys: rawIntensityColumns(grid, next) });
  }
  function setColor(column: number, color: string) {
    const sheetId = wb.activeId;
    history.record();
    update((prev) => {
      const key = rawColumnKey(column),
        id = prev.rawColumnSpectra?.[key];
      return {
        sheetMetadata: {
          ...prev.sheetMetadata,
          [sheetId]: {
            ...prev.sheetMetadata?.[sheetId],
            [key]: { ...prev.sheetMetadata?.[sheetId]?.[key], color },
          },
        },
        spectra: id
          ? prev.spectra.map((sample) => (sample.id === id ? { ...sample, color } : sample))
          : prev.spectra,
      };
    });
  }
  /**
   * 行列结构操作：插入 / 追加 / 删除都会同步平移波长列、强度列、列头元数据与
   * 列→光谱映射；删除强度列时一并移除对应光谱。
   */
  function structure(action: WorksheetStructureAction) {
    const sheetId = wb.activeId;
    const width = grid[0]?.length ?? 3;
    const start = action.type.startsWith('append') ? -1 : structureStart(action);
    const count = structureCount(action.count);
    try {
      if (structureAxis(action) === 'row') {
        const at = action.type === 'append-row' ? grid.length : start;
        const next =
          action.type === 'delete-row'
            ? deleteRawSheetRows(sheet, at, count)
            : insertRawSheetRows(sheet, at, count);
        history.record();
        update({ rawSheet: next });
        setError('');
        return;
      }
      // 列号会变化，缓存的列→光谱 id 立即失效。
      batch.current = new Map();
      if (action.type === 'delete-column') {
        const result = deleteRawSheetColumns(
          sheet,
          w.sheetMetadata?.[sheetId],
          w.rawColumnSpectra,
          start,
          count,
        );
        const removed = new Set(
          result.removedColumns
            .map((column) => w.rawColumnSpectra?.[rawColumnKey(column)])
            .filter((id): id is string => !!id),
        );
        history.record();
        update((prev) => ({
          rawSheet: result.rawSheet,
          rawColumnSpectra: result.columnSpectra,
          sheetMetadata: { ...prev.sheetMetadata, [sheetId]: result.metadata },
          spectra: prev.spectra.filter((sample) => !removed.has(sample.id)),
          rawSpectra: (prev.rawSpectra ?? []).filter((sample) => !removed.has(sample.id)),
        }));
      } else {
        const result = insertRawSheetColumns(
          sheet,
          w.sheetMetadata?.[sheetId],
          w.rawColumnSpectra,
          action.type === 'append-column' ? width : start,
          count,
        );
        history.record();
        update((prev) => ({
          rawSheet: result.rawSheet,
          rawColumnSpectra: result.columnSpectra,
          sheetMetadata: { ...prev.sheetMetadata, [sheetId]: result.metadata },
        }));
      }
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  /** 结构操作的可执行性：波长列、最后一列与列数上限受保护。 */
  const canStructure = (action: WorksheetStructureAction) => {
    if (structureAxis(action) === 'row') return null;
    const width = grid[0]?.length ?? 3;
    const start = structureStart(action);
    const count = structureCount(action.count);
    if (action.type === 'delete-column') {
      if (start <= mapping.x && mapping.x < start + count)
        return '波长列是绘图的必需列，不能删除；请先改用其他列作为波长列';
      if (start + count > width) return '删除范围超出表格末列';
      if (width - count < 1) return '工作表至少保留一列';
      return null;
    }
    if (width + count > STRUCTURE_LIMITS.columns)
      return `原始光谱表最多 ${STRUCTURE_LIMITS.columns} 列`;
    return null;
  };
  function grow(extraRows: number, extraColumns: number) {
    try {
      const nextGrid = growPasteGrid(
        grid,
        grid.length + extraRows,
        (grid[0]?.length ?? 3) + extraColumns,
      );
      history.record();
      updateMapping(syncRawMapping(nextGrid, mapping), nextGrid);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function plot() {
    if (!result.value) return;
    history.record();
    const r = result.value;
    const nextBatch = new Map(batch.current);
    const metadata = w.sheetMetadata?.[wb.activeId] ?? {};
    const spectra = r.spectra.map((s, i) => {
      const col = r.columns[i],
        key = rawColumnKey(col),
        // Reuse the persisted mapping after a reload so replotting updates rather than duplicates.
        previousId = batch.current.get(col) ?? w.rawColumnSpectra?.[key],
        previous = w.spectra.find((old) => old.id === previousId);
      const next = {
        ...(previous ?? s),
        // Store the name visible in the raw table; legend display still prefers 备注/名称.
        name: defaultTitle(col),
        color: rawSpectrumColor(metadata[key], colorAt(col)),
        points: s.points,
        source: s.source,
        visible: mapping.ys.includes(col),
      };
      nextBatch.set(col, next.id);
      return next;
    });
    const columnSpectra = { ...(w.rawColumnSpectra ?? {}) };
    nextBatch.forEach((id, column) => {
      columnSpectra[rawColumnKey(column)] = id;
    });
    update((prev) => {
      const replacements = new Map(spectra.map((s) => [s.id, s]));
      const existing = new Set(prev.spectra.map((s) => s.id));
      return {
        // Multi-sheet plot patches only touch this sheet's spectrum payload; the
        // other pages (objects/calibration/gradient) are left untouched.
        demo: false,
        spectra: prev.demo
          ? spectra
          : [
              ...prev.spectra.map((s) => replacements.get(s.id) ?? s),
              ...spectra.filter((s) => !existing.has(s.id)),
            ],
        rawSpectra: r.spectra.map((s, i) => ({ ...s, id: spectra[i].id })),
        rawColumnSpectra: { ...(prev.rawColumnSpectra ?? {}), ...columnSpectra },
        rawSheet: { grid, mapping },
      };
    });
    batch.current = nextBatch;
    setPlotted(true);
    notify(`已根据表格绘制 ${spectra.length} 条光谱`);
    requestAnimationFrame(() =>
      document.querySelector('[data-testid="spectra-chart"]')?.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      }),
    );
  }
  const worksheetColumns: WorksheetColumn[] = columns.map((col) => ({
    key: rawColumnKey(col),
    title: defaultTitle(col),
    designation: col === mapping.x ? 'X' : mapping.ys.includes(col) ? 'Y' : 'Meta',
    unit: col === mapping.x ? 'nm' : 'a.u.',
    type: 'text',
  }));
  return (
    <section className="paste-panel" aria-labelledby="paste-title">
      <div className="paste-heading">
        <div>
          <h2 id="paste-title">
            <ClipboardPaste size={19} /> 粘贴原始光谱数据
          </h2>
          <p id="paste-hint">
            从 Excel 复制整块数据，点击单元格后按 ⌘V / Ctrl+V；支持制表符、CSV
            和逐格输入。默认第一列为波长，其余列为强度。列的名称、单位、备注和颜色即图例来源。
          </p>
        </div>
        <button
          className="small-button"
          disabled={!rows.length}
          onClick={() => {
            // Only the current sheet draft is cleared; plotted spectra stay.
            history.record();
            update((prev) => ({ rawSheet: defaultRawSheet(prev.calUnit) }));
            setError('');
            setPlotted(false);
            batch.current = new Map();
          }}
          title="只清空输入草稿，保留已经绘制的光谱"
        >
          <Trash2 size={14} /> 清空表格
        </button>
      </div>
      <div className="paste-options">
        <Field label="粘贴数据起始行">
          <input
            type="number"
            min={1}
            max={grid.length}
            value={mapping.start}
            onChange={(e) => patch({ start: Number(e.target.value) })}
          />
        </Field>
        <label className="check-line">
          <input
            type="checkbox"
            checked={mapping.header}
            onChange={(e) => patch({ header: e.target.checked })}
          />
          起始行包含列名
        </label>
        <Field label="粘贴数据波长列">
          <select
            value={mapping.x}
            onChange={(e) => setWavelengthColumn(Number(e.target.value))}
          >
            {columns.map((col) => (
              <option key={col} value={col}>
                第 {col + 1} 列
                {mapping.header && grid[mapping.start - 1]?.[col]
                  ? ` · ${grid[mapping.start - 1][col]}`
                  : ''}
              </option>
            ))}
          </select>
        </Field>
        <button
          className="small-button"
          disabled={!rows.length}
          onClick={() => {
            history.record();
            updateMapping({ ...suggestPasteMapping(grid, w.calUnit), allowEmptyIntensity: mapping.allowEmptyIntensity });
            setError('');
          }}
        >
          自动识别列与起始行
        </button>
      </div>
      <div className="paste-options">
        {columns
          .filter((col) => col !== mapping.x)
          .map((col) => (
            <label className="check-line" key={col}>
              <input
                type="checkbox"
                aria-label={`第 ${col + 1} 列作为强度`}
                checked={mapping.ys.includes(col)}
                onChange={(e) => setIntensityColumn(col, e.target.checked)}
              />
              第 {col + 1} 列作为强度
            </label>
          ))}
        <button className="small-button" onClick={() => grow(0, 1)}>
          <Plus size={14} /> 添加强度列
        </button>
      </div>
      <Worksheet
        sheetId={wb.activeId}
        book="光谱工作台"
        sheet={wb.activeName}
        sheetTabs={wb.tabs}
        activeSheetId={wb.activeId}
        onSelectSheet={wb.select}
        onCreateSheet={wb.create}
        onDeleteSheet={wb.remove}
        onRenameSheet={wb.rename}
        columns={worksheetColumns}
        rows={grid}
        extraHeaderRow={{
          label: '颜色',
          render: (col) =>
            col === mapping.x ? (
              <span className="muted">—</span>
            ) : (
              <input
                type="color"
                aria-label={`原始光谱 第 ${col + 1} 列颜色`}
                value={colorAt(col)}
                onChange={(e) => setColor(col, e.target.value)}
              />
            ),
        }}
        preparePaste={(text, at) => {
          // Determine the required width first; validate and clear missing trailing cells atomically.
          const expanded = pasteIntoGrid(grid, text, at.row, at.column);
          const cols: WorksheetColumn[] = expanded[0].map((_, i) => ({
            key: `raw-${i}`,
            title: `第 ${i + 1} 列`,
            type: 'text',
          }));
          return pasteWorksheetRange(grid, cols, at, text);
        }}
        onStructure={structure}
        canStructure={canStructure}
        externalHistory={externalHistory}
        onChange={(next, change) => {
          history.record();
          const nextGrid = growPasteGrid(
            next,
            Math.max(6, next.length),
            Math.max(1, next[0]?.length ?? grid[0]?.length ?? 0),
          );
          if (
            change.kind === 'paste' &&
            (!rows.length ||
              (change.selection.anchor.row === 0 && change.selection.anchor.column === 0))
          ) {
            // A paste at the top-left re-detects the columns and the start row.
            updateMapping(suggestPasteMapping(next, w.calUnit), nextGrid);
          } else {
            const nextMapping = syncRawMapping(nextGrid, mapping);
            if (nextMapping !== mapping) updateMapping(nextMapping, nextGrid);
            else patchSheet({ grid: nextGrid });
          }
          setError('');
        }}
        cellLabel={(row, col) => `原始数据第 ${row + 1} 行第 ${col + 1} 列`}
        invalidCell={(row, col) => invalidCells.has(`${row}:${col}`)}
      />
      {(error || result.error) && <ErrorNote>{error || result.error}</ErrorNote>}
      <div className="paste-footer">
        <div aria-live="polite">
          <strong>
            {result.value
              ? `可绘制 ${result.value.spectra.length} 条光谱 · ${result.value.spectra.reduce((n, s) => n + s.points.length, 0)} 个数据点`
              : '每条光谱至少需要两个有效点，数值中不要带单位。'}
          </strong>
          <p>
            {plotted
              ? '再次绘图仅使用当前表中选中的强度列；名称、备注和颜色沿用表头设置。'
              : w.demo
                ? '首次绘图会清除示例工作区，使用你的原始数据。'
                : '绘图仅使用当前表中选中的强度列；已有表头信息保留用于图例。'}
          </p>
        </div>
        <button className="primary" disabled={!result.value || !!error} onClick={plot}>
          <ArrowDownToLine size={16} /> 根据表格绘图
        </button>
      </div>
    </section>
  );
}
