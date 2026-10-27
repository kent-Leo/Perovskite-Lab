import { useMemo, useState } from 'react';
import { useWorkspace } from '../state/workspace';
import { useWorkbook } from '../state/useWorkbook';
import { spectrumStats, numeric, fmt } from '../domain/math';
import { peakMetrics } from '../domain/peak';
import type { ColumnMetadata, PlotData, Series, Spectrum } from '../domain/types';
import { sheetChartTitle, type RawSheetPayload } from '../domain/workbook';
import { rawColumnIndex, rawColumnKey, rawSpectrumColor, rawSpectrumLabel } from '../domain/raw-spectra';
import { ChartPanel } from '../components/ChartPanel';
import {
  PlotSheetBar,
  SheetChartGallery,
  type PlotViewMode,
  type SheetGalleryChart,
} from '../components/SheetPlotPanel-v0.9.1-2026.10.27';
import { ErrorNote, Field, Metric, SectionHead } from '../components/ui';
import { exportExcel } from '../services/download';
import { AiSpectraPanel } from '../components/AiSpectraPanel-v0.9.1-2026.10.27';

/** Page-level base title; a custom style.title overrides it. */
const BASE_TITLE = '荧光光谱';

/**
 * Plot points come from the last confirmed raw table/import of one sheet, while
 * labels, colors and visibility are read from that sheet's column metadata.
 */
function sheetRawSpectra(
  spectra: Spectrum[],
  rawSpectra: Spectrum[] | undefined,
  rawColumnSpectra: Record<string, string> | undefined,
  metadata: Record<string, ColumnMetadata> | undefined,
): Spectrum[] {
  const points = new Map((rawSpectra ?? spectra).map((s) => [s.id, s.points]));
  const columns = new Map(
    Object.entries(rawColumnSpectra ?? {}).flatMap(([key, id]) => {
      const column = rawColumnIndex(key);
      return column === null ? [] : [[id, column] as const];
    }),
  );
  return spectra.flatMap((sample) => {
    const raw = points.get(sample.id);
    if (!raw) return [];
    const column = columns.get(sample.id);
    const meta = column === undefined ? undefined : metadata?.[rawColumnKey(column)];
    return [
      {
        ...sample,
        name: rawSpectrumLabel(meta, sample.name),
        color: rawSpectrumColor(meta, sample.color),
        points: raw,
      },
    ];
  });
}

/** Series of the shown spectra; an empty list becomes an empty chart. */
function plotSeries(
  spectra: Spectrum[],
  normalize: boolean,
): { data: PlotData | null; error: string } {
  if (!spectra.length) return { data: null, error: '' };
  const invalid = spectra.filter((s) => {
    const stats = normalize ? spectrumStats(s.points) : null;
    return normalize && (!stats || !(stats.max > 0));
  });
  if (invalid.length)
    return {
      data: null,
      error: '最大强度非正，无法归一化：' + invalid.map((s) => s.name).join('、'),
    };
  const series: Series[] = spectra.map((s) => {
    const max = normalize ? (spectrumStats(s.points)?.max ?? 1) : 1;
    return {
      name: s.name,
      color: s.color,
      points: s.points.map((p) => ({ x: p.x, y: p.y / max })),
    };
  });
  return { data: { series }, error: '' };
}

export function Spectra() {
  const { w, update, notify } = useWorkspace(),
    wb = useWorkbook('raw'),
    [normalize, setNormalize] = useState(false),
    [single, setSingle] = useState(false),
    [viewMode, setViewMode] = useState<PlotViewMode>('active'),
    [selected, setSelected] = useState(w.spectra[0]?.id ?? '');
  const rawSpectra = useMemo(
    () =>
      sheetRawSpectra(
        w.spectra,
        w.rawSpectra,
        w.rawColumnSpectra,
        w.sheetMetadata?.[wb.activeId],
      ),
    [w.rawSpectra, w.spectra, w.sheetMetadata, w.rawColumnSpectra, wb.activeId],
  );
  const active = rawSpectra.find((s) => s.id === selected) ?? rawSpectra[0],
    shown = single ? (active ? [active] : []) : rawSpectra.filter((s) => s.visible);
  const chart = useMemo(() => plotSeries(shown, normalize), [shown, normalize]);
  // One tile per sheet for the "all sheets" view; each sheet uses its own payload
  // and its own column metadata, never the active sheet's top-level fields.
  const galleryCharts = useMemo<SheetGalleryChart[]>(
    () =>
      wb.snapshots.map(({ tab, payload }) => {
        try {
          const raw = payload as RawSheetPayload;
          const spectra = sheetRawSpectra(
            raw.spectra ?? [],
            raw.rawSpectra,
            raw.rawColumnSpectra,
            w.sheetMetadata?.[tab.id],
          );
          const result = plotSeries(spectra.filter((s) => s.visible), normalize);
          return {
            id: tab.id,
            name: tab.name,
            // Each sheet's own chart title, without appending the sheet name.
            title: sheetChartTitle(tab, BASE_TITLE),
            data: result.data,
            error: result.error,
          };
        } catch (e) {
          return {
            id: tab.id,
            name: tab.name,
            title: sheetChartTitle(tab, BASE_TITLE),
            data: null,
            error: (e as Error).message,
          };
        }
      }),
    [wb.snapshots, w.sheetMetadata, normalize],
  );
  const excitation = w.excitation ?? '',
    excitationValue = numeric(excitation),
    metrics = active ? peakMetrics(active.points, excitation) : null,
    range =
      active && active.points.length
        ? `${fmt(active.points[0].x, 5)}–${fmt(active.points.at(-1)!.x, 5)} nm`
        : '—';
  function exportPeaks() {
    if (!shown.length) return;
    exportExcel(
      shown.map((s) => {
        const m = peakMetrics(s.points, excitation);
        return {
          光谱: s.name,
          峰位_nm: m.peak ?? '',
          峰强度_a_u: m.intensity ?? '',
          半高宽_nm: m.fwhm ?? '',
          斯托克斯位移_nm: m.stokes ?? '',
          峰面积_a_u_nm: m.area ?? '',
          积分起点_nm: m.from ?? '',
          积分终点_nm: m.to ?? '',
        };
      }),
      '峰特性指标',
    ).catch((e) => notify(e.message));
  }
  return (
    <>
      <div className="workspace-toolbar">
        <div className="segmented">
          <button className={!single ? 'selected' : ''} onClick={() => setSingle(false)}>
            多光谱叠加
          </button>
          <button className={single ? 'selected' : ''} onClick={() => setSingle(true)}>
            单条光谱
          </button>
        </div>
        <label className="check-line">
          <input
            type="checkbox"
            checked={normalize}
            onChange={(e) => {
              setNormalize(e.target.checked);
              update((prev) => ({
                styles: {
                  ...prev.styles,
                  spectra: {
                    ...prev.styles.spectra,
                    yLabel: e.target.checked
                      ? 'Normalized intensity'
                      : 'Fluorescence intensity / a.u.',
                  },
                },
              }));
            }}
          />
          归一化
        </label>
        <span className="toolbar-meta">
          {shown.length} 条曲线 · {shown.reduce((n, s) => n + s.points.length, 0)} 个数据点
        </span>
      </div>
      <PlotSheetBar
        tabs={wb.tabs}
        activeId={wb.activeId}
        onSelect={wb.select}
        mode={viewMode}
        onModeChange={setViewMode}
      />
      {viewMode === 'all' ? (
        <SheetChartGallery
          charts={galleryCharts}
          style={w.styles.spectra}
          onSelect={(id) => {
            wb.select(id);
            setViewMode('active');
          }}
        />
      ) : (
        <ChartPanel
          kind="spectra"
          data={chart.data ?? { series: [] }}
          title={BASE_TITLE}
          chartTitle={wb.chartTitle}
          onChartTitleChange={wb.setChartTitle}
          subtitle={
            normalize
              ? `${wb.activeName} · 按各曲线最大值归一化`
              : `${wb.activeName} · 原始光谱数据 · 发射光谱`
          }
        />
      )}
      {chart.error && <ErrorNote>{chart.error}</ErrorNote>}
      <AiSpectraPanel key={wb.activeId} spectra={rawSpectra} sheet={wb.activeName} excitation={excitation}
        onExcitationChange={(value) => update({ excitation: value })} />
      <section className="peak-panel" aria-labelledby="peak-title">
        <SectionHead
          title="峰特性分析"
          detail="基于当前查看光谱的原始数据；斯托克斯位移 = 峰位 − 激发波长，峰面积按测量范围梯形积分。"
          action={
            <button className="small-button" disabled={!shown.length} onClick={exportPeaks}>
              导出峰指标
            </button>
          }
        />
        <div className="peak-controls">
          <Field label="当前查看光谱">
            <select value={active?.id ?? ''} onChange={(e) => setSelected(e.target.value)}>
              {rawSpectra.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="激发波长 / nm" hint="留空时斯托克斯位移显示为 —">
            <input
              type="number"
              min={1}
              placeholder="例如 450"
              value={excitation}
              onChange={(e) => update({ excitation: e.target.value })}
            />
          </Field>
        </div>
        <div className="metrics-row">
          <Metric label="峰位 λmax" value={fmt(metrics?.peak, 5)} unit="nm" />
          <Metric label="峰强度 Fmax" value={fmt(metrics?.intensity, 6)} unit="a.u." />
          <Metric label="半高宽 FWHM" value={fmt(metrics?.fwhm, 4)} unit="nm" />
          <Metric label="斯托克斯位移" value={fmt(metrics?.stokes, 5)} unit="nm" />
          <Metric label="峰面积" value={fmt(metrics?.area, 5)} unit="a.u.·nm" />
        </div>
        <p className="peak-note">
          积分区间 {range} · 峰面积按原始强度梯形积分
          {excitationValue === null ? ' · 输入激发波长后计算斯托克斯位移' : ''}
          {metrics?.stokes !== null && metrics?.stokes !== undefined && metrics.stokes <= 0
            ? ' · 激发波长应小于发射峰'
            : ''}
          {normalize ? ' · 归一化仅影响绘图，指标使用原始强度' : ''}
        </p>
      </section>
    </>
  );
}
