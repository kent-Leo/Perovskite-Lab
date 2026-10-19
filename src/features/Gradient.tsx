import { useMemo } from 'react';
import { Download, Plus } from 'lucide-react';
import { useWorkspace } from '../state/workspace';
import { gradient, numeric, fmt, units } from '../domain/math';
import { Worksheet } from '../components/Worksheet-v0.2.0-2026.10.19';
import type { WorksheetColumn } from '../domain/worksheet-v0.2.0-2026.10.19';
import { exportExcel } from '../services/download';
import { ErrorNote, Field, Metric, SectionHead } from '../components/ui';
export function Gradient() {
  const { w, update, notify } = useWorkspace(),
    g = w.gradient;
  const set = (p: Partial<typeof g>) => update({ gradient: { ...g, ...p } });
  // Keep blank and invalid cells in the editable input; do not filter/reindex draft rows.
  const targets = /[,，;；\t ]/.test(g.targets)
    ? g.targets
        .trim()
        .split(/[\s,，;；]+/)
        .filter(Boolean)
    : g.targets.split('\n');
  const result = useMemo(() => {
    try {
      return {
        rows: gradient(
          numeric(g.stock) ?? NaN,
          numeric(g.volume) ?? NaN,
          targets.map((value) => numeric(value) ?? NaN),
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
          {result.error && <ErrorNote>{result.error}</ErrorNote>}
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
            <Worksheet
              book="浓度梯度"
              sheet={w.sheetNames?.gradient ?? '梯度配液'}
              onRenameSheet={(name) => update((prev) => ({ sheetNames: { ...prev.sheetNames, gradient: name } }))}
              minRows={Math.max(1, targets.length)}
              columns={
                [
                  {
                    key: 'target',
                    title: '目标浓度',
                    designation: 'X',
                    unit: g.unit,
                    type: 'number',
                  },
                  { key: 'group', title: '组别', designation: 'Label', readOnly: true },
                  {
                    key: 'stock',
                    title: '母液体积',
                    designation: 'Result',
                    unit: 'μL',
                    readOnly: true,
                  },
                  { key: 'fixed', title: '固定添加', unit: 'mL', readOnly: true },
                  { key: 'solvent', title: '预计溶剂', unit: 'mL', readOnly: true },
                  { key: 'final', title: '最终体积', unit: 'mL', readOnly: true },
                  { key: 'actions', title: '删除', readOnly: true },
                ] satisfies WorksheetColumn[]
              }
              rows={targets.map((value, i) => {
                const r = result.rows[i];
                return [
                  value,
                  `C${i}`,
                  r ? String(r.stockUL) : '',
                  r ? String(r.fixedML) : '',
                  r ? String(r.solventML) : '',
                  r ? String(r.finalML) : '',
                  '',
                ];
              })}
              onChange={(rows) => set({ targets: rows.map((r) => r[0]).join('\n') })}
              cellLabel={(i, c) =>
                `${['梯度目标浓度', '梯度组别', '梯度母液体积', '梯度固定添加', '梯度预计溶剂', '梯度最终体积', '梯度操作'][c]} ${i + 1}`
              }
              invalidCell={(i, c) =>
                c === 0 &&
                ((numeric(targets[i]) ?? -1) < 0 ||
                  (numeric(targets[i]) ?? 0) > (numeric(g.stock) ?? 0))
              }
              renderCell={(i, c) =>
                c === 6 && i < targets.length ? (
                  <button
                    className="text-button"
                    aria-label={`删除梯度 ${i + 1}`}
                    onClick={() => set({ targets: targets.filter((_, j) => j !== i).join('\n') })}
                  >
                    删除
                  </button>
                ) : undefined
              }
            />
            {result.rows.some((r) => r.stockUL > 0 && r.stockUL < 1) && (
              <div className="notice-note">部分加样体积小于 1 μL，建议先配制较低浓度的中间液。</div>
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
        </section>
      </div>
    </>
  );
}
