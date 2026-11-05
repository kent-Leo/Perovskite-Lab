import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Table2, Copy, ClipboardPaste, Plus, Undo2, Redo2, Pencil, Trash2 } from 'lucide-react';
import { fmt, numeric } from '../domain/math';
import {
  WORKSHEET_VERSION,
  WORKSHEET_LIMITS,
  cellName,
  columnLetter,
  selectionName,
  selectionBounds,
  selectionStats,
  pasteOrigin,
  columnSelection,
  rowSelection,
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
import {
  deleteConfirmMessage,
  needsDeleteConfirm,
  structureAxis,
  structureCount,
  structureStart,
  type WorksheetStructureAction,
} from '../domain/worksheet-structure-2026.11.5';
import { isDesktopApp } from '../services/desktop-project-2026.11.4';
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
  /** 插入 / 追加 / 删除行或列；由页面把结果写回自己的数据模型。 */
  onStructure?: (action: WorksheetStructureAction) => void;
  /** 返回禁用原因（显示在菜单里）；返回 null 表示允许该结构操作。 */
  canStructure?: (action: WorksheetStructureAction) => string | null;
  cellLabel?: (row: number, column: number) => string;
  invalidCell?: (row: number, column: number) => boolean;
  renderCell?: (row: number, column: number) => ReactNode | undefined;
  // Extra editable header row shown below 名称 / 单位 / 备注 (for example colors).
  extraHeaderRow?: { label: string; render: (column: number) => ReactNode };
  minRows?: number;
  /** Optional whole-document history, including probe / row structure changes. */
  externalHistory?: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
};
type ContextMenuState = {
  x: number;
  y: number;
  /** 右键落在哪一类表头/单元格上，决定菜单里默认出现哪些操作。 */
  kind: 'row' | 'column' | 'cell';
  selection: CellSelection;
  /** 菜单打开时用于摆放子菜单的方向。 */
  flip: boolean;
}
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
  onStructure,
  canStructure,
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
    autoScroll = useRef<{ raf: number; x: number; y: number; dx: number; dy: number } | null>(null),
    rowDragging = useRef<number | null>(null),
    headerDrag = useRef<{ kind: 'column' | 'row'; start: number } | null>(null),
    headerDragMoved = useRef(false),
    navigating = useRef(false),
    pendingFocus = useRef<CellAddress | null>(null);
  const [selection, setSelection] = useState<CellSelection>({
    anchor: firstCell,
    focus: firstCell,
  });
  /** 选区是怎么来的：右键行号 / 列标时只有整行 / 整列选区才保留批量范围。 */
  const selectionOrigin = useRef<'row' | 'column' | 'cell'>('cell');
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
    //
    // 指针拖到表格外时不能就此停住：把命中点夹到最近的边缘，选区继续朝
    // 鼠标方向延伸到首行/末行、首列/末列，和 Excel 的手感一致。
    // elementsFromPoint 让粘性表头 / 行号列下面被遮住的单元格也能命中。
    const cellAt = (x: number, y: number) => {
      for (const hit of document.elementsFromPoint(x, y)) {
        if (!root.current?.contains(hit)) continue;
        const at = cellFromAttr(hit.closest('[data-cell]')?.getAttribute('data-cell'));
        if (at) return at;
      }
      return null;
    };
    const surfaceOf = () =>
      root.current?.querySelector<HTMLElement>('.worksheet-scroll') ?? null;
    const extendTo = (clientX: number, clientY: number) => {
      const surface = surfaceOf();
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // 18px 内缩用于避开滚动条本体；再按窗口裁一次，容器超出窗口时仍能命中。
      const x = Math.min(
        Math.max(clientX, rect.left + 2, 0),
        rect.right - 18,
        window.innerWidth - 1,
      );
      const y = Math.min(
        Math.max(clientY, rect.top + 2, 0),
        rect.bottom - 18,
        window.innerHeight - 1,
      );
      const at = cellAt(x, y) ?? cellAt(clientX, y) ?? cellAt(x, clientY);
      if (!at) return;
      selectionOrigin.current = 'cell';
      setSelection((s) =>
        s.focus.row === at.row && s.focus.column === at.column ? s : { ...s, focus: at },
      );
    };
    // Excel 式边缘自动滚动：进入 26px 内按距离给速度，越出视口越多滚得越快。
    const EDGE = 26,
      MAX_STEP = 26;
    const velocity = (clientX: number, clientY: number) => {
      const surface = surfaceOf();
      if (!surface) return { dx: 0, dy: 0 };
      const rect = surface.getBoundingClientRect(),
        // 容器可能比窗口高：边缘按可见区域收拢，否则底部永远进不了触发区。
        left = Math.max(rect.left + 2, 0),
        top = Math.max(rect.top + 2, 0),
        right = Math.min(rect.right - 18, window.innerWidth - 1),
        bottom = Math.min(rect.bottom - 18, window.innerHeight - 1),
        step = (distance: number) => MAX_STEP * Math.min(1, distance / EDGE);
      const nearLeft = left + EDGE - clientX,
        nearRight = clientX - (right - EDGE),
        nearTop = top + EDGE - clientY,
        nearBottom = clientY - (bottom - EDGE);
      return {
        dx: nearRight > 0 ? step(nearRight) : nearLeft > 0 ? -step(nearLeft) : 0,
        dy: nearBottom > 0 ? step(nearBottom) : nearTop > 0 ? -step(nearTop) : 0,
      };
    };
    function stopAutoScroll() {
      if (!autoScroll.current) return;
      cancelAnimationFrame(autoScroll.current.raf);
      autoScroll.current = null;
    }
    function tick() {
      const state = autoScroll.current,
        surface = surfaceOf();
      if (!state || !dragging.current || !surface) {
        stopAutoScroll();
        return;
      }
      const left = surface.scrollLeft,
        top = surface.scrollTop;
      if (state.dx) surface.scrollLeft = left + state.dx;
      if (state.dy) surface.scrollTop = top + state.dy;
      extendTo(state.x, state.y);
      // 到达边界后不再空转；下一次 pointermove 会重新启动滚动循环。
      if (surface.scrollLeft === left && surface.scrollTop === top) {
        autoScroll.current = null;
        return;
      }
      state.raf = requestAnimationFrame(tick);
    }
    const extend = (e: PointerEvent) => {
      if (!dragging.current || e.buttons !== 1) return;
      if (dragPointer.current !== null && e.pointerId !== dragPointer.current) return;
      extendTo(e.clientX, e.clientY);
      const { dx, dy } = velocity(e.clientX, e.clientY);
      if (!dx && !dy) {
        stopAutoScroll();
        return;
      }
      if (autoScroll.current)
        Object.assign(autoScroll.current, { x: e.clientX, y: e.clientY, dx, dy });
      else {
        autoScroll.current = { raf: 0, x: e.clientX, y: e.clientY, dx, dy };
        autoScroll.current.raf = requestAnimationFrame(tick);
      }
    };
    const stop = () => {
      dragging.current = false;
      dragPointer.current = null;
      stopAutoScroll();
    };
    window.addEventListener('pointermove', extend);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    // 指针在窗口外松开时收不到 pointerup，失焦也必须停止自动滚动。
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointermove', extend);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      stopAutoScroll();
    };
  }, []);
  useEffect(() => {
    // Excel 式连选：按住列标或行号拖动，一次选中多列 / 多行。
    const move = (e: PointerEvent) => {
      const drag = headerDrag.current;
      if (!drag || e.buttons !== 1) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (!(hit instanceof Element)) return;
      if (drag.kind === 'column') {
        const raw = hit.closest('[data-col]')?.getAttribute('data-col');
        if (raw == null) return;
        const column = Number(raw),
          from = Math.min(drag.start, column),
          to = Math.max(drag.start, column);
        if (to !== from) headerDragMoved.current = true;
        selectionOrigin.current = 'column';
        setSelection({
          anchor: { row: 0, column: from },
          focus: { row: Math.max(0, height - 1), column: to },
        });
        setEditing(false);
        return;
      }
      const raw = hit.closest('[data-row]')?.getAttribute('data-row');
      if (raw == null) return;
      const row = Number(raw),
        from = Math.min(drag.start, row),
        to = Math.max(drag.start, row);
      if (to !== from) headerDragMoved.current = true;
      selectionOrigin.current = 'row';
      setSelection({
        anchor: { row: from, column: 0 },
        focus: { row: to, column: Math.max(0, columns.length - 1) },
      });
      setEditing(false);
    };
    const stop = () => {
      headerDrag.current = null;
      window.setTimeout(() => {
        headerDragMoved.current = false;
      }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [height, columns.length]);
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
    // 页面接管了整表历史时不再重复保存一份行快照。
    if (!externalHistory) {
      history.current.past.push(rows.map((row) => [...row]));
      const limit = Math.max(
        1,
        Math.min(20, Math.floor(1000000 / Math.max(1, next.length * columns.length))),
      );
      history.current.past = history.current.past.slice(-limit);
      history.current.future = [];
    }
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
    selectionOrigin.current = 'cell';
    const next = {
      row: Math.max(0, Math.min(height - 1, at.row)),
      column: Math.max(0, Math.min(columns.length - 1, at.column)),
    };
    setSelection((s) => ({ anchor: extend ? s.anchor : next, focus: next }));
    setEditing(false);
    pendingFocus.current = next;
  }
  /** Excel 式整列选中；extend 时保留锚点所在列，从而 Shift 连选多列。 */
  function selectColumn(column: number, extend = false) {
    selectionOrigin.current = 'column';
    setSelection((s) => columnSelection(column, height, extend ? s.anchor.column : column));
    setEditing(false);
  }
  /** Excel 式整行选中；extend 时保留锚点所在行。 */
  function selectRow(row: number, extend = false) {
    selectionOrigin.current = 'row';
    setSelection((s) => rowSelection(row, columns.length, extend ? s.anchor.row : row));
    setEditing(false);
  }
  /** Enter edit mode with the caret after the current text (collapsing a select-all). */
  function editAtEnd(input: HTMLInputElement) {
    const end = input.value.length;
    input.setSelectionRange(end, end);
    setEditing(true);
  }
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [submenu, setSubmenu] = useState<'row' | 'column' | null>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const editable = !!onChange || !!onPaste;

  /** 结构操作是否可用：页面给出的原因优先，其次要求工作表可编辑。 */
  function structureReason(action: WorksheetStructureAction): string | null {
    if (!onStructure) return '当前工作表不支持结构修改';
    return canStructure?.(action) ?? null;
  }
  function runStructure(action: WorksheetStructureAction) {
    if (!onStructure) return;
    const reason = structureReason(action);
    if (reason) {
      setMessage(reason);
      closeMenu();
      return;
    }
    if (needsDeleteConfirm(action, data) && !window.confirm(deleteConfirmMessage(action))) return;
    try {
      onStructure(action);
      followStructure(action);
      setMessage('');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setEditing(false);
      closeMenu();
    }
  }
  /** 插入后选中新行/列，删除后落到原位置的下一个，方便继续录入。 */
  function followStructure(action: WorksheetStructureAction) {
    const amount = structureCount(action.count);
    const start = structureStart(action);
    const isRow = structureAxis(action) === 'row';
    const last = (isRow ? height : columns.length) - 1;
    if (action.type.startsWith('delete')) {
      const next = Math.max(0, Math.min(start, last - amount + 1));
      setSelection(
        isRow
          ? rowSelection(next, columns.length)
          : columnSelection(next, height),
      );
      pendingFocus.current = { row: isRow ? next : selection.focus.row, column: isRow ? selection.focus.column : next };
    } else {
      const from = action.type.startsWith('append') ? last + 1 : start;
      const to = from + amount - 1;
      setSelection(
        isRow
          ? { anchor: { row: from, column: 0 }, focus: { row: to, column: Math.max(0, columns.length - 1) } }
          : { anchor: { row: 0, column: from }, focus: { row: Math.max(0, height - 1), column: to } },
      );
      pendingFocus.current = { row: isRow ? from : selection.focus.row, column: isRow ? selection.focus.column : from };
    }
    setFocusRequest((n) => n + 1);
  }
  function closeMenu() {
    setMenu(null);
    setSubmenu(null);
  }
  useEffect(() => {
    if (!menu) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && menuRoot.current?.contains(event.target)) return;
      closeMenu();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('blur', closeMenu);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('blur', closeMenu);
    };
  }, [menu]);
  // 菜单渲染后按实际尺寸夹回视口，避免贴近屏幕边缘时被裁掉。
  useLayoutEffect(() => {
    const node = menuRoot.current;
    if (!menu || !node) return;
    const rect = node.getBoundingClientRect();
    const x = Math.min(menu.x, Math.max(8, window.innerWidth - rect.width - 8));
    const y = Math.min(menu.y, Math.max(8, window.innerHeight - rect.height - 8));
    if (x !== menu.x || y !== menu.y)
      setMenu((current) => (current ? { ...current, x, y } : current));
  }, [menu]);
  /**
   * 右键：落在当前选区内保留选区，落在选区外则更新选中目标。
   * 与 Excel 一致，右键行号 / 列标总是落到整行 / 整列；只有选区本身就是整行 / 整列时才保留批量选择。
   */
  function openMenu(event: ReactMouseEvent, kind: ContextMenuState['kind'], at: CellAddress) {
    event.preventDefault();
    event.stopPropagation();
    const inside =
      at.row >= bounds.top && at.row <= bounds.bottom && at.column >= bounds.left && at.column <= bounds.right;
    const keep =
      kind === 'row'
        ? selectionOrigin.current === 'row' && inside
        : kind === 'column'
          ? selectionOrigin.current === 'column' && inside
          : inside;
    let next = selection;
    if (!keep) {
      next =
        kind === 'row'
          ? rowSelection(at.row, columns.length)
          : kind === 'column'
            ? columnSelection(at.column, height)
            : { anchor: at, focus: at };
      selectionOrigin.current = kind;
      setSelection(next);
      setEditing(false);
    }
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - 236));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - 300));
    setMenu({ x, y, kind, selection: next, flip: event.clientX > window.innerWidth * 0.6 });
    setSubmenu(null);
  }
  /** 菜单当前作用的行范围：选区覆盖多行时按整块处理。 */
  function menuRows(state: ContextMenuState) {
    const b = selectionBounds(state.selection);
    return { start: b.top, count: b.bottom - b.top + 1 };
  }
  function menuColumns(state: ContextMenuState) {
    const b = selectionBounds(state.selection);
    return { start: b.left, count: b.right - b.left + 1 };
  }
  function menuCopy(state: ContextMenuState) {
    const text = copyWorksheetRange(data, state.selection);
    closeMenu();
    void navigator.clipboard
      .writeText(text)
      .then(() => setMessage('已复制到剪贴板'))
      .catch(() => setMessage('请使用 ⌘C / Ctrl+C 复制选区'));
  }
  function menuPaste(state: ContextMenuState) {
    const origin = pasteOrigin(state.selection);
    closeMenu();
    void navigator.clipboard
      .readText()
      .then((text) => paste(text, origin))
      .catch(() => setMessage('浏览器未允许读取剪贴板，请使用 ⌘V / Ctrl+V 粘贴'));
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
  /** Excel 式粘贴起点：矩形选区左上角，因此反向框选与正向框选结果一致。 */
  function paste(text: string, at?: CellAddress) {
    const origin: CellAddress = at ?? pasteOrigin(selection);
    try {
      if (onPaste) {
        onPaste(text, origin);
        setMessage('');
        return;
      }
      if (!onChange) throw new Error('此工作表为只读结果');
      const result = preparePaste
        ? preparePaste(text, origin)
        : pasteWorksheetRange(data, columns, origin, text);
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
      selectionOrigin.current = 'cell';
      setSelection({ anchor: firstCell, focus: { row: height - 1, column: columns.length - 1 } });
      return;
    }
    if (e.key === 'Escape') {
      setEditing(false);
      selectionOrigin.current = 'cell';
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
  // 选区覆盖整列 / 整行时高亮对应表头，供 Excel 式连选反馈。
  const bounds = selectionBounds(selection),
    wholeColumns = bounds.top === 0 && bounds.bottom === height - 1,
    wholeRows = bounds.left === 0 && bounds.right === columns.length - 1;
  // 固定列页面（对象筛选 / 校准 / 梯度）不渲染列结构按钮；桌面端整体迁到右键菜单。
  const insertRowReason = canStructure?.({ type: 'insert-row', index: bounds.top, count: 1 });
  const appendRowReason = canStructure?.({ type: 'append-row', count: 1 });
  const insertColumnReason = canStructure?.({ type: 'insert-column', index: bounds.left, count: 1 });
  const appendColumnReason = canStructure?.({ type: 'append-column', count: 1 });
  const rowTools = !!onStructure && (!insertRowReason || !appendRowReason);
  const columnTools = !!onStructure && (!insertColumnReason || !appendColumnReason);
  // 选区落在不允许插入的位置（例如多探针表的必需列）时，退回到末尾追加，保持旧入口可用。
  const insertRowAction: WorksheetStructureAction = insertRowReason
    ? { type: 'append-row', count: 1 }
    : { type: 'insert-row', index: bounds.top, count: 1 };
  const insertColumnAction: WorksheetStructureAction = insertColumnReason
    ? { type: 'append-column', count: 1 }
    : { type: 'insert-column', index: bounds.left, count: 1 };
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
            {/* 桌面端把插入 / 新增迁到右键菜单，浏览器保留工具栏入口。 */}
            {!isDesktopApp && allowAddRows && (
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
        {!isDesktopApp && columnTools && (
          <button type="button" onClick={() => runStructure({ type: 'append-column', count: 1 })}>
            <Plus size={14} />列
          </button>
        )}
        {!isDesktopApp && (columnTools || rowTools) && <span className="worksheet-separator" />}
        {!isDesktopApp && rowTools && (
          <button
            type="button"
            aria-label="插入行"
            title="在选中行上方插入一行"
            onClick={() => runStructure(insertRowAction)}
          >
            <Plus size={14} />插入行
          </button>
        )}
        {!isDesktopApp && columnTools && (
          <button
            type="button"
            aria-label="插入列"
            title="在选中列左侧插入一列"
            onClick={() => runStructure(insertColumnAction)}
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
              <th className={`worksheet-corner${wholeColumns && wholeRows ? ' is-selected' : ''}`}>
                <button
                  type="button"
                  aria-label="选择整个工作表"
                  onClick={() => {
                    setSelection({
                      anchor: firstCell,
                      focus: {
                        row: Math.max(0, height - 1),
                        column: Math.max(0, columns.length - 1),
                      },
                    });
                    setEditing(false);
                  }}
                >
                  ▦
                </button>
              </th>
              {columns.map((col, c) => (
                <th
                  scope="col"
                  key={col.key}
                  data-col={c}
                  onContextMenu={(e) => openMenu(e, 'column', { row: 0, column: c })}
                  className={
                    wholeColumns && c >= bounds.left && c <= bounds.right ? 'is-selected' : undefined
                  }
                >
                  <button
                    type="button"
                    aria-label={`选择 ${columnLetter(c)} 列`}
                    title="单击选中整列，按住拖动或 Shift+单击可连选多列"
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      headerDragMoved.current = false;
                      headerDrag.current = { kind: 'column', start: c };
                    }}
                    onClick={(e) => {
                      if (headerDragMoved.current) return;
                      selectColumn(c, e.shiftKey);
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
                  <th
                    scope="row"
                    data-row={r}
                    onContextMenu={(e) => openMenu(e, 'row', { row: r, column: 0 })}
                    className={
                      wholeRows && r >= bounds.top && r <= bounds.bottom ? 'is-selected' : undefined
                    }
                  >
                    <button
                      type="button"
                      aria-label={`选择第 ${r + 1} 行`}
                      draggable={!!onMoveRow && r < rows.length}
                      title={
                        onMoveRow
                          ? '单击选中整行；拖动行号调整顺序'
                          : '单击选中整行，按住拖动或 Shift+单击可连选多行'
                      }
                      onPointerDown={(e) => {
                        // 行号在本表里是拖拽排序把手，交给原生 DnD；其余情况才支持连选。
                        if (e.button !== 0 || (onMoveRow && r < rows.length)) return;
                        headerDragMoved.current = false;
                        headerDrag.current = { kind: 'row', start: r };
                      }}
                      onDragStart={(e) => {
                        rowDragging.current = r;
                        e.dataTransfer.setData('text/plain', String(r + 1));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        rowDragging.current = null;
                      }}
                      onClick={(e) => {
                        if (headerDragMoved.current) return;
                        selectRow(r, e.shiftKey);
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
                    // 选区按预先算好的 bounds 比较，拖拽时不重新计算矩形。
                    const selected =
                      r >= bounds.top && r <= bounds.bottom && c >= bounds.left && c <= bounds.right;
                    // Excel 式连续外框：矩形四条边各画 2px 蓝线，内部只保留浅蓝底色。
                    const edges =
                      (selected && r === bounds.top ? ' is-range-top' : '') +
                      (selected && r === bounds.bottom ? ' is-range-bottom' : '') +
                      (selected && c === bounds.left ? ' is-range-left' : '') +
                      (selected && c === bounds.right ? ' is-range-right' : '');
                    return (
                      <td
                        key={col.key}
                        role="gridcell"
                        tabIndex={readOnly ? 0 : -1}
                        aria-selected={selected}
                        aria-readonly={readOnly || undefined}
                        aria-invalid={invalid || undefined}
                        data-cell={`${r}:${c}`}
                        className={`${selected ? 'is-selected' : ''}${edges} ${focus.row === r && focus.column === c ? (editing ? 'is-active is-editing' : 'is-active') : ''} ${readOnly ? 'is-readonly' : ''}`}
                        onContextMenu={(e) => openMenu(e, 'cell', at)}
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
                            selectionOrigin.current = 'cell';
                            setSelection((s) => ({ ...s, focus: at }));
                          } else {
                            selectionOrigin.current = 'cell';
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
                          // 只在坐标真的变化时更新状态，避免同一格重复渲染。
                          if (!dragging.current || e.buttons !== 1) return;
                          setSelection((s) =>
                            s.focus.row === r && s.focus.column === c ? s : { ...s, focus: at },
                          );
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
                          // 真实粘贴事件只会在活动单元格上触发，此时起点取选区左上角，
                          // 反向框选与正向框选结果一致；事件来自其它单元格时以该单元格为准。
                          const active = focus.row === r && focus.column === c;
                          paste(e.clipboardData.getData('text/plain'), active ? undefined : at);
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
            '方向键 / Tab 移动 · F2 或双击编辑 · Backspace 逐字删除 · Delete 清空单元格 · ⌘/Ctrl+C/V 复制粘贴 · 单击行号/列标选中整行整列，拖动连选'}
        </span>
        <span>
          选中 {stats.cells} 格 · 数值 {stats.numeric}
          {stats.numeric > 0 && ` · 均值 ${fmt(stats.mean, 5)} · 总和 ${fmt(stats.sum, 5)}`}
        </span>
      </div>
      {menu &&
        createPortal(
          <div
            ref={menuRoot}
            className="worksheet-context"
            role="menu"
            aria-label="工作表行列操作"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {(() => {
              const rowsRange = menuRows(menu),
                colsRange = menuColumns(menu),
                rowItems: { label: string; action: WorksheetStructureAction }[] = [
                  {
                    label: `在上方插入 ${rowsRange.count} 行`,
                    action: { type: 'insert-row', index: rowsRange.start, count: rowsRange.count },
                  },
                  {
                    label: `在下方插入 ${rowsRange.count} 行`,
                    action: {
                      type: 'insert-row',
                      index: rowsRange.start + rowsRange.count,
                      count: rowsRange.count,
                    },
                  },
                  { label: '在末尾新增 1 行', action: { type: 'append-row', count: 1 } },
                ],
                columnItems: { label: string; action: WorksheetStructureAction }[] = [
                  {
                    label: `在左侧插入 ${colsRange.count} 列`,
                    action: { type: 'insert-column', index: colsRange.start, count: colsRange.count },
                  },
                  {
                    label: `在右侧插入 ${colsRange.count} 列`,
                    action: {
                      type: 'insert-column',
                      index: colsRange.start + colsRange.count,
                      count: colsRange.count,
                    },
                  },
                  { label: '在末尾新增 1 列', action: { type: 'append-column', count: 1 } },
                ],
                rowDelete: WorksheetStructureAction = {
                  type: 'delete-row',
                  index: rowsRange.start,
                  count: rowsRange.count,
                },
                columnDelete: WorksheetStructureAction = {
                  type: 'delete-column',
                  index: colsRange.start,
                  count: colsRange.count,
                },
                rowReason = structureReason(rowDelete),
                columnReason = structureReason(columnDelete),
                insertRowReason = rowItems
                  .map((item) => structureReason(item.action))
                  .find((reason) => reason !== null),
                insertColumnReason = columnItems
                  .map((item) => structureReason(item.action))
                  .find((reason) => reason !== null);
              const group = (
                title: string,
                key: 'row' | 'column',
                items: { label: string; action: WorksheetStructureAction }[],
                reason: string | null | undefined,
              ) => (
                <div className="worksheet-context-group">
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={submenu === key}
                    aria-label={title}
                    className="worksheet-context-parent"
                    disabled={!onStructure || items.every((item) => !!structureReason(item.action))}
                    title={reason ?? undefined}
                    onMouseEnter={() => setSubmenu(key)}
                    onClick={() => setSubmenu(key)}
                  >
                    {title}
                    <span aria-hidden>▸</span>
                  </button>
                  {submenu === key && (
                    <div
                      className={`worksheet-context-submenu${menu.flip ? ' is-flip' : ''}`}
                      role="menu"
                      aria-label={title}
                    >
                      {items.map((item) => {
                        const itemReason = structureReason(item.action);
                        return (
                          <button
                            key={item.label}
                            type="button"
                            role="menuitem"
                            disabled={!!itemReason}
                            title={itemReason ?? undefined}
                            onClick={() => runStructure(item.action)}
                          >
                            <span>{item.label}</span>
                            {itemReason && <small>{itemReason}</small>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
              return (
                <>
                  <button type="button" role="menuitem" onClick={() => menuCopy(menu)}>
                    <Copy size={13} />
                    复制
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!editable}
                    title={editable ? '粘贴到选区左上角' : '只读结果表不能粘贴'}
                    onClick={() => menuPaste(menu)}
                  >
                    <ClipboardPaste size={13} />
                    粘贴
                  </button>
                  <div className="worksheet-context-sep" role="separator" />
                  {/* 行号只给行操作，列标只给列操作，单元格两者都给。 */}
                  {menu.kind !== 'column' && group('插入行', 'row', rowItems, insertRowReason)}
                  {menu.kind !== 'row' &&
                    group('插入列', 'column', columnItems, insertColumnReason)}
                  <div className="worksheet-context-sep" role="separator" />
                  {menu.kind !== 'column' && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!!rowReason}
                      title={rowReason ?? undefined}
                      onClick={() => runStructure(rowDelete)}
                    >
                      <Trash2 size={13} />
                      <span>删除 {rowDelete.count} 行</span>
                      {rowReason && <small>{rowReason}</small>}
                    </button>
                  )}
                  {menu.kind !== 'row' && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!!columnReason}
                      title={columnReason ?? undefined}
                      onClick={() => runStructure(columnDelete)}
                    >
                      <Trash2 size={13} />
                      <span>删除 {columnDelete.count} 列</span>
                      {columnReason && <small>{columnReason}</small>}
                    </button>
                  )}
                </>
              );
            })()}
          </div>,
          document.body,
        )}
    </div>
  );
}
