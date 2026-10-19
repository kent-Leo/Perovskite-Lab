import { useMemo, useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, ArrowUpRight } from 'lucide-react';
import { useWorkspace } from '../state/workspace';
import { palette, roles, uid, type Spectrum, type Role } from '../domain/types';
import { spectrumStats, interpolate, numeric, convertConcentration, fmt } from '../domain/math';
import { ChartPanel } from '../components/ChartPanel';
import { ErrorNote, Field, Metric, SectionHead } from '../components/ui';
import { exportExcel } from '../services/download';
export function Spectra({
  onImport,
  onNavigate,
}: {
  onImport: () => void;
  onNavigate: (page: string) => void;
}) {
  const { w, update, notify } = useWorkspace(),
    [normalize, setNormalize] = useState(false),
    [single, setSingle] = useState(false),
    [selected, setSelected] = useState(w.spectra[0]?.id ?? ''),
    [wave, setWave] = useState('516'),
    [error, setError] = useState('');
  const active = w.spectra.find((s) => s.id === selected) ?? w.spectra[0],
    shown = single ? (active?.visible ? [active] : []) : w.spectra.filter((s) => s.visible);
  const chart = useMemo(() => {
    const invalid = shown.filter((s) => normalize && spectrumStats(s.points)!.max <= 0);
    return {
      error: invalid.length
        ? '最大强度非正，无法归一化：' + invalid.map((s) => s.name).join('、')
        : '',
      series: invalid.length
        ? []
        : shown.map((s) => {
            const max = normalize ? spectrumStats(s.points)!.max : 1;
            return {
              name: s.name,
              color: s.color,
              points: s.points.map((p) => ({ x: p.x, y: p.y / max })),
            };
          }),
    };
  }, [shown, normalize]);
  const stats = active ? spectrumStats(active.points) : null;
  const patch = (id: string, p: Partial<Spectrum>) =>
    update((prev) => ({ spectra: prev.spectra.map((s) => (s.id === id ? { ...s, ...p } : s)) }));
  function move(i: number, by: number) {
    update((prev) => {
      const arr = [...prev.spectra];
      [arr[i], arr[i + by]] = [arr[i + by], arr[i]];
      return { spectra: arr };
    });
  }
  function extract() {
    try {
      const x = numeric(wave);
      if (x === null) throw new Error('请输入有效的提取波长');
      const eligible = w.spectra.filter(
        (s) => s.visible && (s.role === 'target' || s.role === 'blank'),
      );
      if (!eligible.length) throw new Error('请先将校准光谱指定为目标物或空白');
      const rows = eligible.map((s) => {
        const c = numeric(s.concentration),
          f = interpolate(s.points, x);
        if (c === null || c < 0) throw new Error(`${s.name} 缺少有效浓度`);
        if (f === null) throw new Error(`${s.name} 的光谱未覆盖 ${x} nm`);
        return {
          id: uid(),
          concentration: String(convertConcentration(c, s.unit, w.calUnit)),
          intensity: String(f),
          included: true,
        };
      });
      const blank = eligible.find((s) => s.role === 'blank');
      update({ calibration: rows, calF0: blank ? String(interpolate(blank.points, x)) : w.calF0 });
      notify(`已提取 ${x} nm 处强度并生成 ${rows.length} 个校准点`);
      onNavigate('calibration');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function screening() {
    try {
      const x = numeric(wave);
      if (x === null) throw new Error('请输入有效的提取波长');
      const rows = w.spectra
        .filter((s) => s.visible)
        .map((s) => {
          const f = interpolate(s.points, x);
          if (f === null) throw new Error(`${s.name} 的光谱未覆盖 ${x} nm`);
          return {
            id: uid(),
            name: s.name,
            role: s.role,
            concentration: s.concentration,
            unit: s.unit,
            intensity: String(f),
            notes: `${x} nm · ${s.source}`,
          };
        });
      if (!rows.length) throw new Error('请至少显示一条光谱');
      update({ objects: rows, blankId: rows.find((r) => r.role === 'blank')?.id ?? '' });
      onNavigate('screening');
    } catch (e) {
      setError((e as Error).message);
    }
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
      <ChartPanel
        kind="spectra"
        data={{ series: chart.series }}
        title="荧光光谱"
        subtitle={normalize ? '按各曲线最大值归一化' : '原始强度 · 发射光谱'}
      />
      {chart.error && <ErrorNote>{chart.error}</ErrorNote>}
      <div className="metrics-row">
        <Metric label="当前样品" value={active?.name ?? '—'} />
        <Metric label="峰位 λmax" value={fmt(stats?.peak, 5)} unit="nm" />
        <Metric label="峰值 Fmax" value={fmt(stats?.max, 6)} unit="a.u." />
        <Metric label="半峰宽 FWHM" value={fmt(stats?.fwhm, 4)} unit="nm" />
        <Metric label="原始峰面积" value={fmt(stats?.area, 5)} unit="a.u.·nm" />
      </div>
      <section className="panel">
        <SectionHead
          title="样品与分析对象"
          detail="名称、角色和浓度均可自定义。点击样品查看原始峰值。"
          action={
            <button className="small-button" onClick={onImport}>
              <Plus size={16} />
              导入样品
            </button>
          }
        />
        <div className="table-scroll">
          <table className="editable-table">
            <thead>
              <tr>
                <th>显示</th>
                <th>样品名称</th>
                <th>角色</th>
                <th>浓度</th>
                <th>单位</th>
                <th>颜色</th>
                <th>数据来源</th>
                <th>排序 / 删除</th>
              </tr>
            </thead>
            <tbody>
              {w.spectra.map((s, i) => (
                <tr key={s.id} className={active?.id === s.id ? 'active-row' : ''}>
                  <td>
                    <input
                      aria-label={`显示 ${s.name}`}
                      type="checkbox"
                      checked={s.visible}
                      onChange={(e) => patch(s.id, { visible: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`样品名称 ${i + 1}`}
                      value={s.name}
                      onFocus={() => setSelected(s.id)}
                      onChange={(e) => patch(s.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`样品角色 ${i + 1}`}
                      value={s.role}
                      onChange={(e) => patch(s.id, { role: e.target.value as Role })}
                    >
                      {Object.entries(roles).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`样品浓度 ${i + 1}`}
                      type="number"
                      min={0}
                      value={s.concentration}
                      placeholder="未设置"
                      onChange={(e) => patch(s.id, { concentration: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`样品单位 ${i + 1}`}
                      value={s.unit}
                      onChange={(e) => patch(s.id, { unit: e.target.value })}
                    >
                      {['mol/L', 'mmol/L', 'μM', 'nM', 'mg/L', 'μg/L'].map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`样品颜色 ${i + 1}`}
                      type="color"
                      value={s.color}
                      onChange={(e) => patch(s.id, { color: e.target.value })}
                    />
                  </td>
                  <td className="source-cell" title={s.source}>
                    {s.source}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        aria-label={`上移样品 ${i + 1}`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ChevronUp size={15} />
                      </button>
                      <button
                        aria-label={`下移样品 ${i + 1}`}
                        disabled={i === w.spectra.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ChevronDown size={15} />
                      </button>
                      <button
                        aria-label={`删除样品 ${i + 1}`}
                        onClick={() => update({ spectra: w.spectra.filter((r) => r.id !== s.id) })}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!w.spectra.length && <div className="empty">导入文件以添加第一条光谱</div>}
        <div className="panel-foot">
          <span className="muted">FWHM 使用零基线主峰；测量范围不足时显示“—”。</span>
          <button
            className="text-button"
            disabled={!w.spectra.length}
            onClick={() =>
              exportExcel(
                w.spectra.flatMap((s) =>
                  s.points.map((p) => ({ 样品: s.name, 波长_nm: p.x, 荧光强度: p.y })),
                ),
                '原始光谱数据',
              ).catch((e) => notify(e.message))
            }
          >
            导出原始数据
          </button>
        </div>
      </section>
      <section className="extraction-panel">
        <div>
          <h3>从光谱提取检测数据</h3>
          <p>在指定波长线性插值，不进行范围外推。</p>
        </div>
        <Field label="波长 / nm">
          <input type="number" value={wave} onChange={(e) => setWave(e.target.value)} />
        </Field>
        <button onClick={screening}>生成对象筛选</button>
        <button className="primary" onClick={extract}>
          生成校准数据
          <ArrowUpRight size={16} />
        </button>
      </section>
      {error && <ErrorNote>{error}</ErrorNote>}
    </>
  );
}
