import { useCallback } from 'react';
import {
  activeTabOf,
  createSheet,
  deleteSheet,
  MAX_SHEETS,
  renameSheet,
  setActiveSheetChartTitle,
  sheetSnapshots,
  switchSheet,
  workbookOf,
  type SheetSnapshot,
} from '../domain/workbook';
import type { WorkbookId, WorkbookTab } from '../domain/types';
import { useWorkspace } from './workspace';

export interface WorkbookApi {
  tabs: WorkbookTab[];
  activeId: string;
  activeName: string;
  /** Chart title stored on the active sheet; blank falls back to the page default. */
  chartTitle: string;
  /** Payload of every tab (active one captured from the top-level fields). */
  snapshots: SheetSnapshot[];
  canCreate: boolean;
  select: (id: string) => void;
  create: () => void;
  rename: (name: string) => void;
  setChartTitle: (title: string) => void;
  remove: (id: string) => void;
}

/** Multi-sheet workbook state for one table area. */
export function useWorkbook(page: WorkbookId): WorkbookApi {
  const { w, update, notify } = useWorkspace();
  const workbook = workbookOf(w, page);
  const active = activeTabOf(w, page);
  const select = useCallback(
    (id: string) => {
      const current = workbookOf(w, page);
      if (id === current.activeId || !current.tabs.some((tab) => tab.id === id)) return;
      update((prev) => switchSheet(prev, page, id));
    },
    [w, page, update],
  );
  const create = useCallback(() => {
    if (workbookOf(w, page).tabs.length >= MAX_SHEETS) {
      notify(`每个表格最多 ${MAX_SHEETS} 个 sheet`);
      return;
    }
    update((prev) => createSheet(prev, page));
  }, [w, page, update, notify]);
  const rename = useCallback(
    (name: string) => {
      update((prev) => renameSheet(prev, page, name));
    },
    [page, update],
  );
  const setChartTitle = useCallback(
    (title: string) => {
      update((prev) => setActiveSheetChartTitle(prev, page, title));
    },
    [page, update],
  );
  const remove = useCallback(
    (id: string) => {
      if (workbookOf(w, page).tabs.length <= 1) {
        notify('至少保留一个 sheet');
        return;
      }
      update((prev) => {
        const patch = deleteSheet(prev, page, id);
        if (!patch.workbooks?.[page]) return patch;
        const sheetMetadata = { ...prev.sheetMetadata };
        delete sheetMetadata[id];
        return { ...patch, sheetMetadata };
      });
    },
    [w, page, update, notify],
  );
  return {
    tabs: workbook.tabs,
    activeId: active.id,
    activeName: active.name,
    chartTitle: active.chartTitle ?? '',
    snapshots: sheetSnapshots(w, page),
    canCreate: workbook.tabs.length < MAX_SHEETS,
    select,
    create,
    rename,
    setChartTitle,
    remove,
  };
}
