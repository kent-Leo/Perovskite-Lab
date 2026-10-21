import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Table2, Copy, ClipboardPaste, Plus, Undo2, Redo2, Pencil } from 'lucide-react';
import { fmt, numeric } from '../domain/math';
import {
  WORKSHEET_VERSION,
  WORKSHEET_LIMITS,
  cellName,
  columnLetter,
  cellInSelection,
  selectionName,
  selectionBounds,
  selectionStats,
  copyWorksheetRange,
  clearWorksheetRange,
  pasteWorksheetRange,
  trimWorksheetRows,
  normalizeWorksheetCell,
  type CellAddress,
  type CellSelection,
  type WorksheetColumn,
} from '../domain/worksheet-v0.2.0-2026.10.19';
import './Worksheet-v0.2.0-2026.10.19.css';

export type WorksheetChange = {
  kind: 'edit' | 'paste' | 'clear' | 'undo' | 'redo';
  selection: CellSelection;
};
export type WorksheetProps = {
  book: string;
  sheet: string;
  onRenameSheet?: (name: string) => void;
  columns: WorksheetColumn[];
  rows: string[][];
  onChange?: (rows: string[][], change: WorksheetChange) => void;
  onPaste?: (text: string, at: CellAddress) => void;
  preparePaste?: (text: string, at: CellAddress) => { rows: string[][]; selection: CellSelection };
  allowAddRows?: boolean;
  rowLimit?: number;
  onMoveRow?: (from: number, to: number) => void;
  onMetadataChange?: (column: number, field: 'title' | 'unit' | 'comment', value: string) => void;
  onAddColumn?: () => void;
  cellLabel?: (row: number, column: number) => string;
  invalidCell?: (row: number, column: number) => boolean;
  renderCell?: (row: number, column: number) => ReactNode | undefined;
  minRows?: number;
};
const PAGE_SIZE = 20;
const firstCell = { row: 0, column: 0 };

export function Worksheet({
  book,
  sheet,
  onRenameSheet,
  columns,
  rows,
  onChange,
  onPaste,
  preparePaste,
  allowAddRows = true,
  rowLimit,
  onMoveRow,
  onMetadataChange,
  onAddColumn,
  cellLabel,
  invalidCell,
  renderCell,
  minRows = 6,
}: WorksheetProps) {
  const [renaming, setRenaming] = useState(false),
    [sheetDraft, setSheetDraft] = useState(sheet),
    [sheetError, setSheetError] = useState('');
  const renameActive = useRef(false);
  function startRename() {
    setSheetDraft(sheet);
    setSheetError('');
    renameActive.current = true;
    setRenaming(true);
  }
  function finishRename() {
    if (!renameActive.current) return;
    const name = sheetDraft.trim();
    if (!name || name.length > 40) {
      setSheetError('标签名须为 1–40 个字符');
      return;
    }
    renameActive.current = false;
    onRenameSheet?.(name);
    setRenaming(false);
    setSheetError('');
  }
  const root = useRef<HTMLDivElement>(null),
    dragging = useRef(false),
    rowDragging = useRef<number | null>(null),
    navigating = useRef(false),
    pendingFocus = useRef<CellAddress | null>(null);
  const [selection, setSelection] = useState<CellSelection>({
    anchor: firstCell,
    focus: firstCell,
  });
  const [page, setPage] = useState(0),
    [capacity, setCapacity] = useState(minRows),
    [editing, setEditing] = useState(false),
    [message, setMessage] = useState('');
  const [historyCounts, setHistoryCounts] = useState({ past: 0, future: 0 });
  const history = useRef<{ past: string[][][]; future: string[][][]; expected: string | null }>({
    past: [],
    future: [],
    expected: null,
  });
  const height = Math.max(1, rows.length, capacity),
    maxPage = Math.ceil(height / PAGE_SIZE) - 1;
  const data = useMemo(
    () => Array.from({ length: height }, (_, r) => columns.map((_, c) => rows[r]?.[c] ?? '')),
    [rows, columns, height],
  );
  const fingerprintOf = (value: string[][]) =>
    JSON.stringify({
      keys: columns.filter((c) => !c.readOnly).map((c) => c.key),
      rows: trimWorksheetRows(value, columns).map((row) =>
        row.filter((_, c) => !columns[c]?.readOnly),
      ),
    });
  const fingerprint = fingerprintOf(rows);
  useEffect(() => {
    if (history.current.expected !== null && history.current.expected !== fingerprint) {
      history.current.past = [];
      history.current.future = [];
      setHistoryCounts({ past: 0, future: 0 });
    }
    history.current.expected = fingerprint;
  }, [fingerprint]);
  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);
  useEffect(() => {
    const clamp = (c: CellAddress) => ({
      row: Math.min(c.row, height - 1),
      column: Math.max(0, Math.min(c.column, columns.length - 1)),
    });
    setSelection((s) => ({ anchor: clamp(s.anchor), focus: clamp(s.focus) }));
    setPage((p) => Math.min(p, maxPage));
  }, [height, columns.length, maxPage]);
  const syncHistory = () =>
    setHistoryCounts({ past: history.current.past.length, future: history.current.future.length });
  function commit(next: string[][], kind: WorksheetChange['kind'], range = selection) {
    if (rowLimit !== undefined && trimWorksheetRows(next, columns).length > rowLimit)
      throw new Error('请通过导入样品添加光谱，样品表不能新增没有光谱数据的行');
    const editable =
      rowLimit === undefined ? trimWorksheetRows(next, columns) : next.slice(0, rowLimit);
    next = editable.map((row) =>
      row.map((value, c) =>
        columns[c]?.type === 'checkbox'
          ? value || (columns[c].defaultChecked ? 'true' : 'false')
          : value,
      ),
    );
    if (!onChange || fingerprintOf(next) === fingerprint) return;
    history.current.past.push(rows.map((row) => [...row]));
    const limit = Math.max(
      1,
      Math.min(20, Math.floor(1000000 / Math.max(1, next.length * columns.length))),
    );
    history.current.past = history.current.past.slice(-limit);
    history.current.future = [];
    const trimmed = trimWorksheetRows(next, columns);
    history.current.expected = fingerprintOf(trimmed);
    onChange(trimmed, { kind, selection: range });
    syncHistory();
    setMessage('');
  }
  function undo(redo = false) {
    if (!onChange) return;
    const from = redo ? history.current.future : history.current.past,
      to = redo ? history.current.past : history.current.future,
      next = from.pop();
    if (!next) return;
    to.push(rows.map((row) => [...row]));
    history.current.expected = fingerprintOf(next);
    onChange(next, { kind: redo ? 'redo' : 'undo', selection });
    syncHistory();
    setMessage('');
  }
  function edit(at: CellAddress, value: string) {
    const column = columns[at.column];
    if (!onChange || !column || column.readOnly) return;
    try {
      // Keep intermediate numeric text editable; invalid values are marked in the grid.
      const next = data.map((row) => [...row]);
      next[at.row][at.column] =
        column.type === 'number' ? value : normalizeWorksheetCell(value, column);
      commit(next, 'edit');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  function focusCell(at: CellAddress, extend = false) {
    const next = {
      row: Math.max(0, Math.min(height - 1, at.row)),
      column: Math.max(0, Math.min(columns.length - 1, at.column)),
    };
    setSelection((s) => ({ anchor: extend ? s.anchor : next, focus: next }));
    setPage(Math.floor(next.row / PAGE_SIZE));
    setEditing(false);
    pendingFocus.current = next;
  }
  useLayoutEffect(() => {
    const at = pendingFocus.current;
    if (!at) return;
    navigating.current = true;
    const cell = root.current?.querySelector<HTMLElement>(`[data-cell="${at.row}:${at.column}"]`);
    (cell?.querySelector<HTMLElement>('input, select') ?? cell)?.focus();
    navigating.current = false;
    pendingFocus.current = null;
  }, [selection, page]);

  function paste(text: string, at = selection.focus) {
    try {
      if (onPaste) {
        onPaste(text, at);
        setMessage('');
        return;
      }
      if (!onChange) throw new Error('此工作表为只读结果');
      const result = preparePaste
        ? preparePaste(text, at)
        : pasteWorksheetRange(data, columns, at, text);
      commit(result.rows, 'paste', result.selection);
      setSelection(result.selection);
      setEditing(false);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  function clear() {
    commit(clearWorksheetRange(data, columns, selection), 'clear');
    setEditing(false);
  }
  function clipboard(e: ClipboardEvent<HTMLDivElement>, cut = false) {
    const target = e.target as HTMLInputElement;
    if (target.matches('input, textarea')) {
      if (!target.closest('[data-cell]')) return;
      if (
        target.selectionStart !== null &&
        target.selectionStart !== target.selectionEnd &&
        selectionName(selection) === cellName(selection.focus)
      )
        return;
    }
    e.preventDefault();
    e.clipboardData.setData('text/plain', copyWorksheetRange(data, selection));
    if (cut && onChange) clear();
  }
  function keyboard(e: KeyboardEvent<HTMLDivElement>) {
    if (!(e.target as HTMLElement).closest('[data-cell]') || !columns.length) return;
    const command = e.ctrlKey || e.metaKey,
      key = e.key.toLowerCase(),
      b = selectionBounds(selection),
      multiple = b.top !== b.bottom || b.left !== b.right;
    if (command && (key === 'z' || key === 'y')) {
      e.preventDefault();
      undo(key === 'y' || e.shiftKey);
      return;
    }
    if (command && key === 'a' && !editing) {
      e.preventDefault();
      setSelection({ anchor: firstCell, focus: { row: height - 1, column: columns.length - 1 } });
      return;
    }
    if (e.key === 'Escape') {
      setEditing(false);
      setSelection({ anchor: selection.focus, focus: selection.focus });
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      setEditing(true);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && (!editing || multiple)) {
      e.preventDefault();
      clear();
      return;
    }
    const at = selection.focus;
    if (e.key === 'Tab') {
      e.preventDefault();
      const index = Math.max(
        0,
        Math.min(
          height * columns.length - 1,
          at.row * columns.length + at.column + (e.shiftKey ? -1 : 1),
        ),
      );
      focusCell({ row: Math.floor(index / columns.length), column: index % columns.length });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      focusCell({ ...at, row: at.row + (e.shiftKey ? -1 : 1) });
      return;
    }
    if (editing) return;
    const moves: Record<string, CellAddress> = {
      ArrowUp: { ...at, row: at.row - 1 },
      ArrowDown: { ...at, row: at.row + 1 },
      ArrowLeft: { ...at, column: at.column - 1 },
      ArrowRight: { ...at, column: at.column + 1 },
      Home: { row: command ? 0 : at.row, column: 0 },
      End: { row: command ? height - 1 : at.row, column: columns.length - 1 },
    };
    if (moves[e.key]) {
      e.preventDefault();
      focusCell(moves[e.key], e.shiftKey);
    }
  }
  const stats = useMemo(() => selectionStats(data, selection), [data, selection]);
  const focus = selection.focus,
    activeColumn = columns[focus.column],
    activeValue = data[focus.row]?.[focus.column] ?? '';
  return (
    <div
      className="worksheet"
      ref={root}
      aria-label={`${book} ${sheet} 工作表`}
      onKeyDown={keyboard}
      onCopy={(e) => clipboard(e)}
      onCut={(e) => clipboard(e, true)}
    >
      <div className="worksheet-bookbar">
        <span>
          <Table2 size={15} />
          {book}
          <b>/</b>
          {sheet}
        </span>
        <span>
          Worksheet v{WORKSHEET_VERSION} · {onChange ? '可编辑工作表' : '只读结果表'}
        </span>
      </div>
      <div className="worksheet-tools" aria-label="工作表工具栏">
        <button
          type="button"
          aria-label="撤销工作表修改"
          disabled={!historyCounts.past}
          onClick={() => undo()}
        >
          <Undo2 size={14} />
          撤销
        </button>
        <button
          type="button"
          aria-label="重做工作表修改"
          disabled={!historyCounts.future}
          onClick={() => undo(true)}
        >
          <Redo2 size={14} />
          重做
        </button>
        <span className="worksheet-separator" />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(copyWorksheetRange(data, selection));
              setMessage('选区已复制');
            } catch {
              setMessage('请使用 ⌘C / Ctrl+C 复制选区');
            }
          }}
        >
          <Copy size={14} />
          复制选区
        </button>
        {onChange && (
          <>
            <button
              type="button"
              onClick={async () => {
                try {
                  paste(await navigator.clipboard.readText());
                } catch {
                  setMessage('请点击单元格，使用 ⌘V / Ctrl+V 粘贴');
                }
              }}
            >
              <ClipboardPaste size={14} />
              粘贴
            </button>
            {allowAddRows && (
              <button
                type="button"
                onClick={() => {
                  if (
                    height + 10 > WORKSHEET_LIMITS.rows ||
                    (height + 10) * columns.length > WORKSHEET_LIMITS.cells
                  ) {
                    setMessage('工作表已达到行数上限');
                    return;
                  }
                  setCapacity(height + 10);
                  setPage(Math.floor(height / PAGE_SIZE));
                }}
              >
                <Plus size={14} />行
              </button>
            )}
          </>
        )}
        {onAddColumn && (
          <button type="button" onClick={onAddColumn}>
            <Plus size={14} />列
          </button>
        )}
      </div>
      <div className="worksheet-formula">
        <output aria-label="工作表当前选区">{selectionName(selection)}</output>
        <span>值</span>
        <input
          aria-label="工作表当前单元格值"
          value={activeValue}
          readOnly={!onChange || !activeColumn || activeColumn.readOnly}
          onChange={(e) => edit(focus, e.target.value)}
        />
      </div>
      <div className="worksheet-scroll" tabIndex={0} aria-label="工作表数据区域，可横向滚动">
        <table
          role="grid"
          aria-label={`${sheet} 数据表`}
          aria-rowcount={height + 4}
          aria-colcount={columns.length + 1}
        >
          <thead>
            <tr>
              <th className="worksheet-corner">
                <button
                  type="button"
                  aria-label="选择整个工作表"
                  onClick={() => {
                    setSelection({
                      anchor: firstCell,
                      focus: { row: height - 1, column: Math.max(0, columns.length - 1) },
                    });
                    setEditing(false);
                  }}
                >
                  ▦
                </button>
              </th>
              {columns.map((col, c) => (
                <th scope="col" key={col.key}>
                  <button
                    type="button"
                    aria-label={`选择 ${columnLetter(c)} 列`}
                    onClick={() => {
                      setSelection({
                        anchor: { row: 0, column: c },
                        focus: { row: height - 1, column: c },
                      });
                      setEditing(false);
                    }}
                  >
                    {columnLetter(c)}
                    {col.designation ? `(${col.designation})` : ''}
                  </button>
                </th>
              ))}
            </tr>
            {(['title', 'unit', 'comment'] as const).map((field, i) => (
              <tr className="worksheet-label-row" key={field}>
                <th scope="row">{['名称', '单位', '备注'][i]}</th>
                {columns.map((col, c) => (
                  <td key={col.key}>
                    {onMetadataChange ? (
                      <input
                        aria-label={`${sheet} 第 ${c + 1} 列${['名称', '单位', '备注'][i]}`}
                        value={col[field] ?? ''}
                        onChange={(e) => onMetadataChange(c, field, e.target.value)}
                      />
                    ) : (
                      <span title={col[field]}>{col[field] || '—'}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {data.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((values, offset) => {
              const r = page * PAGE_SIZE + offset;
              return (
                <tr
                  key={r}
                  aria-rowindex={r + 5}
                  onDragOver={(e) => {
                    if (onMoveRow && r < rows.length) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (onMoveRow && rowDragging.current !== null && r < rows.length) {
                      e.preventDefault();
                      onMoveRow(rowDragging.current, r);
                    }
                    rowDragging.current = null;
                  }}
                >
                  <th scope="row">
                    <button
                      type="button"
                      aria-label={`选择第 ${r + 1} 行`}
                      draggable={!!onMoveRow && r < rows.length}
                      title={onMoveRow ? '拖动行号调整顺序' : undefined}
                      onDragStart={(e) => {
                        rowDragging.current = r;
                        e.dataTransfer.setData('text/plain', String(r + 1));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        rowDragging.current = null;
                      }}
                      onClick={() => {
                        setSelection({
                          anchor: { row: r, column: 0 },
                          focus: { row: r, column: Math.max(0, columns.length - 1) },
                        });
                        setEditing(false);
                      }}
                    >
                      {r + 1}
                    </button>
                  </th>
                  {columns.map((col, c) => {
                    const at = { row: r, column: c },
                      readOnly = !onChange || col.readOnly,
                      value = values[c],
                      label = cellLabel?.(r, c) ?? `${sheet} ${cellName(at)}`,
                      custom = renderCell?.(r, c);
                    const invalid =
                      invalidCell?.(r, c) ||
                      (col.type === 'number' && !!value.trim() && numeric(value) === null);
                    return (
                      <td
                        key={col.key}
                        role="gridcell"
                        tabIndex={readOnly ? 0 : -1}
                        aria-selected={cellInSelection(at, selection)}
                        aria-readonly={readOnly || undefined}
                        data-cell={`${r}:${c}`}
                        className={`${cellInSelection(at, selection) ? 'is-selected' : ''} ${focus.row === r && focus.column === c ? 'is-active' : ''} ${readOnly ? 'is-readonly' : ''}`}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          if (e.shiftKey) {
                            e.preventDefault();
                            setSelection((s) => ({ ...s, focus: at }));
                          } else setSelection({ anchor: at, focus: at });
                          dragging.current = true;
                          setEditing(false);
                        }}
                        onPointerEnter={(e) => {
                          if (dragging.current && e.buttons === 1)
                            setSelection((s) => ({ ...s, focus: at }));
                        }}
                        onFocus={() => {
                          if (!navigating.current && !dragging.current)
                            setSelection((current) =>
                              current.focus.row === r && current.focus.column === c
                                ? current
                                : { anchor: at, focus: at },
                            );
                        }}
                        onPaste={(e) => {
                          e.preventDefault();
                          paste(e.clipboardData.getData('text/plain'), at);
                        }}
                      >
                        {custom !== undefined ? (
                          custom
                        ) : readOnly ? (
                          <span className="worksheet-result" aria-label={label}>
                            {value || '—'}
                          </span>
                        ) : col.type === 'select' ? (
                          <select
                            aria-label={label}
                            value={value}
                            onChange={(e) => edit(at, e.target.value)}
                          >
                            <option value="">—</option>
                            {col.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            aria-label={label}
                            type={
                              col.type === 'checkbox'
                                ? 'checkbox'
                                : col.type === 'color'
                                  ? 'color'
                                  : 'text'
                            }
                            value={
                              col.type === 'checkbox'
                                ? undefined
                                : col.type === 'color'
                                  ? value || '#000000'
                                  : value
                            }
                            checked={col.type === 'checkbox' ? value === 'true' : undefined}
                            aria-invalid={invalid || undefined}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(e) => {
                              setEditing(true);
                              edit(
                                at,
                                col.type === 'checkbox' ? String(e.target.checked) : e.target.value,
                              );
                            }}
                            onFocus={(e) => {
                              if (e.target.type === 'text') e.target.select();
                            }}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="worksheet-bottom">
        <div className="worksheet-sheet-tab" onDoubleClick={onRenameSheet && !renaming ? startRename : undefined}>
          <Table2 size={13} />
          {renaming ? (
            <input
              className="worksheet-sheet-name"
              aria-label="工作表标签名"
              aria-invalid={!!sheetError}
              value={sheetDraft}
              maxLength={40}
              autoFocus
              onFocus={(e) => e.target.select()}
              onChange={(e) => { setSheetDraft(e.target.value); setSheetError(''); }}
              onBlur={finishRename}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') { e.preventDefault(); finishRename(); }
                if (e.key === 'Escape') {
                  renameActive.current = false;
                  setRenaming(false);
                  setSheetError('');
                }
              }}
            />
          ) : <span className="worksheet-sheet-label" title={sheet}>{sheet}</span>}
          {onRenameSheet && !renaming && (
            <button type="button" aria-label={`重命名标签 ${sheet}`} title="重命名标签（也可双击标签）" onClick={startRename}>
              <Pencil size={12} />
            </button>
          )}
        </div>
        <span>
          {rows.length} 行 × {columns.length} 列
        </span>
        <div>
          <button type="button" disabled={!page} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <span>
            {page + 1} / {maxPage + 1}
          </span>
          <button type="button" disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)}>
            下一页
          </button>
        </div>
      </div>
      <div className="worksheet-status" aria-live="polite">
        <span>
          {sheetError || message || '拖动或 Shift 选择区域 · Tab / 方向键移动 · F2 编辑 · ⌘/Ctrl+C/V 复制粘贴'}
        </span>
        <span>
          选中 {stats.cells} 格 · 数值 {stats.numeric}
          {stats.numeric > 0 && ` · 均值 ${fmt(stats.mean, 5)} · 总和 ${fmt(stats.sum, 5)}`}
        </span>
      </div>
    </div>
  );
}
