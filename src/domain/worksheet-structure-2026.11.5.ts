/**
 * 工作表行列结构操作。
 *
 * 这里只放与具体数据模型无关的纯函数：数量归一化、网格层面的增删、
 * 删除前是否需要二次确认。页面负责把结果写回自己的工作区字段。
 */
export type WorksheetStructureAction =
  /** 在 index 之前插入 count 行（0 基）。 */
  | { type: 'insert-row'; index: number; count: number }
  /** 在末尾追加 count 行。 */
  | { type: 'append-row'; count: number }
  | { type: 'delete-row'; index: number; count: number }
  /** 在 index 之前插入 count 列（0 基）。 */
  | { type: 'insert-column'; index: number; count: number }
  | { type: 'append-column'; count: number }
  | { type: 'delete-column'; index: number; count: number };

export const STRUCTURE_LIMITS = { count: 200, rows: 100001, columns: 64 };

/** 一次操作的行/列数量：至少 1，最多 STRUCTURE_LIMITS.count。 */
export function structureCount(count: number | undefined): number {
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(STRUCTURE_LIMITS.count, Math.trunc(count as number)));
}

export function structureAxis(action: WorksheetStructureAction): 'row' | 'column' {
  return action.type.endsWith('row') ? 'row' : 'column';
}

export function structureIsDelete(action: WorksheetStructureAction): boolean {
  return action.type.startsWith('delete');
}

/** 受影响的起始行/列（0 基）；追加操作返回 -1，由页面按当前长度计算。 */
export function structureStart(action: WorksheetStructureAction): number {
  return 'index' in action ? Math.max(0, Math.trunc(action.index)) : -1;
}

export function structureLabel(action: WorksheetStructureAction): string {
  const count = structureCount(action.count);
  switch (action.type) {
    case 'insert-row':
      return `插入 ${count} 行`;
    case 'append-row':
      return `末尾新增 ${count} 行`;
    case 'delete-row':
      return `删除 ${count} 行`;
    case 'insert-column':
      return `插入 ${count} 列`;
    case 'append-column':
      return `末尾新增 ${count} 列`;
    case 'delete-column':
      return `删除 ${count} 列`;
  }
}

function normalizeGrid(rows: string[][]): string[][] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) =>
    Array.from({ length: width }, (_, column) => String(row[column] ?? '')),
  );
}

/** 在 index 之前插入空行；超过行数上限时抛出中文原因。 */
export function insertGridRows(
  rows: string[][],
  index: number,
  count: number,
): string[][] {
  const grid = normalizeGrid(rows);
  const amount = structureCount(count);
  const at = Math.max(0, Math.min(Math.trunc(index), grid.length));
  if (grid.length + amount > STRUCTURE_LIMITS.rows)
    throw new Error('工作表已达到行数上限');
  const width = Math.max(1, grid[0]?.length ?? 1);
  return [
    ...grid.slice(0, at),
    ...Array.from({ length: amount }, () => Array.from({ length: width }, () => '')),
    ...grid.slice(at),
  ];
}

export function deleteGridRows(rows: string[][], index: number, count: number): string[][] {
  const grid = normalizeGrid(rows);
  const at = Math.max(0, Math.min(Math.trunc(index), grid.length));
  const amount = Math.min(structureCount(count), grid.length - at);
  return [...grid.slice(0, at), ...grid.slice(at + amount)];
}

export function insertGridColumns(
  rows: string[][],
  index: number,
  count: number,
): string[][] {
  const grid = normalizeGrid(rows);
  const amount = structureCount(count);
  const width = Math.max(1, grid[0]?.length ?? 1);
  const at = Math.max(0, Math.min(Math.trunc(index), width));
  if (width + amount > STRUCTURE_LIMITS.columns)
    throw new Error(`工作表最多 ${STRUCTURE_LIMITS.columns} 列`);
  return grid.map((row) => [
    ...row.slice(0, at),
    ...Array.from({ length: amount }, () => ''),
    ...row.slice(at),
  ]);
}

export function deleteGridColumns(rows: string[][], index: number, count: number): string[][] {
  const grid = normalizeGrid(rows);
  const width = Math.max(1, grid[0]?.length ?? 1);
  const at = Math.max(0, Math.min(Math.trunc(index), width));
  const amount = Math.min(structureCount(count), width - at);
  return grid.map((row) => [...row.slice(0, at), ...row.slice(at + amount)]);
}

/** 行/列索引在删除后如何移动：落在删除区间内用 -1 表示已消失。 */
export function remapIndex(index: number, start: number, count: number): number {
  if (index < start) return index;
  if (index >= start + count) return index - count;
  return -1;
}

/**
 * 删除前是否需要二次确认：批量删除、或删除区域包含较多已有数据时提示。
 * 空白的少量行/列直接删除，避免每次操作都弹窗。
 */
export function needsDeleteConfirm(
  action: WorksheetStructureAction,
  rows: string[][],
): boolean {
  if (!structureIsDelete(action)) return false;
  const start = structureStart(action);
  const count = structureCount(action.count);
  const axis = structureAxis(action);
  if (axis === 'row' ? count >= 20 : count >= 4) return true;
  const grid = normalizeGrid(rows);
  const width = grid[0]?.length ?? 0;
  let filled = 0;
  if (axis === 'row') {
    for (let row = start; row < Math.min(grid.length, start + count); row++)
      for (let column = 0; column < width; column++)
        if (String(grid[row]?.[column] ?? '').trim()) filled++;
  } else {
    for (const row of grid)
      for (let column = start; column < Math.min(width, start + count); column++)
        if (String(row[column] ?? '').trim()) filled++;
  }
  return filled >= 50;
}

export function deleteConfirmMessage(action: WorksheetStructureAction): string {
  const count = structureCount(action.count);
  const unit = structureAxis(action) === 'row' ? '行' : '列';
  return `将删除 ${count} ${unit}及其中的数据（可用「撤销」恢复）。确定继续？`;
}

