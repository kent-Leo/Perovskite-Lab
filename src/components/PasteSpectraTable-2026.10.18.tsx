import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardPaste, Plus, ArrowDownToLine, Trash2 } from 'lucide-react';
import { useWorkspace } from '../state/workspace';
import { useWorkbook } from '../state/useWorkbook';
import { numeric } from '../domain/math';
import { palette, type ColumnMetadata } from '../domain/types';
import { blankGrid, defaultRawMapping, defaultRawSheet } from '../domain/workbook';
import { insertRawSheetColumn, insertRawSheetRow } from '../domain/raw-sheet-edit';
import {
  rawColumnIndex,
  rawColumnKey,
  rawSpectrumColor,
} from '../domain/raw-spectra';
import type { Mapping } from '../services/import';
import { dateStamp } from '../services/download';
import {
  growPasteGrid,
  pasteIntoGrid,
  preparePastedSpectra,
  suggestPasteMapping,
  trimPasteGrid,
} from '../services/paste-2026.10.18';
import { ErrorNote, Field } from './ui';
import { WorkspaceWorksheet as Worksheet } from './WorkspaceWorksheet-v0.3.1-2026.10.19';
import { pasteWorksheetRange, type WorksheetColumn } from '../domain/worksheet-v0.2.0-2026.10.19';

export function PasteSpectraTable() {
  const { w, update, notify } = useWorkspace();
  const wb = useWorkbook('raw');
  const [error, setError] = useState(''),
    [plotted, setPlotted] = useState(false);
  const batch = useRef(new Map<number, string>());
  const source = `粘贴光谱-${dateStamp()}`;
  // The draft grid/mapping of the active sheet live in the workspace (w.rawSheet),
  // so editing a sheet and switching sheets persist the table as-is.
  const sheet = useMemo(
    () => w.rawSheet ?? defaultRawSheet(w.calUnit),
    [w.rawSheet, w.calUnit],
  );
  const grid = sheet.grid,
    mapping: Mapping = sheet.mapping;
  const rows = useMemo(() => trimPasteGrid(grid), [grid]);
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
    updateMapping({ ...mapping, ...changes });
    setError('');
  };
  function setColor(column: number, color: string) {
    const sheetId = wb.activeId;
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
  /** Insert a blank row above the active cell (works at any position). */
  function insertRow(row: number) {
    try {
      update((prev) => {
        const current = prev.rawSheet ?? defaultRawSheet(prev.calUnit);
        return { rawSheet: insertRawSheetRow(current, row) };
      });
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  /** Insert a blank column left of the active cell, shifting mapping and header metadata. */
  function insertColumn(column: number) {
    try {
      // Column indexes shift, so drop the cached column→spectrum ids; the persisted
      // rawColumnSpectra mapping is re-keyed below and is used on the next plot.
      batch.current = new Map();
      const sheetId = wb.activeId;
      update((prev) => {
        const current = prev.rawSheet ?? defaultRawSheet(prev.calUnit);
        const result = insertRawSheetColumn(
          current,
          prev.sheetMetadata?.[sheetId],
          prev.rawColumnSpectra,
          column,
        );
        return {
          rawSheet: result.rawSheet,
          rawColumnSpectra: result.columnSpectra,
          sheetMetadata: { ...prev.sheetMetadata, [sheetId]: result.metadata },
        };
      });
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function grow(extraRows: number, extraColumns: number) {
    try {
      const nextGrid = growPasteGrid(
        grid,
        grid.length + extraRows,
        (grid[0]?.length ?? 3) + extraColumns,
      );
      patchSheet({ grid: nextGrid });
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function plot() {
    if (!result.value) return;
    const r = result.value;
    const nextBatch = new Map(batch.current);
    const metadata = w.sheetMetadata?.[wb.activeId] ?? {};
    const spectra = r.spectra.map((s, i) => {
      const col = mapping.ys[i],
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
            onChange={(e) => {
              const x = Number(e.target.value);
              patch({ x, ys: mapping.ys.filter((col) => col !== x) });
            }}
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
                onChange={(e) =>
                  patch({
                    ys: e.target.checked
                      ? [...mapping.ys, col].sort((a, b) => a - b)
                      : mapping.ys.filter((y) => y !== col),
                  })
                }
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
        onChange={(next, change) => {
          const nextGrid = growPasteGrid(
            next,
            Math.max(6, next.length),
            Math.max(3, next[0]?.length ?? grid[0]?.length ?? 0),
          );
          if (
            change.kind === 'paste' &&
            (!rows.length ||
              (change.selection.anchor.row === 0 && change.selection.anchor.column === 0))
          ) {
            // A paste at the top-left re-detects the columns and the start row.
            updateMapping(suggestPasteMapping(next, w.calUnit), nextGrid);
          } else {
            patchSheet({ grid: nextGrid });
          }
          setError('');
        }}
        onAddColumn={() => grow(0, 1)}
        onInsertRow={insertRow}
        onInsertColumn={insertColumn}
        cellLabel={(row, col) => `原始数据第 ${row + 1} 行第 ${col + 1} 列`}
        invalidCell={(row, col) =>
          row >= mapping.start - 1 + (mapping.header ? 1 : 0) &&
          !!grid[row]?.some((v) => v.trim()) &&
          (col === mapping.x || mapping.ys.includes(col)) &&
          numeric(grid[row]?.[col]) === null &&
          !(mapping.allowEmptyIntensity && col !== mapping.x && !grid[row]?.[col]?.trim())
        }
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
