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
import { Table2, Copy, ClipboardPaste, Plus, Undo2, Redo2, Pencil, Trash2 } from 'lucide-react';
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
  pasteMetadataValues,
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
export type WorksheetSheetTab = { id: string; name: string };
export type WorksheetProps = {
  book: string;
  sheet: string;
  onRenameSheet?: (name: string) => void;
  // Multi-sheet tab bar: only rendered when sheetTabs + onSelectSheet are provided.
  sheetTabs?: WorksheetSheetTab[];
  activeSheetId?: string;
  onSelectSheet?: (id: string) => void;
  onCreateSheet?: () => void;
  onDeleteSheet?: (id: string) => void;
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
  // Insert a row above / a column to the left of the active cell (0-based position).
  onInsertRow?: (row: number) => void;
  onInsertColumn?: (column: number) => void;
  cellLabel?: (row: number, column: number) => string;
  invalidCell?: (row: number, column: number) => boolean;
  renderCell?: (row: number, column: number) => ReactNode | undefined;
  // Extra editable header row shown below 名称 / 单位 / 备注 (for example colors).
  extraHeaderRow?: { label: string; render: (column: number) => ReactNode };
  minRows?: number;
  /** Optional whole-document history, including probe / row structure changes. */
  externalHistory?: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
};
const firstCell = { row: 0, column: 0 };

/** Parse a `data-cell="row:column"` attribute into a cell address. */
function cellFromAttr(value: string | null | undefined): CellAddress | null {
  const match = value ? /^(\d+):(\d+)$/.exec(value) : null;
  return match ? { row: Number(match[1]), column: Number(match[2]) } : null;
}

export function Worksheet({
  book,
  sheet,
  onRenameSheet,
  sheetTabs,
  activeSheetId,
  onSelectSheet,
  onCreateSheet,
  onDeleteSheet,
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
  onInsertRow,
  onInsertColumn,
  cellLabel,
  invalidCell,
  renderCell,
  extraHeaderRow,
  minRows = 6,
  externalHistory,
}: WorksheetProps) {
  const tabs = sheetTabs ?? [];
  // The tab bar replaces the legacy single tab only when it can actually switch sheets.
  const multiSheet = tabs.length > 0 && !!onSelectSheet;
  const activeTab = multiSheet
    ? (tabs.find((tab) => tab.id === activeSheetId) ?? tabs[0])
    : undefined;
  const activeTabId = activeTab?.id;
  // In tab mode the visible/active sheet comes from the tab list; the sheet prop stays the fallback.
  const activeSheet = activeTab?.name ?? sheet;
  const [renaming, setRenaming] = useState(false),
    [sheetDraft, setSheetDraft] = useState(sheet),
    [sheetError, setSheetError] = useState('');
  const renameActive = useRef(false),
    lastActiveTab = useRef(activeTabId);
  useEffect(() => {
    // Switching the active sheet abandons an uncommitted rename of the previous sheet.
    if (lastActiveTab.current === activeTabId) return;
    lastActiveTab.current = activeTabId;
    renameActive.current = false;
    setRenaming(false);
    setSheetError('');
  }, [activeTabId]);
  function startRename() {
    setSheetDraft(activeSheet);
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
    dragPointer = useRef<number | null>(null),
    rowDragging = useRef<number | null>(null),
    navigating = useRef(false),
    pendingFocus = useRef<CellAddress | null>(null);
  const [selection, setSelection] = useState<CellSelection>({
    anchor: firstCell,
    focus: firstCell,
  });
  const [capacity, setCapacity] = useState(minRows),
    [editing, setEditing] = useState(false),
    [message, setMessage] = useState('');
  // Bumped to re-focus the active cell after toolbar actions that change rows/columns.
  const [focusRequest, setFocusRequest] = useState(0);
  const [historyCounts, setHistoryCounts] = useState({ past: 0, future: 0 });
  const history = useRef<{ past: string[][][]; future: string[][][]; expected: string | null }>({
    past: [],
    future: [],
    expected: null,
  });
  const height = Math.max(1, rows.length, capacity);
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
    // Drag-to-select must keep working for fast drags and when the pointer
    // briefly leaves the table: td onPointerEnter alone can miss those cells
    // (Windows additionally cancels the pointer stream when the browser starts
    // a native text drag from a focused input). A window-level pointermove
    // fallback hit-tests the cell under the cursor with elementFromPoint.
    const extend = (e: PointerEvent) => {
      if (!dragging.current || e.buttons !== 1) return;
      if (dragPointer.current !== null && e.pointerId !== dragPointer.current) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      // Ignore clicks over other worksheets / chrome: only this grid extends.
      if (!(hit instanceof Element) || !root.current?.contains(hit)) return;
      const at = cellFromAttr(hit.closest('[data-cell]')?.getAttribute('data-cell'));
      if (!at) return;
      setSelection((s) =>
        s.focus.row === at.row && s.focus.column === at.column ? s : { ...s, focus: at },
      );
    };
    const stop = () => {
      dragging.current = false;
      dragPointer.current = null;
    };
    window.addEventListener('pointermove', extend);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', extend);
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
  }, [height, columns.length]);
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
    if (externalHistory) {
      (redo ? externalHistory.redo : externalHistory.undo)();
      setEditing(false);
      return;
    }
    if (!onChange) return;
    const from = redo ? history.current.future : history.current.past,
      to = redo ? history.current.past : history.current.future,
      next = from.pop();
    if (!next) return;
    to.push(rows.map((row) => [...row]));
    history.current.expected = fingerprintOf(next);
    onChange(next, { kind: redo ? 'redo' : 'undo', selection });
    setEditing(false);
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
    setEditing(false);
    pendingFocus.current = next;
  }
  /** Enter edit mode with the caret after the current text (collapsing a select-all). */
  function editAtEnd(input: HTMLInputElement) {
    const end = input.value.length;
    input.setSelectionRange(end, end);
    setEditing(true);
  }
  function insertAt(kind: 'row' | 'column') {
    const at = selection.focus;
    try {
      if (kind === 'row') onInsertRow?.(at.row);
      else onInsertColumn?.(at.column);
    } catch (e) {
      setMessage((e as Error).message);
      return;
    }
    // The active cell keeps its coordinates: they now point at the new blank row/column.
    setEditing(false);
    setMessage('');
    pendingFocus.current = { ...at };
    setFocusRequest((n) => n + 1);
  }
  useLayoutEffect(() => {
    const at = pendingFocus.current;
    if (!at) return;
    navigating.current = true;
    const cell = root.current?.querySelector<HTMLElement>(`[data-cell="${at.row}:${at.column}"]`);
    const target = cell?.querySelector<HTMLElement>('input, select') ?? cell;
    target?.focus();
    // e.preventDefault() on pointerdown suppresses the browser's native focus
    // and select-all, so reproduce the established behaviour here: clicking a
    // cell focuses its input with all text selected (typing replaces it).
    if (target instanceof HTMLInputElement && target.type === 'text') target.select();
    navigating.current = false;
    pendingFocus.current = null;
  }, [selection, focusRequest]);

  function pasteMetadata(
    e: ClipboardEvent<HTMLInputElement>,
    column: number,
    field: 'title' | 'unit' | 'comment',
  ) {
    if (!onMetadataChange) return;
    const values = pasteMetadataValues(e.clipboardData.getData('text/plain'));
    // A single value keeps the native input behaviour, including partial replacement.
    if (values.length <= 1) return;
    e.preventDefault();
    const room = Math.max(0, columns.length - column),
      applied = values.slice(0, room);
    applied.forEach((value, i) => onMetadataChange(column + i, field, value));
    const label = ['名称', '单位', '备注'][['title', 'unit', 'comment'].indexOf(field)];
    setMessage(
      values.length > room
        ? `已粘贴 ${applied.length} 列${label}，超出表格末列的 ${values.length - room} 个值已忽略`
        : `已粘贴 ${applied.length} 列${label}`,
    );
  }
  function paste(text: string, at = selection.focus) {    try {
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
    if (e.nativeEvent.isComposing) return;
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
      const target = e.target as HTMLElement;
      setSelection((s) => ({ anchor: s.focus, focus: s.focus }));
      if (target instanceof HTMLInputElement && target.type === 'text') editAtEnd(target);
      else setEditing(true);
      return;
    }
    // Multi-cell selections keep Excel semantics for both erase keys.
    if (multiple && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      clear();
      return;
    }
    if (!editing && e.key === 'Delete') {
      e.preventDefault();
      clear();
      return;
    }
    if (!editing && e.key === 'Backspace') {
      const target = e.target as HTMLElement;
      const input =
        target instanceof HTMLInputElement && target.type === 'text'
          ? target
          : (root.current?.querySelector<HTMLInputElement>(
              `[data-cell="${selection.focus.row}:${selection.focus.column}"] input[type="text"]`,
            ) ?? null);
      if (!input) {
        e.preventDefault();
        clear();
        return;
      }
      if (target !== input) {
        // Focus sits on the cell rather than on its input: erase one character at the end.
        e.preventDefault();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        edit(selection.focus, input.value.slice(0, -1));
        return;
      }
      // Navigation-mode Backspace: collapse a select-all to the caret end, then let the
      // browser erase one character. Stay in navigation mode so arrows keep moving cells.
      if (input.selectionStart !== input.selectionEnd)
        input.setSelectionRange(input.value.length, input.value.length);
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
  // Shared between the legacy single tab and the active tab of the multi-sheet bar.
  const renameInput = (
    <input
      className="worksheet-sheet-name"
      aria-label="工作表标签名"
      aria-invalid={!!sheetError}
      value={sheetDraft}
      maxLength={40}
      autoFocus
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setSheetDraft(e.target.value);
        setSheetError('');
      }}
      onBlur={finishRename}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          finishRename();
        }
        if (e.key === 'Escape') {
          renameActive.current = false;
          setRenaming(false);
          setSheetError('');
        }
      }}
    />
  );
  return (
    <div
      className="worksheet"
      ref={root}
      aria-label={`${book} ${activeSheet} 工作表`}
      onKeyDown={keyboard}
      onCopy={(e) => clipboard(e)}
      onCut={(e) => clipboard(e, true)}
      onDragStart={(e) => {
        // A native drag from a cell (typically text selected inside a focused
        // input on Windows) cancels the pointer stream that drives drag-to-
        // select. Row-number reordering lives outside [data-cell] and keeps
        // working as a deliberate drag source.
        if ((e.target as HTMLElement).closest?.('[data-cell]')) e.preventDefault();
      }}
    >
      <div className="worksheet-bookbar">
        <span>
          <Table2 size={15} />
          {book}
          <b>/</b>
          {activeSheet}
        </span>
        <span>
          Worksheet v{WORKSHEET_VERSION} · {onChange ? '可编辑工作表' : '只读结果表'}
        </span>
      </div>
      <div className="worksheet-tools" aria-label="工作表工具栏">
        <button
          type="button"
          aria-label="撤销工作表修改"
          disabled={externalHistory ? !externalHistory.canUndo : !historyCounts.past}
          onClick={() => undo()}
        >
          <Undo2 size={14} />
          撤销
        </button>
        <button
          type="button"
          aria-label="重做工作表修改"
          disabled={externalHistory ? !externalHistory.canRedo : !historyCounts.future}
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
                  const next = { row: height, column: selection.focus.column };
                  setSelection({ anchor: next, focus: next });
                  pendingFocus.current = next;
                  setEditing(false);
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
        {(onInsertRow || onInsertColumn) && <span className="worksheet-separator" />}
        {onInsertRow && (
          <button
            type="button"
            aria-label="插入行"
            title="在选中行上方插入一行"
            onClick={() => insertAt('row')}
          >
            <Plus size={14} />插入行
          </button>
        )}
        {onInsertColumn && (
          <button
            type="button"
            aria-label="插入列"
            title="在选中列左侧插入一列"
            onClick={() => insertAt('column')}
          >
            <Plus size={14} />插入列
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
      <div className="worksheet-scroll" tabIndex={0} aria-label="工作表数据区域，可横向和纵向连续滚动">
        <table
          role="grid"
          aria-label={`${activeSheet} 数据表`}
          aria-rowcount={height + 4 + (extraHeaderRow ? 1 : 0)}
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
                  <td key={col.key} style={col.color ? { borderTop: `3px solid ${col.color}` } : undefined}>
                    {onMetadataChange && (!col.headerFields || col.headerFields.includes(field)) ? (
                      <input
                        aria-label={`${activeSheet} 第 ${c + 1} 列${['名称', '单位', '备注'][i]}`}
                        title="单击全选；可粘贴一行或多行单列值，按列横向填入"
                        value={col[field] ?? ''}
                        onChange={(e) => onMetadataChange(c, field, e.target.value)}
                        onFocus={(e) => e.target.select()}
                        onPaste={(e) => pasteMetadata(e, c, field)}
                      />
                    ) : (
                      <span title={col[field]}>{col[field] || '—'}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {extraHeaderRow && (
              <tr className="worksheet-label-row worksheet-extra-row">
                <th scope="row">{extraHeaderRow.label}</th>
                {columns.map((col, c) => (
                  <td key={col.key}>{extraHeaderRow.render(c)}</td>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {data.map((values, r) => {
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
                      label = cellLabel?.(r, c) ?? `${activeSheet} ${cellName(at)}`,
                      custom = renderCell?.(r, c);
                    // Native controls and custom renderCell content must keep
                    // their own focus/click/drag behaviour; only the cell body
                    // (text inputs, read-only spans) drives drag-to-select.
                    const nativeControl =
                      custom !== undefined ||
                      (!readOnly &&
                        (col.type === 'select' || col.type === 'checkbox' || col.type === 'color'));
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
                        className={`${cellInSelection(at, selection) ? 'is-selected' : ''} ${focus.row === r && focus.column === c ? (editing ? 'is-active is-editing' : 'is-active') : ''} ${readOnly ? 'is-readonly' : ''}`}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          if (!nativeControl) {
                            // Windows: pressing inside a focused / select-all text
                            // input starts the browser's native text drag, which
                            // fires dragstart + pointercancel and stops the
                            // pointerenter stream, so drag-to-select silently dies.
                            // Cancelling the default keeps the pointer stream; the
                            // layout effect then focuses the cell input manually.
                            e.preventDefault();
                          }
                          if (e.shiftKey) {
                            e.preventDefault();
                            setSelection((s) => ({ ...s, focus: at }));
                          } else {
                            setSelection({ anchor: at, focus: at });
                            if (!nativeControl) pendingFocus.current = at;
                          }
                          // Native controls keep their own interaction; only the
                          // cell body starts a drag-to-select gesture.
                          dragging.current = !nativeControl;
                          dragPointer.current = nativeControl ? null : e.pointerId;
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
                        onDoubleClick={() => {
                          if (!onChange || col.readOnly || custom !== undefined) return;
                          if (col.type === 'select' || col.type === 'checkbox' || col.type === 'color')
                            return;
                          setSelection({ anchor: at, focus: at });
                          setEditing(true);
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
                            // Never let the cell input become a native drag source.
                            draggable={false}
                            onChange={(e) => {
                              // Typing stays in navigation mode so arrows keep moving the cell.
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
        {multiSheet ? (
          <>
            <div className="worksheet-sheet-tabs" role="group" aria-label="工作表标签">
              {tabs.map((tab) => {
                const active = tab.id === activeTabId;
                if (active && renaming)
                  return (
                    <div key={tab.id} className="worksheet-sheet-tab is-active is-renaming">
                      <Table2 size={13} />
                      {renameInput}
                    </div>
                  );
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`worksheet-sheet-tab-item${active ? ' worksheet-sheet-tab is-active' : ''}`}
                    aria-pressed={active}
                    title={tab.name}
                    onClick={() => {
                      if (!active) onSelectSheet?.(tab.id);
                    }}
                    onDoubleClick={active && onRenameSheet ? startRename : undefined}
                  >
                    {tab.name}
                  </button>
                );
              })}
            </div>
            <div className="worksheet-sheet-meta">
              <div className="worksheet-sheet-actions">
                {onRenameSheet && !renaming && (
                  <button
                    type="button"
                    aria-label={`重命名标签 ${activeSheet}`}
                    title="重命名标签（也可双击活动标签）"
                    onClick={startRename}
                  >
                    <Pencil size={12} />
                  </button>
                )}
                {onCreateSheet && (
                  <button
                    type="button"
                    aria-label="新建 sheet"
                    title="新建 sheet"
                    onClick={onCreateSheet}
                  >
                    <Plus size={12} />
                  </button>
                )}
                {onDeleteSheet && (
                  <button
                    type="button"
                    aria-label="删除当前 sheet"
                    title={tabs.length > 1 ? '删除当前 sheet' : '至少保留一个 sheet'}
                    disabled={tabs.length <= 1}
                    onClick={() => {
                      if (activeTab) onDeleteSheet(activeTab.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              <span>
                {rows.length} 行 × {columns.length} 列
              </span>
            </div>
          </>
        ) : (
          <div
            className="worksheet-sheet-tab"
            onDoubleClick={onRenameSheet && !renaming ? startRename : undefined}
          >
            <Table2 size={13} />
            {renaming ? (
              renameInput
            ) : (
              <span className="worksheet-sheet-label" title={activeSheet}>
                {activeSheet}
              </span>
            )}
            {onRenameSheet && !renaming && (
              <button
                type="button"
                aria-label={`重命名标签 ${activeSheet}`}
                title="重命名标签（也可双击标签）"
                onClick={startRename}
              >
                <Pencil size={12} />
              </button>
            )}
          </div>
        )}
        {!multiSheet && (
          <span>
            {rows.length} 行 × {columns.length} 列
          </span>
        )}
      </div>
      <div className="worksheet-status" aria-live="polite">
        <span>
          {sheetError ||
            message ||
            '方向键 / Tab 移动 · F2 或双击编辑 · Backspace 逐字删除 · Delete 清空单元格 · ⌘/Ctrl+C/V 复制粘贴'}
        </span>
        <span>
          选中 {stats.cells} 格 · 数值 {stats.numeric}
          {stats.numeric > 0 && ` · 均值 ${fmt(stats.mean, 5)} · 总和 ${fmt(stats.sum, 5)}`}
        </span>
      </div>
    </div>
  );
}
