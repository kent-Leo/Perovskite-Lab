import { useMemo, useState } from 'react';
import { Plus, Trash2, Upload, FlaskConical } from 'lucide-react';
import { useWorkspace } from '../state/workspace';
import { useWorkbook } from '../state/useWorkbook';
import {
  responses,
  uid,
  type ChartStyle,
  type PlotData,
  type Point,
  type ResponseMode,
} from '../domain/types';
import {
  numeric,
  response,
  regress,
  sampleSD,
  detectionLimits,
  parseNumbers,
  fmt,
  units,
  convertConcentration,
} from '../domain/math';
import {
  PlotSheetBar,
  SheetChartGallery,
  type PlotViewMode,
  type SheetGalleryChart,
} from '../components/SheetPlotPanel-v0.9.1-2026.10.27';
import { ChartPanel } from '../components/ChartPanel';
import { ErrorNote, Field, Metric, SectionHead } from '../components/ui';
import { WorkspaceWorksheet as Worksheet } from '../components/WorkspaceWorksheet-v0.9.1-2026.10.27';
import type { WorksheetColumn } from '../domain/worksheet-v0.3.0-2026.10.27';
import { sheetChartTitle, type CalibrationSheetPayload } from '../domain/workbook';
import { exportExcel } from '../services/download';

/** Page default chart title used when a sheet has no title of its own. */
const BASE_TITLE = '浓度–响应校准曲线';

type Fit = ReturnType<typeof regress>;

interface CalibrationChartResult {
  fit: Fit | null;
  /** 参与拟合的数据点。 */
  used: Point[];
  /** 全部已勾选数据点（含拟合范围外的点）。 */
  points: Point[];
  /** 拟合方程文本；未完成拟合时为空串。 */
  equation: string;
  /** 散点 + 拟合线图数据（含 annotation）；未完成拟合时为 null。 */
  data: PlotData | null;
  error: string;
}

function equationOf(fit: Fit): string {
  return `y = ${fmt(fit.slope, 5)}x ${fit.intercept < 0 ? '−' : '+'} ${fmt(Math.abs(fit.intercept), 5)}`;
}

/**
 * 单个 sheet 的拟合结果与校准曲线图数据（纯函数）。
 * 当前活动 sheet 的图表与「全部 sheet」画廊共用，保证两处计算一致；
 * payload 来自该 sheet 的 CalibrationSheetPayload，不能读取其他 sheet 的顶层字段。
 */
function calibrationChart(
  payload: CalibrationSheetPayload,
  style: ChartStyle,
): CalibrationChartResult {
  try {
    const included = payload.calibration.filter((r) => r.included);
    // 空 sheet（无校准行或没有任何参与拟合的行）是空状态而不是拟合错误：
    // 图表显示空状态，画廊卡片也不显示错误（LOD 面板另行提示需先完成拟合）。
    if (!included.length)
      return { fit: null, used: [], points: [], equation: '', data: null, error: '' };
    const f0 = numeric(payload.calF0) ?? NaN,
      min = payload.fitMin.trim() ? numeric(payload.fitMin) : null,
      max = payload.fitMax.trim() ? numeric(payload.fitMax) : null;
    if ((payload.fitMin.trim() && min === null) || (payload.fitMax.trim() && max === null))
      throw new Error('拟合范围应为有效数值');
    if (min !== null && max !== null && max < min) throw new Error('拟合上限应不小于下限');
    const points = included.map((r, i) => {
      const x = numeric(r.concentration),
        f = numeric(r.intensity);
      if (x === null || x < 0 || f === null)
        throw new Error(`已选数据第 ${i + 1} 行存在无效浓度或强度`);
      return { x, y: response(f, f0, payload.calMode) };
    });
    const used = points.filter(
      (p) => (min === null || p.x >= min) && (max === null || p.x <= max),
    );
    const fit = regress(used),
      equation = equationOf(fit);
    return {
      fit,
      used,
      points,
      equation,
      data: {
        series: [
          {
            name: '测量值',
            color: style.primaryColor ?? '#258873',
            kind: 'scatter' as const,
            points: used,
          },
          {
            name: '线性拟合',
            color: style.secondaryColor ?? '#b6873f',
            // The fit line endpoints are derived, not measured data points.
            showPointValues: false,
            points: [
              { x: fit.min, y: fit.slope * fit.min + fit.intercept },
              { x: fit.max, y: fit.slope * fit.max + fit.intercept },
            ],
          },
        ],
        annotation: `${equation}    R² = ${fmt(fit.r2, 6)}`,
      },
      error: '',
    };
  } catch (e) {
    return {
      fit: null,
      used: [],
      points: [],
      equation: '',
      data: null,
      error: (e as Error).message,
    };
  }
}

export function Calibration({ onImport }: { onImport: () => void }) {
  const { w, update, notify } = useWorkspace();
  const wb = useWorkbook('calibration');
  const [showResiduals, setShowResiduals] = useState(false);
  const [viewMode, setViewMode] = useState<PlotViewMode>('active');
  const result = useMemo(
    () =>
      calibrationChart(
        {
          calibration: w.calibration,
          calMode: w.calMode,
          calUnit: w.calUnit,
          calF0: w.calF0,
          blankRepeats: w.blankRepeats,
          manualSigma: w.manualSigma,
          sigmaSource: w.sigmaSource,
          lodFactor: w.lodFactor,
          fitMin: w.fitMin,
          fitMax: w.fitMax,
        },
        w.styles.calibration,
      ),
    [w.calibration, w.calF0, w.calMode, w.fitMin, w.fitMax, w.styles.calibration],
  );
  // 「全部 sheet」画廊：逐 sheet 用同一纯函数计算，未激活 sheet 的数据来自 store。
  const charts: SheetGalleryChart[] = wb.snapshots.map(({ tab, payload }) => {
    const chart = calibrationChart(payload as CalibrationSheetPayload, w.styles.calibration);
    return {
      id: tab.id,
      name: tab.name,
      title: sheetChartTitle(tab, BASE_TITLE),
      data: chart.data,
      error: chart.error || undefined,
    };
  });
  const limits = useMemo(() => {
    try {
      if (!result.fit) throw new Error('完成有效拟合后计算');
      let sigma: number,
        n = 0;
      if (w.sigmaSource === 'manual') {
        sigma = numeric(w.manualSigma) ?? NaN;
      } else {
        const raw = parseNumbers(w.blankRepeats);
        n = raw.length;
        if (n < 3) throw new Error('请提供至少 3 次空白重复测量');
        const values = raw.map((f) => response(f, numeric(w.calF0) ?? NaN, w.calMode));
        sigma = sampleSD(values);
      }
      return { ...detectionLimits(sigma, result.fit.slope, w.lodFactor), sigma, n, error: '' };
    } catch (e) {
      return { lod: null, loq: null, sigma: null, n: 0, error: (e as Error).message };
    }
  }, [result.fit, w.blankRepeats, w.sigmaSource, w.manualSigma, w.calMode, w.calF0, w.lodFactor]);
  function changeUnit(unit: string) {
    try {
      const convert = (s: string) =>
        s.trim() ? String(convertConcentration(numeric(s) ?? NaN, w.calUnit, unit)) : '';
      const rows = w.calibration.map((r) => ({ ...r, concentration: convert(r.concentration) }));
      update({
        calibration: rows,
        calUnit: unit,
        fitMin: convert(w.fitMin),
        fitMax: convert(w.fitMax),
        styles: {
          ...w.styles,
          calibration: {
            ...w.styles.calibration,
            xLabel: `Concentration / ${unit}`,
            xMin: '',
            xMax: '',
          },
        },
      });
    } catch (e) {
      notify((e as Error).message);
    }
  }
  /** Insert a blank calibration point at any position. */
  function insertPoint(index: number) {
    const rows = [...w.calibration];
    const at = Math.max(0, Math.min(index, rows.length));
    rows.splice(at, 0, { id: uid(), concentration: '', intensity: '', included: true });
    update({ calibration: rows });
  }
  const fit = result.fit,
    equation = fit ? result.equation : '—';
  return (
    <>
      <div className="analysis-controls">
        <Field label="响应方式">
          <select
            value={w.calMode}
            onChange={(e) => {
              const mode = e.target.value as ResponseMode;
              update({
                calMode: mode,
                manualSigma: '',
                styles: {
                  ...w.styles,
                  calibration: {
                    ...w.styles.calibration,
                    yLabel: responses[mode],
                    yMin: '',
                    yMax: '',
                  },
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
        <Field label="浓度单位">
          <select value={w.calUnit} onChange={(e) => changeUnit(e.target.value)}>
            {units.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </Field>
        <Field label="固定参考 F₀">
          <input
            type="number"
            value={w.calF0}
            disabled={w.calMode === 'F'}
            onChange={(e) => update({ calF0: e.target.value })}
          />
        </Field>
        <Field label="拟合下限">
          <input
            type="number"
            value={w.fitMin}
            placeholder="全部"
            onChange={(e) => update({ fitMin: e.target.value })}
          />
        </Field>
        <Field label="拟合上限">
          <input
            type="number"
            value={w.fitMax}
            placeholder="全部"
            onChange={(e) => update({ fitMax: e.target.value })}
          />
        </Field>
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
          style={w.styles.calibration}
          onSelect={(id) => {
            wb.select(id);
            setViewMode('active');
          }}
        />
      ) : (
        <ChartPanel
          kind="calibration"
          title={BASE_TITLE}
          chartTitle={wb.chartTitle}
          onChartTitleChange={wb.setChartTitle}
          subtitle={`${wb.activeName} · 普通最小二乘 · 含截距 · 不加权`}
          data={result.data ?? { series: [] }}
        />
      )}
      <div className="metrics-row four">
        <Metric label="拟合方程" value={equation} />
        <Metric label="决定系数 R²" value={fmt(fit?.r2, 6)} />
        <Metric label="参与拟合" value={String(fit?.n ?? 0)} unit="个点" />
        <Metric
          label="拟合范围"
          value={fit ? `${fmt(fit.min)}–${fmt(fit.max)}` : '—'}
          unit={w.calUnit}
        />
      </div>
      {fit?.n === 2 && (
        <div className="notice-note">
          两点可确定直线，但不足以评估残差与线性可靠性。请补充浓度点和重复测量。
        </div>
      )}
      {fit && fit.r2 === null && <div className="notice-note">响应值恒定，R² 未定义。</div>}
      <div className="calibration-bottom">
        <section className="panel">
          <SectionHead
            title="校准数据"
            detail="勾选参与拟合的数据点，再设置需要的浓度范围。"
            action={
              <div className="button-group">
                <button className="small-button" onClick={onImport}>
                  <Upload size={15} />
                  导入
                </button>
                <button
                  className="small-button"
                  onClick={() =>
                    update({
                      calibration: [
                        ...w.calibration,
                        { id: uid(), concentration: '', intensity: '', included: true },
                      ],
                    })
                  }
                >
                  <Plus size={15} />
                  添加点
                </button>
              </div>
            }
          />
          <Worksheet
            sheetId={wb.activeId}
            book="校准与检出限"
            sheet={wb.activeName}
            onRenameSheet={wb.rename}
            sheetTabs={wb.tabs}
            activeSheetId={wb.activeId}
            onSelectSheet={wb.select}
            onCreateSheet={wb.create}
            onDeleteSheet={wb.remove}
            onInsertRow={insertPoint}
            minRows={Math.max(1, w.calibration.length)}
            columns={
              [
                {
                  key: 'concentration',
                  title: '浓度',
                  designation: 'X',
                  unit: w.calUnit,
                  type: 'number',
                },
                {
                  key: 'intensity',
                  title: '强度 F',
                  designation: 'Y',
                  unit: 'a.u.',
                  type: 'number',
                },
                { key: 'included', title: '参与拟合', type: 'checkbox', defaultChecked: true },
                {
                  key: 'response',
                  title: '响应',
                  designation: 'Result',
                  comment: responses[w.calMode],
                  readOnly: true,
                },
                { key: 'actions', title: '删除', readOnly: true },
              ] satisfies WorksheetColumn[]
            }
            rows={w.calibration.map((r) => {
              let value: number | null = null;
              try {
                const f = numeric(r.intensity);
                if (f !== null) value = response(f, numeric(w.calF0) ?? NaN, w.calMode);
              } catch {
                /* invalid response stays blank */
              }
              return [r.concentration, r.intensity, String(r.included), fmt(value, 8), ''];
            })}
            onChange={(rows) =>
              update({
                calibration: rows.map((r, i) => ({
                  id: w.calibration[i]?.id ?? uid(),
                  concentration: r[0],
                  intensity: r[1],
                  included: r[2] === 'true',
                })),
              })
            }
            cellLabel={(i, c) =>
              `${['校准浓度', '校准强度', '拟合点', '校准响应', '校准操作'][c]} ${i + 1}`
            }
            invalidCell={(i, c) =>
              c === 0 &&
              !!w.calibration[i]?.concentration.trim() &&
              (numeric(w.calibration[i].concentration) ?? -1) < 0
            }
            renderCell={(i, c) =>
              c === 4 && w.calibration[i] ? (
                <button
                  className="icon-button"
                  aria-label={`删除校准点 ${i + 1}`}
                  onClick={() => update({ calibration: w.calibration.filter((_, j) => j !== i) })}
                >
                  <Trash2 size={15} />
                </button>
              ) : undefined
            }
          />
          <div className="panel-foot">
            <button
              className="text-button"
              disabled={!fit}
              onClick={() => setShowResiduals((v) => !v)}
            >
              {showResiduals ? '收起残差' : '查看残差'}
            </button>
            <button
              className="text-button"
              disabled={!fit}
              onClick={() =>
                exportExcel(
                  result.used.map((p, i) => ({
                    浓度: p.x,
                    单位: w.calUnit,
                    响应: p.y,
                    拟合: fit!.slope * p.x + fit!.intercept,
                    残差: fit!.residuals[i].y,
                    斜率: fit!.slope,
                    截距: fit!.intercept,
                    R2: fit!.r2,
                    LOD: limits.lod,
                    LOQ: limits.loq,
                    σ: limits.sigma,
                    LOD系数: w.lodFactor,
                    σ来源: w.sigmaSource === 'manual' ? '手动输入' : '空白重复测量',
                  })),
                  '校准与检出限',
                ).catch((e) => notify(e.message))
              }
            >
              导出拟合结果
            </button>
          </div>
          {showResiduals && fit && (
            <div className="residual-list">
              {fit.residuals.map((p, i) => (
                <span key={i}>
                  {fmt(p.x)} {w.calUnit}：{fmt(p.y)}
                </span>
              ))}
            </div>
          )}
        </section>
        <section className="panel lod-panel">
          <SectionHead
            title="LOD / LOQ"
            detail="使用响应标准差与斜率绝对值估计。"
            action={<FlaskConical size={21} />}
          />
          <div className="form-grid">
            <Field label="σ 来源">
              <select
                value={w.sigmaSource}
                onChange={(e) => update({ sigmaSource: e.target.value as 'replicates' | 'manual' })}
              >
                <option value="replicates">空白重复测量</option>
                <option value="manual">手动输入响应 σ</option>
              </select>
            </Field>
            <Field label="LOD 系数">
              <select
                value={w.lodFactor}
                onChange={(e) => update({ lodFactor: Number(e.target.value) as 3 | 3.3 })}
              >
                <option value={3.3}>3.3 σ / |k|</option>
                <option value={3}>3 σ / |k|</option>
              </select>
            </Field>
          </div>
          {w.sigmaSource === 'replicates' ? (
            <Field
              label="空白原始强度重复值"
              hint="至少 3 次，用逗号或换行分隔；转换到当前响应尺度后计算样本标准差。"
            >
              <textarea
                rows={3}
                value={w.blankRepeats}
                placeholder="例如：11980, 12020, 11990"
                onChange={(e) => update({ blankRepeats: e.target.value })}
              />
            </Field>
          ) : (
            <Field label={`标准差 σ · ${responses[w.calMode]} 尺度`}>
              <input
                type="number"
                min={0}
                value={w.manualSigma}
                onChange={(e) => update({ manualSigma: e.target.value })}
              />
            </Field>
          )}
          {limits.error ? (
            <ErrorNote>{limits.error}</ErrorNote>
          ) : (
            <>
              <div className="lod-results">
                <Metric label="LOD" value={fmt(limits.lod, 4)} unit={w.calUnit} />
                <Metric label="LOQ" value={fmt(limits.loq, 4)} unit={w.calUnit} />
              </div>
              <p className="muted">
                σ = {fmt(limits.sigma, 5)}
                {limits.n ? ` · n = ${limits.n}` : ''}；LOQ = 10σ / |k|
              </p>
            </>
          )}
          <p className="method-note">
            结果为公式估计，需低浓度样品验证。高 R² 不能单独证明检出能力。
            <a
              href="https://database.ich.org/sites/default/files/ICH_Q2%28R2%29_Guideline_2023_1130_ErrorCorrection_2025.pdf"
              target="_blank"
              rel="noreferrer"
            >
              计算依据：ICH Q2(R2)
            </a>
          </p>
        </section>
      </div>
    </>
  );
}
