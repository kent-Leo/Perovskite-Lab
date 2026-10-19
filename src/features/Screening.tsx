import { useMemo, useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, GripVertical, Upload } from 'lucide-react';
import { useWorkspace } from '../state/workspace';
import {
  roles,
  responses,
  uid,
  type ObjectRow,
  type Role,
  type ResponseMode,
} from '../domain/types';
import { numeric, response, fmt, units } from '../domain/math';
import { ChartPanel } from '../components/ChartPanel';
import { ErrorNote, Field, Metric, SectionHead } from '../components/ui';
import { exportExcel } from '../services/download';
export function Screening({ onImport }: { onImport: () => void }) {
  const { w, update, notify } = useWorkspace();
  const [drag, setDrag] = useState<number | null>(null);
  const result = useMemo(() => {
    try {
      const blank = w.objects.find((o) => o.id === w.blankId),
        f0 = numeric(blank?.intensity) ?? NaN;
      const values = w.objects.map((o) => {
        const f = numeric(o.intensity);
        if (!o.name.trim()) throw new Error('请填写所有分析对象的名称');
        if (f === null) throw new Error(`${o.name} 的强度不是有效数值`);
        return response(f, f0, w.screenMode);
      });
      return { values, f0, error: '' };
    } catch (e) {
      return { values: [], f0: NaN, error: (e as Error).message };
    }
  }, [w.objects, w.blankId, w.screenMode]);
  const patch = (id: string, p: Partial<ObjectRow>) =>
    update((prev) => ({ objects: prev.objects.map((o) => (o.id === id ? { ...o, ...p } : o)) }));
  function move(from: number, to: number) {
    if (to < 0 || to >= w.objects.length) return;
    const rows = [...w.objects];
    rows.splice(to, 0, rows.splice(from, 1)[0]);
    update({ objects: rows });
  }
  const targets = w.objects.filter((o) => o.role === 'target');
  return (
    <>
      <div className="analysis-controls">
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
      </div>
      {result.error && <ErrorNote>{result.error}</ErrorNote>}
      <ChartPanel
        kind="screening"
        title="分析对象筛选"
        subtitle={`${responses[w.screenMode]} · ${w.objects.length} 个对象`}
        data={{
          categories: w.objects.map((o) => o.name),
          series: result.error
            ? []
            : w.objects.map((o, i) => ({
                name: o.name,
                color:
                  o.role === 'target'
                    ? (w.styles.screening.secondaryColor ?? '#b6873f')
                    : o.id === w.blankId
                      ? '#a7b8b3'
                      : (w.styles.screening.primaryColor ?? '#258873'),
                kind: 'bar' as const,
                points: [{ x: i, y: result.values[i] }],
              })),
        }}
      />
      <div className="metrics-row three">
        <Metric label="分析对象" value={String(w.objects.length)} unit="组" />
        <Metric label="空白强度 F₀" value={fmt(result.f0, 6)} unit="a.u." />
        <Metric label="目标对象" value={targets.map((t) => t.name).join('、') || '未指定'} />
      </div>
      <section className="panel">
        <SectionHead
          title="自定义分析对象"
          detail="可拖动调整顺序，也可使用上下移动按钮。空白参考需在上方明确指定。"
          action={
            <div className="button-group">
              <button className="small-button" onClick={onImport}>
                <Upload size={15} />
                导入表格
              </button>
              <button
                className="small-button primary"
                onClick={() =>
                  update({
                    objects: [
                      ...w.objects,
                      {
                        id: uid(),
                        name: `对象 ${w.objects.length + 1}`,
                        role: 'other',
                        concentration: '',
                        unit: 'μM',
                        intensity: '',
                        notes: '',
                      },
                    ],
                  })
                }
              >
                <Plus size={15} />
                添加对象
              </button>
            </div>
          }
        />
        <div className="table-scroll">
          <table className="editable-table">
            <thead>
              <tr>
                <th>顺序</th>
                <th>分析对象名称</th>
                <th>角色</th>
                <th>浓度</th>
                <th>单位</th>
                <th>荧光强度 F</th>
                <th>备注</th>
                <th>响应值</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {w.objects.map((o, i) => (
                <tr
                  key={o.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag !== null) move(drag, i);
                    setDrag(null);
                  }}
                >
                  <td>
                    <button
                      className="drag-handle"
                      draggable
                      aria-label={`拖动对象 ${i + 1}`}
                      onDragStart={() => setDrag(i)}
                      onDragEnd={() => setDrag(null)}
                    >
                      <GripVertical size={16} />
                    </button>
                  </td>
                  <td>
                    <input
                      aria-label={`对象名称 ${i + 1}`}
                      value={o.name}
                      onChange={(e) => patch(o.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`对象角色 ${i + 1}`}
                      value={o.role}
                      onChange={(e) => patch(o.id, { role: e.target.value as Role })}
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
                      aria-label={`对象浓度 ${i + 1}`}
                      type="number"
                      min={0}
                      value={o.concentration}
                      onChange={(e) => patch(o.id, { concentration: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`对象单位 ${i + 1}`}
                      value={o.unit}
                      onChange={(e) => patch(o.id, { unit: e.target.value })}
                    >
                      {units.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`对象强度 ${i + 1}`}
                      type="number"
                      value={o.intensity}
                      onChange={(e) => patch(o.id, { intensity: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`对象备注 ${i + 1}`}
                      value={o.notes}
                      onChange={(e) => patch(o.id, { notes: e.target.value })}
                    />
                  </td>
                  <td className="number-cell">{fmt(result.values[i], 5)}</td>
                  <td>
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
                        onClick={() =>
                          update({
                            objects: w.objects.filter((r) => r.id !== o.id),
                            blankId: w.blankId === o.id ? '' : w.blankId,
                          })
                        }
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
    </>
  );
}
