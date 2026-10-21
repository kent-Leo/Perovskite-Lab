import { useMemo, useState } from 'react';
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
  subtitle,
}: {
  kind: 'spectra' | 'screening' | 'calibration';
  data: PlotData;
  title: string;
  subtitle?: string;
}) {
  const { w, update, notify } = useWorkspace(),
    style = w.styles[kind];
  const [settings, setSettings] = useState(true),
    [tab, setTab] = useState('appearance'),
    [axisSide, setAxisSide] = useState<AxisSide>('bottom'),
    [busy, setBusy] = useState('');
  const set = (p: Partial<ChartStyle>) =>
    update((prev) => ({ styles: { ...prev.styles, [kind]: { ...prev.styles[kind], ...p } } }));
  const axis = chartAxes(style)[axisSide];
  const setAxis = (patch: Partial<AxisStyle>) => update((prev) => {
    const current = prev.styles[kind];
    const { label, ...settings } = patch;
    const labels = label === undefined ? {} : axisSide === 'bottom' ? { xLabel: label }
      : axisSide === 'left' ? { yLabel: label } : {};
    return { styles: { ...prev.styles, [kind]: { ...current, ...labels,
      axes: { ...current.axes, [axisSide]: { ...current.axes?.[axisSide],
        ...settings, ...(label !== undefined && (axisSide === 'top' || axisSide === 'right') ? { label } : {}),
      } },
    } } };
  });
  const chart = useMemo(() => {
    try {
      return { svg: chartSVG(data, style), error: '' };
    } catch (e) {
      return { svg: '', error: (e as Error).message };
    }
  }, [data, style]);
  async function save(format: 'png' | 'svg' | 'pdf') {
    setBusy(format);
    try {
      await exportChart(
        chart.svg,
        format,
        style,
        kind === 'spectra' ? '荧光光谱' : kind === 'screening' ? '对象筛选' : '校准曲线',
      );
      notify(`${format.toUpperCase()} 图表已导出`);
    } catch (e) {
      notify(`导出失败：${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className={`chart-layout ${settings ? '' : 'settings-hidden'}`}>
      <section className="chart-card">
        <div className="chart-head">
          <div>
            <h2>{title}</h2>
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
              data-testid={`${kind}-chart`}
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
            {(['png', 'svg', 'pdf'] as const).map((format, i) => {
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
              {kind !== 'spectra' && (
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
              <Field label="图表标题">
                <input
                  value={style.title}
                  placeholder="可选"
                  onChange={(e) => set({ title: e.target.value })}
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
                <Field label="图例">
                  <select
                    value={style.legend}
                    onChange={(e) => set({ legend: e.target.value as ChartStyle['legend'] })}
                  >
                    <option value="right">右侧</option>
                    <option value="bottom">底部</option>
                    <option value="none">隐藏</option>
                  </select>
                </Field>
              </div>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={style.grid}
                  onChange={(e) => set({ grid: e.target.checked })}
                />
                显示网格
              </label>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={style.points}
                  onChange={(e) => set({ points: e.target.checked })}
                />
                显示数据点
              </label>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={style.dashed}
                  onChange={(e) => set({ dashed: e.target.checked })}
                />
                虚线
              </label>
            </>
          )}
          {tab === 'axes' && (
            <>
              <div className="axis-editor">
                <div className="axis-side-tabs" role="group" aria-label="选择坐标轴">
                  {axisSides.map((side) => (
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
                <p className="muted">上 / 下轴共用 X 范围，左 / 右轴共用 Y 范围。</p>
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
              <p className="muted">SVG / PDF 保留矢量。PDF 使用内置中文与科学字符字体。</p>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
