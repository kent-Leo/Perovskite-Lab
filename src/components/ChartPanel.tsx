import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Download, SlidersHorizontal, Image, FileCode2, FileText } from 'lucide-react';
import { chartSVG } from '../domain/chart';
import { chartAxes, axisSides, axisNames, type AxisSide, type AxisStyle, type ChartStyle, type PlotData } from '../domain/types';
import { exportChart } from '../services/export';
import { useWorkspace } from '../state/workspace';
import { Empty, ErrorNote, Field } from './ui';
export function ChartPanel({
  kind,
  data,
  title,
  chartTitle,
  onChartTitleChange,
  subtitle,
  custom,
}: {
  kind: 'spectra' | 'screening' | 'calibration';
  data: PlotData;
  /** Page default title used when the current sheet's own title is blank. */
  title: string;
  /** The current sheet's own chart title (no sheet name is appended anywhere). */
  chartTitle: string;
  onChartTitleChange: (title: string) => void;
  subtitle?: string;
  /** Reuse the same style editor, persistence callback and portable SVG/PNG exporter. */
  custom?: {
    id: string; name: string; style: ChartStyle;
    onChange: (patch: Partial<ChartStyle>) => void;
    renderSVG?: (style: ChartStyle) => string;
    categorical?: boolean;
    /** Recognition paper figures have direct labels and only the relevant axes. */
    paper?: 'scores' | 'tree';
    initialSettingsOpen?: boolean;
  };
}) {
  const { w, update, notify } = useWorkspace(),
    style = custom?.style ?? w.styles[kind];
  const [settings, setSettings] = useState(custom?.initialSettingsOpen ?? true),
    [tab, setTab] = useState('appearance'),
    [axisSide, setAxisSide] = useState<AxisSide>('bottom'),
    [busy, setBusy] = useState('');
  const set = (p: Partial<ChartStyle>) => custom ? custom.onChange(p) :
    update((prev) => ({ styles: { ...prev.styles, [kind]: { ...prev.styles[kind], ...p } } }));
  const legendDrag = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  function startLegendDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const target = e.target as Element,
      group = target.closest?.('[data-legend]'),
      svg = group?.closest('svg');
    if (!group || !svg) return;
    const rect = svg.getBoundingClientRect(),
      x = Number(group.getAttribute('data-legend-x')) || 0,
      y = Number(group.getAttribute('data-legend-y')) || 0;
    legendDrag.current = {
      pointerId: e.pointerId,
      offsetX: x - (e.clientX - rect.left) / rect.width,
      offsetY: y - (e.clientY - rect.top) / rect.height,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function moveLegend(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = legendDrag.current,
      svg = e.currentTarget.querySelector('svg');
    if (!drag || drag.pointerId !== e.pointerId || !svg) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 3) return;
      drag.moved = true;
    }
    const rect = svg.getBoundingClientRect(),
      clamp = (value: number) => Math.max(0, Math.min(1, value)),
      x = clamp((e.clientX - rect.left) / rect.width + drag.offsetX),
      y = clamp((e.clientY - rect.top) / rect.height + drag.offsetY);
    set({ legend: 'free', legendX: x, legendY: y });
    e.preventDefault();
  }
  function endLegendDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = legendDrag.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    legendDrag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (!drag.moved) return;
    // Sync the stored position with the clamped position actually drawn.
    const group = e.currentTarget.querySelector('[data-legend]');
    if (!group) return;
    const x = Number(group.getAttribute('data-legend-x')),
      y = Number(group.getAttribute('data-legend-y'));
    if (Number.isFinite(x) && Number.isFinite(y))
      set({ legend: 'free', legendX: x, legendY: y });
  }
  const axis = chartAxes(style)[axisSide];
  const setAxis = (patch: Partial<AxisStyle>) => {
    const { label, ...settings } = patch;
    const labels = label === undefined ? {} : axisSide === 'bottom' ? { xLabel: label }
      : axisSide === 'left' ? { yLabel: label } : {};
    set({ ...labels,
      axes: { ...style.axes, [axisSide]: { ...style.axes?.[axisSide],
        ...settings, ...(label !== undefined && (axisSide === 'top' || axisSide === 'right') ? { label } : {}),
      } },
    });
  };
  // Each sheet keeps its own chart title; the page default only fills a blank one.
  const effectiveTitle = chartTitle.trim() || title,
    chartStyle = useMemo(() => ({ ...style, title: effectiveTitle }), [style, effectiveTitle]);
  const chart = useMemo(() => {
    try {
      return { svg: custom?.renderSVG ? custom.renderSVG(chartStyle) : chartSVG(data, chartStyle), error: '' };
    } catch (e) {
      return { svg: '', error: (e as Error).message };
    }
  }, [data, chartStyle, custom?.renderSVG]);
  async function save(format: 'png' | 'svg' | 'pdf') {
    setBusy(format);
    try {
      await exportChart(
        chart.svg,
        format,
        chartStyle,
        custom?.name ?? (kind === 'spectra' ? '荧光光谱' : kind === 'screening' ? '对象筛选' : '校准曲线'),
      );
      notify(`${format.toUpperCase()} 图表已导出`);
    } catch (e) {
      notify(`导出失败：${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className={`chart-layout ${settings ? '' : 'settings-hidden'} ${custom?.paper ? 'recognition-paper-chart' : ''}`}>
      <section className="chart-card">
        <div className="chart-head">
          <div>
            <h2 data-testid="chart-title">{effectiveTitle}</h2>
            <span>{subtitle}</span>
          </div>
          <button
            className={settings ? 'small-button active' : 'small-button'}
            onClick={() => setSettings((s) => !s)}
            aria-expanded={settings}
          >
            <SlidersHorizontal size={16} />
            样式
          </button>
        </div>
        <div className="chart-stage">
          {chart.svg ? (
            <div
              className="svg-chart"
              data-testid={`${custom?.id ?? kind}-chart`}
              onPointerDown={startLegendDrag}
              onPointerMove={moveLegend}
              onPointerUp={endLegendDrag}
              onPointerCancel={endLegendDrag}
              onLostPointerCapture={endLegendDrag}
              dangerouslySetInnerHTML={{ __html: chart.svg }}
            />
          ) : (
            <Empty title="图表待生成" detail={chart.error} />
          )}
        </div>
        <p className="chart-scroll-hint">可左右滑动查看完整图表</p>
        <footer className="chart-footer">
          <span>
            <Download size={15} /> 导出图表
          </span>
          <div>
            {(custom ? ['png', 'svg'] as const : ['png', 'svg', 'pdf'] as const).map((format, i) => {
              const Icon = [Image, FileCode2, FileText][i];
              return (
                <button
                  key={format}
                  className="small-button"
                  disabled={!chart.svg || !!busy}
                  onClick={() => save(format)}
                >
                  <Icon size={15} />
                  {busy === format ? '生成中…' : format.toUpperCase()}
                </button>
              );
            })}
          </div>
        </footer>
        {chart.error && data.series.length > 0 && <ErrorNote>{chart.error}</ErrorNote>}
      </section>
      {settings && (
        <aside className="style-panel">
          <h3>图表设置</h3>
          <div className="segmented compact">
            <button
              className={tab === 'appearance' ? 'selected' : ''}
              onClick={() => setTab('appearance')}
            >
              外观
            </button>
            <button className={tab === 'axes' ? 'selected' : ''} onClick={() => setTab('axes')}>
              坐标
            </button>
            <button className={tab === 'export' ? 'selected' : ''} onClick={() => setTab('export')}>
              导出
            </button>
          </div>
          {tab === 'appearance' && (
            <>
              {!custom && kind !== 'spectra' && (
                <div className="form-grid">
                  <Field label="数据色">
                    <input
                      type="color"
                      value={style.primaryColor ?? '#258873'}
                      onChange={(e) => set({ primaryColor: e.target.value })}
                    />
                  </Field>
                  <Field label={kind === 'screening' ? '目标色' : '拟合色'}>
                    <input
                      type="color"
                      value={style.secondaryColor ?? '#b6873f'}
                      onChange={(e) => set({ secondaryColor: e.target.value })}
                    />
                  </Field>
                </div>
              )}
              <Field
                label="图表标题"
                hint={`按 sheet 独立保存；留空时显示「${title}」`}
              >
                <input
                  value={chartTitle}
                  placeholder={title}
                  onChange={(e) => onChartTitleChange(e.target.value)}
                />
              </Field>
              <div className="form-grid">
                <Field label="线宽">
                  <input
                    type="number"
                    min={0.5}
                    max={10}
                    step={0.5}
                    value={style.lineWidth}
                    onChange={(e) =>
                      set({ lineWidth: Math.max(0.5, Math.min(10, Number(e.target.value))) })
                    }
                  />
                </Field>
                <Field label="点大小">
                  <input
                    type="number"
                    min={1}
                    max={12}
                    disabled={custom?.categorical}
                    value={style.pointSize}
                    onChange={(e) =>
                      set({ pointSize: Math.max(1, Math.min(12, Number(e.target.value))) })
                    }
                  />
                </Field>
              </div>
              <Field label="字体">
                <select
                  value={style.fontFamily}
                  onChange={(e) => set({ fontFamily: e.target.value })}
                >
                  <option>Arial</option>
                  <option>Times New Roman</option>
                  <option>Perovskite Lab Sans</option>
                </select>
              </Field>
              <div className="form-grid">
                <Field label="字号">
                  <input
                    type="number"
                    min={12}
                    max={30}
                    value={style.fontSize}
                    onChange={(e) =>
                      set({ fontSize: Math.max(12, Math.min(30, Number(e.target.value))) })
                    }
                  />
                </Field>
                {!custom?.paper && <Field label="图例字号">
                  <input
                    type="number"
                    min={8}
                    max={30}
                    value={style.legendFontSize ?? style.fontSize}
                    onChange={(e) =>
                      set({
                        legendFontSize: Math.max(8, Math.min(30, Number(e.target.value))),
                      })
                    }
                  />
                </Field>}
              </div>
              {!custom?.paper && <><Field label="图例位置">
                <select
                  value={style.legend}
                  onChange={(e) => set({ legend: e.target.value as ChartStyle['legend'] })}
                >
                  <option value="right">右侧</option>
                  <option value="bottom">底部</option>
                  <option value="free">自由拖动</option>
                  <option value="none">隐藏</option>
                </select>
              </Field>
              {style.legend === 'free' && (
                <>
                  <div className="form-grid">
                    <Field label="图例 X / %">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={Math.round((style.legendX ?? 0.72) * 100)}
                        onChange={(e) =>
                          set({
                            legendX: Math.max(0, Math.min(100, Number(e.target.value))) / 100,
                          })
                        }
                      />
                    </Field>
                    <Field label="图例 Y / %">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={Math.round((style.legendY ?? 0.1) * 100)}
                        onChange={(e) =>
                          set({
                            legendY: Math.max(0, Math.min(100, Number(e.target.value))) / 100,
                          })
                        }
                      />
                    </Field>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      set({
                        legend: kind === 'screening' ? 'none' : 'right',
                        legendX: undefined,
                        legendY: undefined,
                      })
                    }
                  >
                    重置图例位置
                  </button>
                </>
              )}
              <p className="muted">图例可直接在图中拖动；位置与字号随 {custom ? 'PNG / SVG' : 'PNG / SVG / PDF'} 导出。</p></>}
              {!custom?.categorical && <>{!custom?.paper && <label className="check-line">
                <input
                  type="checkbox"
                  checked={style.grid}
                  onChange={(e) => set({ grid: e.target.checked })}
                />
                显示网格
              </label>}
              {!custom && <label className="check-line">
                <input
                  type="checkbox"
                  checked={style.points}
                  onChange={(e) => set({ points: e.target.checked })}
                />
                显示数据点
              </label>}
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={!!style.pointValues}
                  onChange={(e) => set({ pointValues: e.target.checked })}
                />
                显示数据点数值
              </label>
              {!custom && <label className="check-line">
                <input
                  type="checkbox"
                  checked={style.dashed}
                  onChange={(e) => set({ dashed: e.target.checked })}
                />
                虚线
              </label>}
              </>}
            </>
          )}
          {tab === 'axes' && (
            <>
              {custom?.categorical ? <>
                <Field label="下轴名称"><input value={style.xLabel} onChange={(e) => set({ xLabel: e.target.value })} /></Field>
                <Field label="左轴名称"><input value={style.yLabel} onChange={(e) => set({ yLabel: e.target.value })} /></Field>
                <p className="muted">样本顺序由完整响应矩阵的 Ward 树确定。</p>
              </> : <><div className="axis-editor">
                <div className="axis-side-tabs" role="group" aria-label="选择坐标轴">
                  {axisSides.filter((side) => !custom?.paper || side === 'bottom' || side === 'left').map((side) => (
                    <button key={side} type="button" aria-pressed={axisSide === side}
                      className={axisSide === side ? 'selected' : ''} onClick={() => setAxisSide(side)}>
                      {axisNames[side]}
                    </button>
                  ))}
                </div>
                <label className="check-line">
                  <input type="checkbox" checked={axis.visible} onChange={(e) => setAxis({ visible: e.target.checked })} />
                  显示{axisNames[axisSide]}
                </label>
                <Field label={`${axisNames[axisSide]}名称`}>
                  <input value={axis.label} maxLength={120} placeholder="留空隐藏名称" onChange={(e) => setAxis({ label: e.target.value })} />
                </Field>
                <label className="check-line">
                  <input type="checkbox" checked={axis.tickLabels} onChange={(e) => setAxis({ tickLabels: e.target.checked })} />
                  显示{axisNames[axisSide]}刻度标签
                </label>
                <Field label={`${axisNames[axisSide]}刻度线`}>
                  <select value={axis.ticks} onChange={(e) => setAxis({ ticks: e.target.value as AxisStyle['ticks'] })}>
                    <option value="out">向外</option><option value="in">向内</option>
                    <option value="both">内外</option><option value="none">隐藏</option>
                  </select>
                </Field>
                <div className="form-grid">
                  <Field label={`${axisNames[axisSide]}刻度长度`}>
                    <input type="number" min={0} max={20} value={axis.tickLength}
                      onChange={(e) => setAxis({ tickLength: Math.max(0, Math.min(20, Number(e.target.value))) })} />
                  </Field>
                  <Field label={`${axisNames[axisSide]}刻度粗细`}>
                    <input type="number" min={0.5} max={5} step={0.5} value={axis.tickWidth}
                      onChange={(e) => setAxis({ tickWidth: Math.max(0.5, Math.min(5, Number(e.target.value))) })} />
                  </Field>
                </div>
                <Field label={`${axisNames[axisSide]}刻度分段数`} hint={data.categories && (axisSide === 'top' || axisSide === 'bottom') ? '分类轴按每个对象显示刻度' : '1–20 段，两端均显示刻度'}>
                  <input type="number" min={1} max={20} step={1} value={axis.divisions}
                    disabled={!!data.categories && (axisSide === 'top' || axisSide === 'bottom')}
                    onChange={(e) => setAxis({ divisions: Math.max(1, Math.min(20, Math.round(Number(e.target.value)))) })} />
                </Field>
                {!custom?.paper && <p className="muted">上 / 下轴共用 X 范围，左 / 右轴共用 Y 范围。</p>}
              </div>
              <p className="muted">范围留空时自动计算</p>
              <div className="form-grid">
                {(['xMin', 'xMax', 'yMin', 'yMax'] as const).map((k, i) => (
                  <Field key={k} label={['X 最小值', 'X 最大值', 'Y 最小值', 'Y 最大值'][i]}>
                    <input
                      type="number"
                      placeholder="自动"
                      value={style[k]}
                      onChange={(e) => set({ [k]: e.target.value })}
                    />
                  </Field>
                ))}
              </div>
              </>}
            </>
          )}
          {tab === 'export' && (
            <>
              <Field label="图宽 / cm">
                <input
                  type="number"
                  min={4}
                  max={30}
                  step={1}
                  value={style.widthCm}
                  onChange={(e) =>
                    set({ widthCm: Math.min(30, Math.max(4, Number(e.target.value))) })
                  }
                />
              </Field>
              <Field label="PNG 分辨率">
                <select
                  value={style.dpi}
                  onChange={(e) => set({ dpi: Number(e.target.value) as 300 | 600 })}
                >
                  <option value={300}>300 dpi</option>
                  <option value={600}>600 dpi</option>
                </select>
              </Field>
              <div className="export-spec">
                <strong>{Math.round((style.widthCm / 2.54) * style.dpi)} px</strong>
                <span>PNG 宽度 · 白色背景</span>
              </div>
              <p className="muted">{custom ? 'SVG 保留矢量；SVG 与 PNG 均使用内置中文与科学字符字体。' : 'SVG / PDF 保留矢量。PDF 使用内置中文与科学字符字体。'}</p>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
