import { useMemo, useRef, useState, type ClipboardEvent } from 'react';
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

const PAGE_SIZE = 20;
export function PasteSpectraTable() {
  const { w, update, notify } = useWorkspace();
  const [grid, setGrid] = useState(emptyPasteGrid),
    [mapping, setMapping] = useState<Mapping>(() => suggestPasteMapping([], w.calUnit)),
    [page, setPage] = useState(0),
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
  function paste(e: ClipboardEvent<HTMLInputElement>, row: number, column: number) {
    e.preventDefault();
    try {
      const next = pasteIntoGrid(grid, e.clipboardData.getData('text/plain'), row, column);
      setGrid(next);
      if (!rows.length || (row === 0 && column === 0))
        setMapping(suggestPasteMapping(next, w.calUnit));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function grow(extraRows: number, extraColumns: number) {
    try {
      setGrid(growPasteGrid(grid, grid.length + extraRows, grid[0].length + extraColumns));
      if (extraRows) setPage(Math.floor(grid.length / PAGE_SIZE));
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
  const pageCount = Math.ceil(grid.length / PAGE_SIZE);
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
            setPage(0);
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
      <div
        className="table-scroll paste-grid-scroll"
        tabIndex={0}
        aria-label="原始光谱数据表，可横向滚动"
      >
        <table className="paste-grid" aria-label="粘贴原始光谱数据表" aria-describedby="paste-hint">
          <thead>
            <tr>
              <th scope="col">行</th>
              {columns.map((col) => (
                <th scope="col" key={col}>
                  <div>第 {col + 1} 列</div>
                  {col === mapping.x ? (
                    <span className="paste-wave-label">波长 / nm</span>
                  ) : (
                    <label>
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
                      强度
                    </label>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((cells, offset) => {
              const row = page * PAGE_SIZE + offset,
                dataRow = row >= mapping.start - 1 + (mapping.header ? 1 : 0),
                nonempty = cells.some((v) => v.trim());
              return (
                <tr key={row}>
                  <th scope="row">{row + 1}</th>
                  {cells.map((value, col) => {
                    const invalid =
                      dataRow &&
                      nonempty &&
                      (col === mapping.x || mapping.ys.includes(col)) &&
                      numeric(value) === null;
                    return (
                      <td key={col}>
                        <input
                          type="text"
                          autoComplete="off"
                          spellCheck={false}
                          aria-label={`原始数据第 ${row + 1} 行第 ${col + 1} 列`}
                          aria-invalid={invalid || undefined}
                          value={value}
                          placeholder={row === 0 ? (col === 0 ? '波长或列名' : '强度或样品名') : ''}
                          onPaste={(e) => paste(e, row, col)}
                          onChange={(e) => {
                            const next = grid.map((r, i) =>
                              i === row ? r.map((v, j) => (j === col ? e.target.value : v)) : r,
                            );
                            setGrid(next);
                            setError('');
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="paste-scroll-hint">
        表格可左右滑动；长数据可翻页查看。粘贴会覆盖所选位置的区域，新一批数据可先清空表格。
      </p>
      <div className="paste-grid-actions">
        <div>
          <button className="small-button" onClick={() => grow(10, 0)}>
            <Plus size={14} /> 添加 10 行
          </button>
          <button className="small-button" onClick={() => grow(0, 1)}>
            <Plus size={14} /> 添加强度列
          </button>
        </div>
        <div className="paste-pager">
          <span>
            {grid.length} 行 × {grid[0].length} 列
          </span>
          {pageCount > 1 && (
            <>
              <button
                className="small-button"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <span>
                {page + 1} / {pageCount}
              </span>
              <button
                className="small-button"
                disabled={page + 1 === pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </>
          )}
        </div>
      </div>
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
