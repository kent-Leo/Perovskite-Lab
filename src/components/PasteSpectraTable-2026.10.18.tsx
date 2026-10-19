import { useMemo, useRef, useState } from 'react';
import { ClipboardPaste, Plus, ArrowDownToLine, Trash2 } from 'lucide-react';
import { useWorkspace } from '../state/workspace';
import { numeric } from '../domain/math';
import { mergeImport, type Mapping } from '../services/import';
import { dateStamp } from '../services/download';
import {
  emptyPasteGrid,
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
  const [grid, setGrid] = useState(emptyPasteGrid),
    [mapping, setMapping] = useState<Mapping>(() => suggestPasteMapping([], w.calUnit)),
    [error, setError] = useState(''),
    [plotted, setPlotted] = useState(false);
  const batch = useRef(new Map<number, string>());
  const source = `粘贴光谱-${dateStamp()}`;
  const rows = useMemo(() => trimPasteGrid(grid), [grid]);
  const columns = Array.from({ length: grid[0].length }, (_, i) => i);
  const result = useMemo(() => {
    if (!rows.length) return { value: null, error: '' };
    try {
      return { value: preparePastedSpectra(rows, mapping, source), error: '' };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  }, [rows, mapping, source]);
  const patch = (changes: Partial<Mapping>) => {
    setMapping((m) => ({ ...m, ...changes }));
    setError('');
  };
  function grow(extraRows: number, extraColumns: number) {
    try {
      setGrid(growPasteGrid(grid, grid.length + extraRows, grid[0].length + extraColumns));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function plot() {
    if (!result.value) return;
    const r = result.value,
      previousIds = new Set(batch.current.values());
    const nextBatch = new Map<number, string>();
    const spectra = r.spectra.map((s, i) => {
      const col = mapping.ys[i],
        previousId = batch.current.get(col),
        previous = w.spectra.find((old) => old.id === previousId);
      const next = previous
        ? { ...previous, name: s.name, points: s.points, source: s.source, visible: true }
        : s;
      nextBatch.set(col, next.id);
      return next;
    });
    update((prev) =>
      mergeImport(
        { ...prev, spectra: prev.spectra.filter((s) => !previousIds.has(s.id)) },
        { ...r, spectra },
        mapping.unit,
      ),
    );
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
    key: `raw-${col}`,
    title: col === mapping.x ? '波长' : `强度 ${col}`,
    designation: col === mapping.x ? 'X' : mapping.ys.includes(col) ? 'Y' : 'Meta',
    unit: col === mapping.x ? 'nm' : 'a.u.',
    type: 'text',
    comment: col === mapping.x ? '波长列' : '通过上方复选框选择强度列',
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
            和逐格输入。默认第一列为波长，其余列为强度。
          </p>
        </div>
        <button
          className="small-button"
          disabled={!rows.length}
          onClick={() => {
            setGrid(emptyPasteGrid());
            setMapping(suggestPasteMapping([], w.calUnit));
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
            setMapping(suggestPasteMapping(grid, w.calUnit));
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
        sheetId="raw"
        book="光谱工作台"
        sheet={w.sheetNames?.raw ?? '原始光谱'}
        onRenameSheet={(name) => update((prev) => ({ sheetNames: { ...prev.sheetNames, raw: name } }))}
        columns={worksheetColumns}
        rows={grid}
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
          setGrid(
            growPasteGrid(
              next,
              Math.max(6, next.length),
              Math.max(3, next[0]?.length ?? grid[0].length),
            ),
          );
          if (
            change.kind === 'paste' &&
            (!rows.length ||
              (change.selection.anchor.row === 0 && change.selection.anchor.column === 0))
          )
            setMapping(suggestPasteMapping(next, w.calUnit));
          setError('');
        }}
        onAddColumn={() => grow(0, 1)}
        cellLabel={(row, col) => `原始数据第 ${row + 1} 行第 ${col + 1} 列`}
        invalidCell={(row, col) =>
          row >= mapping.start - 1 + (mapping.header ? 1 : 0) &&
          !!grid[row]?.some((v) => v.trim()) &&
          (col === mapping.x || mapping.ys.includes(col)) &&
          numeric(grid[row]?.[col]) === null
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
              ? '修改后再次绘图会更新本次粘贴的曲线；清空表格仅清除草稿。'
              : w.demo
                ? '首次绘图会清除示例工作区，使用你的原始数据。'
                : '新粘贴的光谱会添加到工作台，已有实验光谱会保留。'}
          </p>
        </div>
        <button className="primary" disabled={!result.value || !!error} onClick={plot}>
          <ArrowDownToLine size={16} /> 根据表格绘图
        </button>
      </div>
    </section>
  );
}
