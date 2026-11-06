import { useMemo, useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Upload } from 'lucide-react';
import { useWorkspace } from '../state/workspace';
import { useSheetHistory } from '../state/useSheetHistory-2026.11.5';
import { useWorkbook } from '../state/useWorkbook';
import {
  roles,
  responses,
  uid,
  type ChartStyle,
  type ObjectRow,
  type GroupedBarSheet,
  type ScreeningChartType,
  type PlotData,
  type ResponseMode,
  type Role,
} from '../domain/types';
import { numeric, response, fmt, units } from '../domain/math';
import {
  PlotSheetBar,
  SheetChartGallery,
  type PlotViewMode,
  type SheetGalleryChart,
} from '../components/SheetPlotPanel-v0.5.5-2026.10.22';
import { ChartPanel } from '../components/ChartPanel';
import { ErrorNote, Field, Metric, SectionHead } from '../components/ui';
import { WorkspaceWorksheet as Worksheet } from '../components/WorkspaceWorksheet-v0.3.1-2026.10.19';
import type { WorksheetColumn } from '../domain/worksheet-v0.2.0-2026.10.19';
import {
  structureAxis,
  structureCount,
  structureStart,
  type WorksheetStructureAction,
} from '../domain/worksheet-structure-2026.11.5';
import { sheetChartTitle, type ScreeningSheetPayload } from '../domain/workbook';
import { exportExcel } from '../services/download';
import { defaultGroupedBar, groupedPlotData } from '../domain/grouped-bar-2026.11.6';
import { GroupedScreening, type GroupedChange } from './GroupedScreening-2026.11.6';
import './GroupedScreening-2026.11.6.css';

/** Page default chart title used when a sheet has no title of its own. */
const BASE_TITLE = '分析对象筛选';

interface ScreeningChartResult {
  /** 与 objects 同序的响应值；计算失败时为空数组。 */
  values: number[];
  /** 空白参考强度 F₀；未指定/无效时为 NaN。 */
  f0: number;
  /** 分类柱状图数据；无对象或计算失败时为 null（画廊显示空状态）。 */
  data: PlotData | null;
  error: string;
}

/**
 * 单个 sheet 的响应值与分类柱状图数据（纯函数）。
 * 当前活动 sheet 的图表与「全部 sheet」画廊共用，保证两处计算一致；
 * payload 来自该 sheet 的 ScreeningSheetPayload，不能读取其他 sheet 的顶层字段。
 */
function screeningChart(payload: ScreeningSheetPayload, style: ChartStyle): ScreeningChartResult {
  try {
    if (payload.screeningChartType === 'grouped') {
      const grouped = payload.groupedScreening;
      return { values: [], f0: NaN, data: grouped ? groupedPlotData(grouped) : null, error: '' };
    }
    const blank = payload.objects.find((o) => o.id === payload.blankId),
      f0 = numeric(blank?.intensity) ?? NaN;
    const values = payload.objects.map((o) => {
      const f = numeric(o.intensity);
      if (!o.name.trim()) throw new Error('请填写所有分析对象的名称');
      if (f === null) throw new Error(`${o.name} 的强度不是有效数值`);
      return response(f, f0, payload.screenMode);
    });
    const data: PlotData | null = payload.objects.length
      ? {
          categories: payload.objects.map((o) => o.name),
          series: payload.objects.map((o, i) => ({
            name: o.name,
            color:
              o.role === 'target'
                ? (style.secondaryColor ?? '#b6873f')
                : o.id === payload.blankId
                  ? '#a7b8b3'
                  : (style.primaryColor ?? '#258873'),
            kind: 'bar' as const,
            points: [{ x: i, y: values[i] }],
          })),
        }
      : null;
    return { values, f0, data, error: '' };
  } catch (e) {
    return { values: [], f0: NaN, data: null, error: (e as Error).message };
  }
}

export function Screening({ onImport }: { onImport: () => void }) {
  const { w, update, notify } = useWorkspace();
  const wb = useWorkbook('screening');
  const [viewMode, setViewMode] = useState<PlotViewMode>('active');
  const isGrouped = w.screeningChartType === 'grouped';
  const group = useMemo(() => w.groupedScreening ?? defaultGroupedBar(), [w.groupedScreening]);
  // 整表撤销 / 重做：单元格编辑与行列结构操作共用一条历史。
  const history = useSheetHistory<{ objects: ObjectRow[]; blankId: string; screeningChartType?: ScreeningChartType; groupedScreening?: GroupedBarSheet }>(
    wb.activeId,
    () => structuredClone({ objects: w.objects, blankId: w.blankId, screeningChartType: w.screeningChartType, groupedScreening: w.groupedScreening }),
    (snapshot) => update(snapshot),
  );
  const commit = (patch: Partial<typeof w>) => {
    history.record();
    update(patch);
  };
  const setGroup = (change: GroupedChange) => {
    history.record();
    update((previous) => ({ groupedScreening: typeof change === 'function' ? change(previous.groupedScreening ?? defaultGroupedBar()) : change }));
  };
  const externalHistory = {
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: history.undo,
    redo: history.redo,
  };
  const result = useMemo(
    () =>
      screeningChart(
        { objects: w.objects, blankId: w.blankId, screenMode: w.screenMode, screeningChartType: w.screeningChartType, groupedScreening: w.groupedScreening },
        w.styles.screening,
      ),
    [w.objects, w.blankId, w.screenMode, w.styles.screening, w.screeningChartType, w.groupedScreening],
  );
  // 「全部 sheet」画廊：逐 sheet 用同一纯函数计算，未激活 sheet 的数据来自 store。
  const charts: SheetGalleryChart[] = wb.snapshots.map(({ tab, payload }) => {
    const chart = screeningChart(payload as ScreeningSheetPayload, w.styles.screening);
    return {
      id: tab.id,
      name: tab.name,
      title: sheetChartTitle(tab, BASE_TITLE),
      data: chart.data,
      error: chart.error || undefined,
      style: (payload as ScreeningSheetPayload).screeningChartType === 'grouped' ? (payload as ScreeningSheetPayload).groupedScreening?.style : undefined,
    };
  });
  function move(from: number, to: number) {
    if (to < 0 || to >= w.objects.length) return;
    const rows = [...w.objects];
    rows.splice(to, 0, rows.splice(from, 1)[0]);
    commit({ objects: rows });
  }
  function blankObject(index: number): ObjectRow {
    return {
      id: uid(),
      name: `对象 ${w.objects.length + index + 1}`,
      role: 'other',
      concentration: '',
      unit: w.objects[0]?.unit ?? 'µmol/L',
      intensity: '',
      notes: '',
    };
  }
  /** 行结构操作：插入 / 追加 / 删除对象行，同步清理空白参考引用。 */
  function structure(action: WorksheetStructureAction) {
    const rows = w.objects;
    if (action.type === 'delete-row') {
      const start = structureStart(action);
      const count = structureCount(action.count);
      const removed = new Set(rows.slice(start, start + count).map((row) => row.id));
      commit({
        objects: rows.filter((_, index) => index < start || index >= start + count),
        blankId: removed.has(w.blankId) ? '' : w.blankId,
      });
      return;
    }
    if (structureAxis(action) === 'column') return;
    const at =
      action.type === 'append-row'
        ? rows.length
        : Math.max(0, Math.min(structureStart(action), rows.length));
    const count = structureCount(action.count);
    const added = Array.from({ length: count }, (_, index) => blankObject(index));
    commit({ objects: [...rows.slice(0, at), ...added, ...rows.slice(at)] });
  }
  const canStructure = (action: WorksheetStructureAction) =>
    structureAxis(action) === 'column'
      ? '分析对象的列固定（含只读计算结果），不能插入或删除；请使用行操作'
      : null;
  const targets = w.objects.filter((o) => o.role === 'target');
  return (
    <>
      <div className="analysis-controls">
        <Field label="绘图类型"><select value={w.screeningChartType ?? 'single'} onChange={(e) => commit({
          screeningChartType: e.target.value as ScreeningChartType,
          ...(e.target.value === 'grouped' && !w.groupedScreening ? { groupedScreening: group } : {}),
        })}><option value="single">单系列柱状图</option><option value="grouped">分组柱状图</option></select></Field>
        {!isGrouped && <>
        <Field label="响应方式">
          <select
            value={w.screenMode}
            onChange={(e) => {
              const mode = e.target.value as ResponseMode;
              update({
                screenMode: mode,
                styles: {
                  ...w.styles,
                  screening: { ...w.styles.screening, yLabel: responses[mode] },
                },
              });
            }}
          >
            {Object.entries(responses).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="空白参考 F₀">
          <select value={w.blankId} onChange={(e) => update({ blankId: e.target.value })}>
            <option value="">请选择空白对象</option>
            {w.objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="inline-explainer">
          目标物使用强调色突出显示。对象名称支持离子、分子及任意实验组。
        </div>
        </>}
        {isGrouped && <p className="inline-explainer">多系列统计值对比 · 当前 Sheet 独立保存 · 单系列数据可随时切回</p>}
      </div>
      {result.error && <ErrorNote>{result.error}</ErrorNote>}
      <PlotSheetBar
        tabs={wb.tabs}
        activeId={wb.activeId}
        onSelect={wb.select}
        mode={viewMode}
        onModeChange={setViewMode}
      />
      {viewMode === 'all' ? (
        <SheetChartGallery
          charts={charts}
          style={w.styles.screening}
          onSelect={(id) => {
            wb.select(id);
            setViewMode('active');
          }}
        />
      ) : (
        <ChartPanel
          key={isGrouped ? `grouped-${wb.activeId}` : 'single'}
          kind="screening"
          title={BASE_TITLE}
          chartTitle={wb.chartTitle}
          onChartTitleChange={wb.setChartTitle}
          subtitle={isGrouped ? `${wb.activeName} · ${group.categories.length} 个分类 · ${group.series.filter((s) => s.visible).length} 个可见系列` : `${wb.activeName} · ${responses[w.screenMode]} · ${w.objects.length} 个对象`}
          custom={isGrouped ? { id: 'grouped-screening', name: '分组柱状图', style: group.style,
            onChange: (patch) => setGroup((current) => ({ ...current, style: { ...current.style, ...patch } })),
            grouped: { options: group.options, onChange: (patch) => setGroup((current) => ({ ...current, options: { ...current.options, ...patch } })) },
          } : undefined}
          data={
            result.data ?? {
              categories: w.objects.map((o) => o.name),
              series: [],
            }
          }
        />
      )}
      {isGrouped ? <GroupedScreening key={wb.activeId} sheet={group} onChange={setGroup} workbook={wb} history={history} /> : <>
      <div className="metrics-row three">
        <Metric label="分析对象" value={String(w.objects.length)} unit="组" />
        <Metric label="空白强度 F₀" value={fmt(result.f0, 6)} unit="a.u." />
        <Metric label="目标对象" value={targets.map((t) => t.name).join('、') || '未指定'} />
      </div>
      <section className="panel">
        <SectionHead
          title="自定义分析对象"
          detail="支持区域粘贴、撤销与重做；可拖动行号或使用上下按钮排序。空白参考需在上方明确指定。"
          action={
            <div className="button-group">
              <button className="small-button" onClick={onImport}>
                <Upload size={15} />
                导入表格
              </button>
              <button
                className="small-button primary"
                onClick={() => structure({ type: 'append-row', count: 1 })}
              >
                <Plus size={15} />
                添加对象
              </button>
            </div>
          }
        />
        <Worksheet
          sheetId={wb.activeId}
          book="对象筛选"
          sheet={wb.activeName}
          onRenameSheet={wb.rename}
          sheetTabs={wb.tabs}
          activeSheetId={wb.activeId}
          onSelectSheet={wb.select}
          onCreateSheet={wb.create}
          onDeleteSheet={wb.remove}
          onMoveRow={move}
          onStructure={structure}
          canStructure={canStructure}
          externalHistory={externalHistory}
          minRows={Math.max(1, w.objects.length)}
          columns={
            [
              { key: 'name', title: '分析对象名称', designation: 'Label' },
              {
                key: 'role',
                title: '角色',
                type: 'select',
                options: Object.entries(roles).map(([value, label]) => ({ value, label })),
              },
              { key: 'concentration', title: '浓度', type: 'number' },
              {
                key: 'unit',
                title: '单位',
                type: 'select',
                options: units.map((value) => ({ value, label: value })),
              },
              {
                key: 'intensity',
                title: '荧光强度 F',
                designation: 'Y',
                unit: 'a.u.',
                type: 'number',
              },
              { key: 'notes', title: '备注' },
              {
                key: 'response',
                title: '响应值',
                designation: 'Result',
                comment: responses[w.screenMode],
                readOnly: true,
              },
              { key: 'actions', title: '排序 / 删除', readOnly: true },
            ] satisfies WorksheetColumn[]
          }
          rows={w.objects.map((o, i) => [
            o.name,
            o.role,
            o.concentration,
            o.unit,
            o.intensity,
            o.notes,
            fmt(result.values[i], 8),
            '',
          ])}
          onChange={(rows) =>
            commit({
              objects: rows.map((r, i) => ({
                id: w.objects[i]?.id ?? uid(),
                name: r[0],
                role: r[1] as Role,
                concentration: r[2],
                unit: r[3],
                intensity: r[4],
                notes: r[5],
              })),
              blankId: rows[w.objects.findIndex((o) => o.id === w.blankId)] ? w.blankId : '',
            })
          }
          cellLabel={(i, c) =>
            `${['对象名称', '对象角色', '对象浓度', '对象单位', '对象强度', '对象备注', '对象响应', '对象操作'][c]} ${i + 1}`
          }
          invalidCell={(i, c) =>
            c === 2 &&
            !!w.objects[i]?.concentration.trim() &&
            (numeric(w.objects[i].concentration) ?? -1) < 0
          }
          renderCell={(i, c) => {
            const o = w.objects[i];
            if (c !== 7 || !o) return undefined;
            return (
              <div className="row-actions">
                <button
                  aria-label={`上移对象 ${i + 1}`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <ChevronUp size={15} />
                </button>
                <button
                  aria-label={`下移对象 ${i + 1}`}
                  disabled={i === w.objects.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ChevronDown size={15} />
                </button>
                <button
                  aria-label={`删除对象 ${i + 1}`}
                  onClick={() => structure({ type: 'delete-row', index: i, count: 1 })}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          }}
        />
        <div className="panel-foot">
          <span className="muted">浓度与单位用于记录实验条件，柱高由响应方式计算。</span>
          <button
            className="text-button"
            disabled={!w.objects.length || !!result.error}
            onClick={() =>
              exportExcel(
                w.objects.map((o, i) => ({
                  名称: o.name,
                  角色: roles[o.role],
                  浓度: o.concentration,
                  单位: o.unit,
                  F: o.intensity,
                  响应方式: responses[w.screenMode],
                  响应: result.values[i],
                  备注: o.notes,
                })),
                '对象筛选数据',
              ).catch((e) => notify(e.message))
            }
          >
            导出数据 Excel
          </button>
        </div>
      </section>
      </>}
    </>
  );
}
