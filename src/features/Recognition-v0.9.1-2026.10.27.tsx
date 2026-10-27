import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Plus, Save, Trash2 } from 'lucide-react';
import { useWorkspace } from '../state/workspace';
import { useWorkbook } from '../state/useWorkbook';
import { Worksheet, type WorksheetChange } from '../components/Worksheet-v0.3.0-2026.10.27';
import { ChartPanel } from '../components/ChartPanel';
import { ErrorNote, Field, SectionHead } from '../components/ui';
import { columnLetter, type WorksheetColumn } from '../domain/worksheet-v0.3.0-2026.10.27';
import { createSheetWithPayload, type RecognitionSheetPayload } from '../domain/workbook';
import { type ChartStyle, type PlotData } from '../domain/types';
import { chartSVG } from '../domain/chart';
import {
  addProbe, analyzeRecognition, clusterColor, defaultRecognition, demoRecognition, finiteValue,
  ionColor, moveProbe, preprocessingLabel, recognitionFingerprint, removeProbe,
  RECOGNITION_LIMITS, type CellIssue, type RecognitionChart, type RecognitionData, type RecognitionSettings,
} from '../domain/recognition-v0.9.1-2026.10.27';
import { hierarchySVG } from '../domain/recognition-charts-v0.9.1-2026.10.27';
import { recognitionExcel, recognitionTables } from '../services/recognition-export-v0.9.1-2026.10.27';
import { dateStamp } from '../services/download';
import {
  applyRecognitionInput, INPUT_PROBE_START, insertRecognitionInput, moveRecognitionInput,
  prepareRecognitionPaste, recognitionInputGrid, recognitionInputIssue, recognitionInputOrder, removeRecognitionInput,
} from '../domain/recognition-input-v0.9.1-2026.10.27';
import './Recognition-v0.9.1-2026.10.27.css';

const tableNames = ['实验数据', '猝灭率', 'PCA得分', 'PCA载荷', '方差解释率', '聚类结果', '分析设置'];
const chartNames: Record<RecognitionChart, string> = { scores: 'PCA 得分图', loadings: 'PCA 载荷图', tree: '层次聚类树状图', heatmap: '响应热图与树状图' };
const clone = (d: RecognitionData) => structuredClone(d);

export function Recognition() {
  const { w, update, notify } = useWorkspace(), wb = useWorkbook('recognition');
  const d = w.recognition ?? defaultRecognition(), s = d.settings;
  const [view, setView] = useState('实验数据'), [chart, setChart] = useState<RecognitionChart>('scores');
  const [batchFilter, setBatchFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const tableRoot = useRef<HTMLDivElement>(null);
  const history = useRef(new Map<string, { past: RecognitionData[]; future: RecognitionData[] }>());
  const getHistory = () => {
    let entry = history.current.get(wb.activeId);
    if (!entry) { entry = { past: [], future: [] }; history.current.set(wb.activeId, entry); }
    return entry;
  };
  const change = (next: RecognitionData) => {
    const h = getHistory(); h.past = [...h.past.slice(-19), clone(d)]; h.future = [];
    update({ recognition: next });
  };
  const undo = (redo = false) => {
    const h = getHistory(), from = redo ? h.future : h.past, next = from.pop();
    if (!next) return;
    (redo ? h.past : h.future).push(clone(d)); update({ recognition: next });
  };
  const externalHistory = { canUndo: getHistory().past.length > 0, canRedo: getHistory().future.length > 0,
    undo: () => undo(), redo: () => undo(true) };
  const settings = (patch: Partial<RecognitionSettings>) => change({ ...d, settings: { ...s, ...patch } });
  const fingerprint = recognitionFingerprint(d);
  const validationLabels = JSON.stringify([d.rows.map((r) => [r.sample, r.ion, r.replicate]), d.probes.map((p) => p.name), d.batches.map((b) => b.name)]);
  // Purely visual changes do not rerun the numerical algorithms.
  const computed = useMemo(() => analyzeRecognition(d), [fingerprint, validationLabels]);
  const a = { ...computed, selected: d.probes.filter((p) => p.selected) };
  const tables = recognitionTables(d, a);
  const currentTable = d.snapshot?.table ?? tables.find((table) => table.name === view) ?? tables[0];
  const snapshot = d.snapshot;
  const editable = !snapshot && view === '实验数据';
  const inputOrder = recognitionInputOrder(d);
  const activeBatchFilter = d.batches.some((b) => b.id === batchFilter) ? batchFilter : '';
  const visibleInput = inputOrder.filter((ref) => !activeBatchFilter || (ref.type === 'blank'
    ? ref.id === activeBatchFilter : d.rows.find((r) => r.id === ref.id)?.batchId === activeBatchFilter));
  const inputGrid = recognitionInputGrid(d, visibleInput);
  const invalidInputCells = new Set(a.issues.map((issue) => {
    const at = recognitionInputIssue(d, issue, visibleInput); return `${at.row}:${at.column}`;
  }));
  const ready = !a.errors.length && !!a.pca && !!a.clusters;
  const rank = a.pca?.rank ?? 0;
  // Always show distinct, actually available axes after data/rank changes.
  const pcX = s.pcX < rank ? s.pcX : 0;
  const pcY = s.pcY < rank && s.pcY !== pcX ? s.pcY : pcX === 0 ? 1 : 0;
  const display = (value: string | number | null, column: number) => value === null ? '' : typeof value !== 'number' ? value
    : currentTable.name === '聚类结果' || currentTable.name === '分析设置' ? String(value)
    : (currentTable.name === '猝灭率' && column >= 3 && (column - 3) % 2 === 1)
      ? `${value.toFixed(s.decimals)}%` : value.toFixed(s.decimals);
  const modifyProbe = (id: string, patch: Partial<RecognitionData['probes'][number]>) =>
    change({ ...d, probes: d.probes.map((probe) => probe.id === id ? { ...probe, ...patch } : probe) });
  const insertProbe = (index?: number) => {
    try { change(addProbe(d, index)); } catch (e) { notify((e as Error).message); }
  };
  const insertRow = (at: number) => {
    const ref = visibleInput[at];
    const index = ref ? inputOrder.findIndex((r) => r.id === ref.id && r.type === ref.type) : inputOrder.length;
    change(insertRecognitionInput(d, 'sample', index, activeBatchFilter || undefined));
  };
  const jump = (issue: CellIssue) => {
    const at = recognitionInputIssue(d, issue);
    setView('实验数据'); setBatchFilter('');
    requestAnimationFrame(() => {
      const cell = tableRoot.current?.querySelector<HTMLElement>(`[data-cell="${at.row}:${at.column}"]`);
      cell?.scrollIntoView({ block: 'center', inline: 'nearest' });
      (cell?.querySelector<HTMLElement>('input,select') ?? cell)?.focus();
    });
  };
  const inputColumns: WorksheetColumn[] = [
    { key: 'type', title: '类型', type: 'select', options: [{ value: '空白', label: '空白' }, { value: '样品', label: '样品' }] },
    { key: 'batch', title: '批次', designation: 'Meta', comment: '空白行填写批次名称；样品行选择对应批次' },
    { key: 'sample', title: '样本 ID', designation: 'Label' },
    { key: 'ion', title: '离子种类', designation: 'Label', comment: '自由输入，如 Fe³⁺、CO₃²⁻' },
    { key: 'replicate', title: '平行编号', designation: 'Meta' },
    ...d.probes.map((p): WorksheetColumn => ({ key: p.id, title: p.name, color: p.color, designation: 'Y', unit: 'a.u.', comment: '空白行：F₀；样品行：F；同一行须来自同一次实验' })),
    { key: 'delete', title: '删除行', readOnly: true },
  ];
  const columns = editable ? inputColumns.map((column): WorksheetColumn => ({ ...column, headerFields: d.probes.some((p) => p.id === column.key) ? ['title'] : [] }))
    : currentTable.headers.map((title, i): WorksheetColumn => ({ key: `result-${i}`, title, readOnly: true }));
  const rows = editable ? inputGrid
    : currentTable.rows.map((row) => row.map(display));
  const tableChange = (values: string[][], event?: WorksheetChange) => change(applyRecognitionInput(d, visibleInput, values, event));
  const saveResult = () => {
    try {
      const capturedAt = `${dateStamp()} ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date())}`;
      const result: RecognitionData = { ...clone(d), snapshot: {
        table: cloneTable(currentTable), sourceSheetId: wb.activeId, sourceName: wb.activeName,
        sourceFingerprint: fingerprint, capturedAt,
      } };
      update((prev) => createSheetWithPayload(prev, 'recognition', `${currentTable.name}-${dateStamp()}`, { recognition: result }));
      notify('结果已保存为新的只读 Sheet 快照，原始 Sheet 保留');
    } catch (e) { notify((e as Error).message); }
  };
  const source = snapshot && wb.snapshots.find((item) => item.tab.id === snapshot.sourceSheetId);
  const sourceData = source && (source.payload as RecognitionSheetPayload).recognition;
  const staleSnapshot = snapshot && (!sourceData || recognitionFingerprint(sourceData) !== snapshot.sourceFingerprint);
  const ids = [...new Set(d.rows.map((r) => r.ion).filter(Boolean))];
  const plot: PlotData = { series: [] };
  if (ready && rank >= 2 && (chart === 'scores' || chart === 'loadings')) {
    if (chart === 'scores') plot.series = ids.map((ion) => ({ name: ion, color: ionColor(d, ion), kind: 'scatter',
      pointShape: s.shape, opacity: s.opacity, labels: s.labels,
      points: d.rows.flatMap((r, i) => r.ion !== ion ? [] : [{
        x: a.pca!.scores[i][pcX], y: a.pca!.scores[i][pcY], label: `${r.sample} / ${r.replicate}`,
        tooltip: `样本 ID: ${r.sample}\n离子: ${r.ion}\n平行编号: ${r.replicate}\nPC${pcX + 1}: ${a.pca!.scores[i][pcX]}\nPC${pcY + 1}: ${a.pca!.scores[i][pcY]}`,
      }]),
    }));
    else plot.series = a.selected.map((p, i) => ({ name: p.name, color: p.color, kind: 'scatter', arrows: true, labels: true,
      points: [{ x: a.pca!.loadings[i][pcX], y: a.pca!.loadings[i][pcY], label: p.name,
        tooltip: `${p.name}\nPC${pcX + 1}: ${a.pca!.loadings[i][pcX]}\nPC${pcY + 1}: ${a.pca!.loadings[i][pcY]}` }],
    }));
  }
  const baseStyle = s.styles[chart];
  const chartStyle: ChartStyle = chart === 'scores' || chart === 'loadings' ? { ...baseStyle,
    xLabel: `${baseStyle.xLabel.replace(/PC\d+.*$/, '').trim()} PC${pcX + 1} (${((a.pca?.explained[pcX] ?? 0) * 100).toFixed(2)}%)`.trim(),
    yLabel: `${baseStyle.yLabel.replace(/PC\d+.*$/, '').trim()} PC${pcY + 1} (${((a.pca?.explained[pcY] ?? 0) * 100).toFixed(2)}%)`.trim(),
    ...(chart === 'loadings' ? { xMin: baseStyle.xMin || '-1.2', xMax: baseStyle.xMax || '1.2', yMin: baseStyle.yMin || '-1.2', yMax: baseStyle.yMax || '1.2' } : {}),
  } : baseStyle;
  const setStyle = (patch: Partial<ChartStyle>) => settings({ styles: { ...s.styles, [chart]: { ...baseStyle, ...patch } } });
  const resetDemo = () => {
    if (d.rows.length && !window.confirm('用演示数据替换当前多探针 Sheet？可通过撤销恢复。')) return;
    change(demoRecognition()); setView('实验数据'); setBatchFilter('');
  };
  return <div className="recognition" data-testid="recognition-module">
    <section className="panel recognition-intro">
      <SectionHead title="从多探针响应识别样本" detail="空白与样品在同表录入：空白行填写 F₀，样品行填写 F，并按批次关联。每次平行实验分别保留。"
        action={<div className="recognition-actions"><button onClick={resetDemo} disabled={!!snapshot}>载入演示数据</button>
          <button disabled={!ready || !!snapshot || busy} onClick={async () => {
            setBusy(true); try { await recognitionExcel(d, a); notify('完整分析工作簿已导出'); }
            catch (e) { notify((e as Error).message); } finally { setBusy(false); }
          }}><Download size={15} />{busy ? '导出中…' : '导出分析 Excel'}</button></div>} />
      {d.demo && <p className="recognition-demo">演示数据 · 人工生成，仅用于验证操作流程。</p>}
      <p className="muted">q = (F₀−F)/F₀；Q = q × 100%。负值表示荧光增强。原始强度独立保存，结果表只读。</p>
      {snapshot ? <div className="recognition-snapshot" role="status">
        结果快照 · {snapshot.capturedAt} · 来源：{snapshot.sourceName}。快照保留保存时的数据。
        {staleSnapshot && <strong> 来源数据已改变或已删除，请返回原始 Sheet 重新分析。</strong>}
        {source && <button onClick={() => { wb.select(source.tab.id); setView('实验数据'); setBatchFilter(''); }}>返回来源 Sheet</button>}
      </div> : <details className="recognition-manage" open>
        <summary>探针管理</summary>
        <div className="recognition-probes">
          {d.probes.map((probe, i) => <div className="recognition-probe" key={probe.id}>
            <input type="checkbox" aria-label={`选择探针 ${i + 1}`} checked={probe.selected} onChange={(e) => modifyProbe(probe.id, { selected: e.target.checked })} />
            <input type="color" aria-label={`探针颜色 ${i + 1}`} value={probe.color} onChange={(e) => modifyProbe(probe.id, { color: e.target.value })} />
            <input aria-label={`探针名称 ${i + 1}`} value={probe.name} onChange={(e) => modifyProbe(probe.id, { name: e.target.value })} />
            <button aria-label={`上移探针 ${i + 1}`} disabled={!i} onClick={() => change(moveProbe(d, i, i - 1))}><ArrowUp size={14} /></button>
            <button aria-label={`下移探针 ${i + 1}`} disabled={i === d.probes.length - 1} onClick={() => change(moveProbe(d, i, i + 1))}><ArrowDown size={14} /></button>
            <button aria-label={`删除探针 ${i + 1}`} onClick={() => change(removeProbe(d, probe.id))}><Trash2 size={14} /></button>
          </div>)}
        </div>
        <div className="recognition-actions"><button onClick={() => insertProbe()}><Plus size={14} />添加探针</button>
          <span className="muted">已选 {a.selected.length} 个探针；实验数据表共用这些探针列。</span></div>
      </details>}
    </section>
    {!snapshot && <section className="panel recognition-options">
      <div className="form-grid">
        <Field label="预处理方式"><select value={s.preprocessing} onChange={(e) => settings({ preprocessing: e.target.value as RecognitionSettings['preprocessing'] })}>
          <option value="center">仅中心化</option><option value="zscore">中心化＋Z-score 标准化</option></select></Field>
        <Field label="结果显示小数位"><input type="number" min={0} max={10} value={s.decimals} onChange={(e) => settings({ decimals: Math.max(0, Math.min(10, Math.round(Number(e.target.value)))) })} /></Field>
        <Field label="聚类截断方式"><select value={s.cutMode} onChange={(e) => settings({ cutMode: e.target.value as 'count' | 'height' })}>
          <option value="count">聚类数量</option><option value="height">截断高度</option></select></Field>
        <Field label={s.cutMode === 'count' ? '聚类数量' : '截断高度'}><input type="number" min={s.cutMode === 'count' ? 1 : 0} step={s.cutMode === 'count' ? 1 : 'any'}
          value={s.cutMode === 'count' ? s.clusterCount : s.cutHeight}
          onChange={(e) => settings(s.cutMode === 'count' ? { clusterCount: Number(e.target.value) } : { cutHeight: e.target.value })} /></Field>
      </div>
      <p className="muted">{preprocessingLabel(s.preprocessing)}。聚类固定采用欧氏距离＋Ward 法，基于全部所选探针，使用与 PCA 相同的预处理。单 Sheet 上限：{RECOGNITION_LIMITS.samples} 行样品、{RECOGNITION_LIMITS.probes} 个探针。空白仅提供 F₀，不进入 PCA 与聚类。</p>
    </section>}
    <section className="panel recognition-data">
      <SectionHead title={snapshot ? '已保存的结果 Sheet' : '识别分析工作表'} action={!snapshot && <button disabled={!ready || !wb.canCreate || editable} onClick={saveResult}><Save size={14} />保存当前结果到新 Sheet</button>} />
      {!snapshot && <div className="recognition-tabs" role="group" aria-label="分析数据视图">{tableNames.map((name) => <button key={name} className={view === name ? 'selected' : ''} aria-pressed={view === name} onClick={() => setView(name)}>{name}</button>)}</div>}
      {editable && <div className="recognition-input-tools">
        <div className="recognition-actions">
          <button onClick={() => { change(insertRecognitionInput(d, 'blank')); setBatchFilter(''); }}><Plus size={14} />添加空白</button>
          <button onClick={() => change(insertRecognitionInput(d, 'sample', undefined, activeBatchFilter || undefined))}><Plus size={14} />添加样品</button>
          <label>批次筛选 <select aria-label="实验数据批次筛选" value={activeBatchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
            <option value="">全部批次</option>{d.batches.map((b) => <option key={b.id} value={b.id}>{b.name || '未命名批次'}</option>)}
          </select></label>
          <span className="muted">{d.batches.length} 行空白 · {d.rows.length} 行样品{activeBatchFilter && ` · 当前显示 ${visibleInput.length} 行`}</span>
        </div>
        <p className="muted">浅色行为空白，每批保留一组 F₀；样品按批次使用对应空白。</p>
      </div>}
      <div ref={tableRoot}>
        <Worksheet key={`${wb.activeId}/${snapshot ? 'snapshot' : view}`} book="多探针识别分析" sheet={wb.activeName}
          sheetTabs={wb.tabs} activeSheetId={wb.activeId} onSelectSheet={(id) => { wb.select(id); setBatchFilter(''); }} onCreateSheet={() => { wb.create(); setView('实验数据'); setBatchFilter(''); }} onDeleteSheet={wb.remove} onRenameSheet={wb.rename}
          columns={columns} rows={rows} minRows={Math.max(1, rows.length)} allowAddRows={editable}
          externalHistory={editable ? externalHistory : undefined}
          onChange={editable ? tableChange : undefined}
          preparePaste={editable ? (text, at) => prepareRecognitionPaste(inputGrid, columns, at, text) : undefined}
          onInsertRow={editable ? insertRow : undefined}
          onAddColumn={editable ? () => insertProbe() : undefined}
          onInsertColumn={editable ? (c) => insertProbe(Math.max(0, c - INPUT_PROBE_START)) : undefined}
          onMoveRow={editable ? (from, to) => change(moveRecognitionInput(d, visibleInput, from, to)) : undefined}
          onMetadataChange={editable ? (c, field, value) => {
            const p = d.probes[c - INPUT_PROBE_START];
            if (p && field === 'title') modifyProbe(p.id, { name: value });
          } : undefined}
          cellLabel={(r, c) => `${snapshot ? currentTable.name : view} 第 ${r + 1} 行第 ${c + 1} 列`}
          invalidCell={(r, c) => editable && invalidInputCells.has(`${r}:${c}`)}
          rowClassName={editable ? (r) => visibleInput[r]?.type === 'blank' ? 'recognition-blank-row' : undefined : undefined}
          readOnlyCell={editable ? (r, c) => visibleInput[r]?.type === 'blank' && c >= 2 && c < INPUT_PROBE_START : undefined}
          renderCell={editable ? (r, c) => {
            const ref = visibleInput[r];
            if (!ref) return undefined;
            if (c === 1 && ref.type === 'sample') {
              const sample = d.rows.find((row) => row.id === ref.id)!;
              return <select aria-label={`实验数据 第 ${r + 1} 行第 2 列`} value={sample.batchId}
                aria-invalid={invalidInputCells.has(`${r}:1`) || undefined} onChange={(e) => {
                  change({ ...d, rows: d.rows.map((row) => row.id === ref.id ? { ...row, batchId: e.target.value } : row) });
                }}><option value="">请选择批次</option>{d.batches.map((b) => <option key={b.id} value={b.id}>{b.name || '未命名批次'}</option>)}</select>;
            }
            if (c !== columns.length - 1) return undefined;
            return <button aria-label={`删除${ref.type === 'blank' ? '空白' : '样品'} ${r + 1}`} onClick={() => {
              try { change(removeRecognitionInput(d, ref)); } catch (e) { notify((e as Error).message); }
            }}><Trash2 size={14} /></button>;
          } : undefined} />
      </div>
      {editable && <p className="muted">Excel 粘贴顺序：类型、批次、样本 ID、离子种类、平行编号、各探针强度。空白行的样本信息留空；样品行按批次匹配 F₀。支持整块粘贴、拖动行号排序、撤销与重做。</p>}
    </section>
    {!snapshot && <>
      {(a.errors.length > 0 || a.issues.length > 0) && <ErrorNote><strong>{a.errors.join('；') || '部分未选探针 / 未用批次的猝灭率不可计算'}</strong>
        <div className="recognition-issues">{a.issues.slice(0, 18).map((issue, i) => {
          const at = recognitionInputIssue(d, issue);
          return <button key={i} onClick={() => jump(issue)}>实验数据 {columnLetter(at.column)}{at.row + 1}：{issue.reason}{!issue.blocking && '（不参与本次分析）'}</button>;
        })}{a.issues.length > 18 && <span>共 {a.issues.length} 处，先显示前 18 处；修正后自动更新。</span>}</div></ErrorNote>}
      {a.warnings.map((warning) => <p className="recognition-warning" role="status" key={warning}>{warning}</p>)}
      {ready && <>
        <section className="panel recognition-visual-options">
          <SectionHead title="图形与颜色" detail={`当前：${d.rows.length} 行独立实验 · ${a.selected.length} 个探针 · ${rank} 个有效主成分。颜色与标签不作为数值特征。`} />
          <div className="recognition-tabs" role="group" aria-label="识别分析图形">{(Object.keys(chartNames) as RecognitionChart[]).map((id) => <button key={id} aria-pressed={chart === id} className={chart === id ? 'selected' : ''} onClick={() => setChart(id)}>{chartNames[id]}</button>)}</div>
          <div className="form-grid">
            {(chart === 'scores' || chart === 'loadings') && <>
              <Field label="横轴主成分"><select value={pcX} onChange={(e) => { const x = Number(e.target.value); settings({ pcX: x, ...(x === pcY ? { pcY: pcX } : {}) }); }}>
                {a.pca!.explained.map((v, i) => <option value={i} key={i}>PC{i + 1} ({(v * 100).toFixed(2)}%)</option>)}</select></Field>
              <Field label="纵轴主成分"><select value={rank < 2 ? 0 : pcY} disabled={rank < 2} onChange={(e) => settings({ pcY: Number(e.target.value) })}>
                {a.pca!.explained.map((v, i) => <option value={i} disabled={i === pcX} key={i}>PC{i + 1} ({(v * 100).toFixed(2)}%)</option>)}</select></Field>
            </>}
            {chart === 'scores' && <>
              <Field label="样本点形状"><select value={s.shape} onChange={(e) => settings({ shape: e.target.value as RecognitionSettings['shape'] })}>
                <option value="circle">圆形</option><option value="square">方形</option><option value="triangle">三角形</option><option value="diamond">菱形</option></select></Field>
              <Field label="样本点透明度"><input type="number" min={0.05} max={1} step={0.05} value={s.opacity} onChange={(e) => settings({ opacity: Math.max(0.05, Math.min(1, Number(e.target.value))) })} /></Field>
              <label className="check-line"><input type="checkbox" checked={s.labels} onChange={(e) => settings({ labels: e.target.checked })} />显示样本标签</label>
            </>}
            {chart === 'heatmap' && <Field label="热图数值"><select value={s.heatmap} onChange={(e) => settings({ heatmap: e.target.value as 'q' | 'zscore' })}>
              <option value="q">原始 q</option><option value="zscore">Z-score 标准化值（ddof=1）</option></select></Field>}
          </div>
          <div className="recognition-colors">
            <fieldset><legend>离子颜色</legend>{ids.map((ion) => <label key={ion}><input type="color" aria-label={`离子颜色 ${ion}`} value={ionColor(d, ion)} onChange={(e) => settings({ ionColors: { ...s.ionColors, [ion]: e.target.value } })} />{ion}</label>)}</fieldset>
            <fieldset><legend>聚类颜色</legend>{Array.from({ length: Math.max(...a.clusters!) }, (_, i) => i + 1).map((cluster) => <label key={cluster}><input type="color" aria-label={`聚类颜色 ${cluster}`} value={clusterColor(d, cluster)} onChange={(e) => settings({ clusterColors: { ...s.clusterColors, [String(cluster)]: e.target.value } })} />簇 {cluster}</label>)}</fieldset>
            <fieldset><legend>热图色阶（以零为中心）</legend>{(['negative', 'zero', 'positive'] as const).map((key, i) => <label key={key}><input type="color" aria-label={`热图${['负值', '零值', '正值'][i]}颜色`} value={s.heatColors[key]} onChange={(e) => settings({ heatColors: { ...s.heatColors, [key]: e.target.value } })} />{['负值', '零', '正值'][i]}</label>)}</fieldset>
          </div>
        </section>
        {(chart === 'tree' || chart === 'heatmap' || rank >= 2) && <ChartPanel kind="spectra" data={plot} title={chartNames[chart]} chartTitle={baseStyle.title}
          onChartTitleChange={(title) => setStyle({ title })} subtitle={`${preprocessingLabel(s.preprocessing)} · ${chart === 'heatmap' ? s.heatmap === 'q' ? '原始 q' : 'Z-score (ddof=1)' : '平行实验分别保留'}`}
          custom={{ id: `recognition-${chart}`, name: chartNames[chart], style: baseStyle, onChange: setStyle,
            categorical: chart === 'tree' || chart === 'heatmap',
            renderSVG: (style: ChartStyle) => chart === 'tree' || chart === 'heatmap'
              ? hierarchySVG(d, a, style, chart === 'heatmap') : chartSVG(plot, { ...chartStyle, title: style.title }),
          }} />}
      </>}
    </>}
  </div>;
}
function cloneTable<T>(table: T): T { return structuredClone(table); }
