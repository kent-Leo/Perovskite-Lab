import { useMemo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { chartSVG } from '../domain/chart';
import type { ChartStyle, PlotData } from '../domain/types';
import { Empty } from './ui';

/** One plotting-workbook sheet shown in the plot sheet bar. */
export interface PlotSheetTab {
  id: string;
  name: string;
}

/** "active" shows only the current sheet, "all" tiles every sheet. */
export type PlotViewMode = 'active' | 'all';

/** One sheet's prepared plot data; `error` carries upstream preparation errors. */
export interface SheetGalleryChart {
  id: string;
  name: string;
  data: PlotData | null;
  error?: string;
}

/**
 * Sheet tab bar above the plotting area, plus the current/all view toggle.
 * The toggle is only rendered when `onModeChange` is provided.
 */
export function PlotSheetBar({
  tabs,
  activeId,
  onSelect,
  mode = 'active',
  onModeChange,
}: {
  tabs: PlotSheetTab[];
  activeId: string;
  onSelect: (id: string) => void;
  mode?: PlotViewMode;
  onModeChange?: (mode: PlotViewMode) => void;
}) {
  return (
    <div className="plot-sheet-bar">
      <div className="plot-sheet-tabs" role="group" aria-label="绘图 sheet">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              className={`plot-sheet-tab${active ? ' selected' : ''}`}
              aria-pressed={active}
              aria-label={`绘图 sheet ${tab.name}`}
              title={tab.name}
              onClick={() => onSelect(tab.id)}
            >
              {tab.name}
            </button>
          );
        })}
      </div>
      {onModeChange && (
        <div className="plot-view-toggle segmented" role="group" aria-label="绘图视图">
          <button
            type="button"
            className={mode === 'active' ? 'selected' : ''}
            aria-pressed={mode === 'active'}
            onClick={() => onModeChange('active')}
          >
            当前 sheet
          </button>
          <button
            type="button"
            className={mode === 'all' ? 'selected' : ''}
            aria-pressed={mode === 'all'}
            onClick={() => onModeChange('all')}
          >
            全部 sheet
          </button>
        </div>
      )}
    </div>
  );
}

type RenderedSheetChart = {
  chart: SheetGalleryChart;
  svg?: string;
  title?: string;
  detail?: string;
};

function renderSheetChart(chart: SheetGalleryChart, style: ChartStyle): RenderedSheetChart {
  const upstreamError = chart.error?.trim();
  if (upstreamError) return { chart, title: '图表待生成', detail: upstreamError };
  if (!chart.data)
    return {
      chart,
      title: '尚无数据',
      detail: '该 sheet 还没有可绘制的数据，导入或粘贴数据后即可绘图。',
    };
  try {
    return { chart, svg: chartSVG(chart.data, style) };
  } catch (error) {
    return {
      chart,
      title: '图表待生成',
      detail: (error as Error)?.message || '图表生成失败',
    };
  }
}

/**
 * Tiles every sheet as a chart card. Click a card head button to make that
 * sheet the current one; the page wiring decides what "current" means.
 */
export function SheetChartGallery({
  charts,
  style,
  onSelect,
}: {
  charts: SheetGalleryChart[];
  style: ChartStyle;
  onSelect: (id: string) => void;
}) {
  const rendered = useMemo(
    () => charts.map((chart) => renderSheetChart(chart, style)),
    [charts, style],
  );
  return (
    <section className="sheet-gallery" aria-label="全部 sheet 图表">
      {rendered.length === 0 ? (
        <Empty title="尚无数据" detail="还没有可绘制的 sheet。" />
      ) : (
        rendered.map(({ chart, svg, title, detail }) => (
          <article
            key={chart.id}
            className="sheet-gallery-card"
            data-testid={`gallery-chart-${chart.id}`}
          >
            <div className="sheet-gallery-head">
              <h3 title={chart.name}>{chart.name}</h3>
              <button
                type="button"
                className="small-button sheet-gallery-view"
                aria-label={`查看 sheet ${chart.name}`}
                title={`查看 sheet ${chart.name}`}
                onClick={() => onSelect(chart.id)}
              >
                <ArrowUpRight size={14} aria-hidden="true" />
                查看
              </button>
            </div>
            {svg ? (
              <div className="sheet-gallery-chart" dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <div className="sheet-gallery-chart">
                <Empty title={title ?? '尚无数据'} detail={detail ?? ''} />
              </div>
            )}
          </article>
        ))
      )}
    </section>
  );
}
