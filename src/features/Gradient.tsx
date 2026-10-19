import { useMemo } from 'react';
import { Download, Plus } from 'lucide-react';
import { useWorkspace } from '../state/workspace';
import { gradient, parseNumbers, numeric, fmt, units } from '../domain/math';
import { exportExcel } from '../services/download';
import { ErrorNote, Field, Metric, SectionHead } from '../components/ui';
export function Gradient() {
  const { w, update, notify } = useWorkspace(),
    g = w.gradient;
  const set = (p: Partial<typeof g>) => update({ gradient: { ...g, ...p } });
  const result = useMemo(() => {
    try {
      return {
        rows: gradient(
          numeric(g.stock) ?? NaN,
          numeric(g.volume) ?? NaN,
          parseNumbers(g.targets),
          numeric(g.fixed) ?? NaN,
        ),
        error: '',
      };
    } catch (e) {
      return { rows: [], error: (e as Error).message };
    }
  }, [g]);
  return (
    <>
      <div className="gradient-layout">
        <section className="panel gradient-form">
          <SectionHead title="浓度梯度设置" detail="每组从同一母液独立配制。" />
          <Field label="母液浓度">
            <input
              type="number"
              min={0}
              value={g.stock}
              onChange={(e) => set({ stock: e.target.value })}
            />
          </Field>
          <Field label="母液与目标浓度单位">
            <select value={g.unit} onChange={(e) => set({ unit: e.target.value })}>
              {units.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="每组最终体积 / mL">
              <input
                type="number"
                min={0}
                value={g.volume}
                onChange={(e) => set({ volume: e.target.value })}
              />
            </Field>
            <Field label="固定添加体积 / mL">
              <input
                type="number"
                min={0}
                value={g.fixed}
                onChange={(e) => set({ fixed: e.target.value })}
              />
            </Field>
          </div>
          <Field label="目标浓度" hint="按输入顺序生成；用逗号、空格或换行分隔。">
            <textarea
              rows={6}
              value={g.targets}
              onChange={(e) => set({ targets: e.target.value })}
            />
          </Field>
          <p className="method-note">
            固定添加体积包含量子点溶液、缓冲液等。母液体积与固定添加体积之和不能超过最终体积。
          </p>
        </section>
        <section className="panel gradient-results">
          <SectionHead
            title="梯度配液表"
            detail="C₁V₁ = C₂V₂"
            action={
              <button
                className="primary small-button"
                disabled={!result.rows.length}
                onClick={() =>
                  exportExcel(
                    result.rows.map((r) => ({
                      组别: `C${r.index - 1}`,
                      目标浓度: r.concentration,
                      浓度单位: g.unit,
                      母液体积_μL: r.stockUL,
                      固定添加_mL: r.fixedML,
                      预计补加溶剂_mL: r.solventML,
                      最终体积_mL: r.finalML,
                    })),
                    '浓度梯度配液表',
                  ).catch((e) => notify(e.message))
                }
              >
                <Download size={15} />
                导出 Excel
              </button>
            }
          />
          {result.error ? (
            <ErrorNote>{result.error}</ErrorNote>
          ) : (
            <>
              <div className="metrics-row three">
                <Metric label="浓度点" value={String(result.rows.length)} unit="组" />
                <Metric label="每组定容" value={fmt(numeric(g.volume))} unit="mL" />
                <Metric
                  label="母液总用量"
                  value={fmt(
                    result.rows.reduce((s, r) => s + r.stockUL, 0),
                    5,
                  )}
                  unit="μL"
                />
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>组别</th>
                      <th>目标 / {g.unit}</th>
                      <th>母液 / μL</th>
                      <th>固定添加 / mL</th>
                      <th>预计溶剂 / mL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.index}>
                        <td>
                          <span className="group-pill">C{r.index - 1}</span>
                        </td>
                        <td>{fmt(r.concentration, 6)}</td>
                        <td className="emphasis-number">{fmt(r.stockUL, 6)}</td>
                        <td>{fmt(r.fixedML, 6)}</td>
                        <td>{fmt(r.solventML, 6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.rows.some((r) => r.stockUL > 0 && r.stockUL < 1) && (
                <div className="notice-note">
                  部分加样体积小于 1 μL，建议先配制较低浓度的中间液。
                </div>
              )}
              <div className="gradient-equation">
                <span>加入母液</span>
                <Plus size={16} />
                <span>固定添加组分</span>
                <Plus size={16} />
                <strong>溶剂定容至 {g.volume} mL</strong>
              </div>
              <p className="muted">表中补加溶剂为体积差估计；实际配制应以最终定容体积为准。</p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
