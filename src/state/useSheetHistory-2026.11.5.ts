import { useCallback, useRef, useState } from 'react';

export type SheetHistoryApi = {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** 在每次修改数据前调用；连续的结构操作各算一次记录。 */
  record: () => void;
};

/**
 * 整表撤销 / 重做：每次修改前保存一份表格数据快照，
 * 单元格编辑与插入 / 删除行列为同一条历史，批量操作只记一条。
 * 历史按 sheet 分开存放（与切换 sheet 互不干扰），不写入项目文件。
 */
export function useSheetHistory<T>(
  scope: string,
  capture: () => T,
  restore: (value: T) => void,
  limit = 40,
): SheetHistoryApi {
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const stacks = useRef(new Map<string, { past: T[]; future: T[] }>());
  const [, setTick] = useState(0);
  const stackOf = useCallback(
    (key: string) => {
      let entry = stacks.current.get(key);
      if (!entry) {
        entry = { past: [], future: [] };
        stacks.current.set(key, entry);
      }
      return entry;
    },
    [],
  );
  const record = useCallback(() => {
    const entry = stackOf(scope);
    entry.past = [...entry.past.slice(-(Math.max(1, limit) - 1)), captureRef.current()];
    entry.future = [];
    setTick((n) => n + 1);
  }, [limit, scope, stackOf]);
  const step = useCallback(
    (redo: boolean) => {
      const entry = stackOf(scope);
      const from = redo ? entry.future : entry.past;
      if (!from.length) return;
      const value = from[from.length - 1];
      from.pop();
      (redo ? entry.past : entry.future).push(captureRef.current());
      restoreRef.current(value);
      setTick((n) => n + 1);
    },
    [scope, stackOf],
  );
  const entry = stacks.current.get(scope);
  return {
    canUndo: !!entry?.past.length,
    canRedo: !!entry?.future.length,
    undo: () => step(false),
    redo: () => step(true),
    record,
  };
}
