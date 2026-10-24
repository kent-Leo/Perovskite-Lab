import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, KeyRound, Download, X } from 'lucide-react';
import {
  AI_PROVIDERS, MAX_AI_POINTS, MAX_AI_SPECTRA, waveRange,
  type AiProvider, type AnalysisInput,
} from '../../shared/ai-contract-2026.10.24';
import { useAiSession } from '../state/ai-session-2026.10.24';
import { requestAi } from '../services/ai-client-2026.10.24';
import { exportProcessing, type ProcessingAudit } from '../services/processing-export-2026.10.24';
import {
  overlaps, processSpectra, processedSegments,
  type ProcessingRegion, type ProcessingResult,
} from '../domain/spectrum-processing-2026.10.24';
import { chartSVG } from '../domain/chart';
import { defaultStyle, uid, type Spectrum, type Series } from '../domain/types';
import { dateStamp } from '../services/download';
import { ErrorNote, Field, SectionHead } from './ui';
import './AiSpectraPanel-2026.10.24.css';

type AiRecord = NonNullable<ProcessingAudit['ai']>;
interface Snapshot { key: string; result: ProcessingResult; audit: ProcessingAudit }
export function AiSpectraPanel({ spectra, sheet, excitation, onExcitationChange }: {
  spectra: Spectrum[]; sheet: string; excitation: string; onExcitationChange: (value: string) => void;
}) {
  const { credentials, setProvider, setModel, setKey, clearKey, clearAllKeys, storageError } = useAiSession();
  const [selected, setSelected] = useState(() => spectra.filter((s) => s.visible).map((s) => s.id));
  const [solvent, setSolvent] = useState(''), [blankId, setBlankId] = useState('');
  const [subtractBlank, setSubtractBlank] = useState(false), [sameConditions, setSameConditions] = useState(false);
  const [protectFrom, setProtectFrom] = useState(''), [protectTo, setProtectTo] = useState('');
  const [consent, setConsent] = useState(false), [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<'test' | 'analyze' | null>(null), [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState(''), [error, setError] = useState('');
  const [aiRecord, setAiRecord] = useState<AiRecord | null>(null);
  const [regions, setRegions] = useState<ProcessingRegion[]>([]);
  const [manualFrom, setManualFrom] = useState(''), [manualTo, setManualTo] = useState('');
  const [manualReason, setManualReason] = useState('人工确认的干扰区域');
  const [manualTarget, setManualTarget] = useState('*');
  const [preview, setPreview] = useState<Snapshot | null>(null), [applied, setApplied] = useState<Snapshot | null>(null);
  const request = useRef<AbortController | null>(null), operation = useRef(0);
  const sourceKey = useMemo(() => JSON.stringify(spectra), [spectra]);
  const blank = spectra.find((s) => s.id === blankId) ?? null;
  const targets = spectra.filter((s) => selected.includes(s.id) && s.id !== blankId);
  const pointCount = targets.reduce((sum, s) => sum + s.points.length, blank?.points.length ?? 0);
  const baseKey = JSON.stringify({ sourceKey, selected, excitation, solvent, blankId, subtractBlank,
    sameConditions, protectFrom, protectTo });
  const planKey = JSON.stringify({ baseKey, regions });
  const livePreview = preview?.key === planKey ? preview : null;
  const liveApplied = applied?.key === planKey ? applied : null;
  const provider = AI_PROVIDERS[credentials.provider];
  // Data changes never reuse an earlier request, suggestion, preview or applied snapshot.
  useEffect(() => {
    setSelected(spectra.filter((s) => s.visible).map((s) => s.id));
    setBlankId(''); setSameConditions(false); setSubtractBlank(false);
  }, [sourceKey]);
  useEffect(() => {
    request.current?.abort(); operation.current++;
    setBusy(null); setAiRecord(null); setRegions([]); setPreview(null); setApplied(null);
    setError(''); setStatus('');
  }, [baseKey]);
  useEffect(() => {
    request.current?.abort(); operation.current++; setBusy(null); setStatus(''); setShowKey(false);
    return () => { request.current?.abort(); operation.current++; };
  }, [credentials.provider, credentials.model, credentials.apiKey]);
  function protection() {
    if (!protectFrom.trim() && !protectTo.trim()) return null;
    if (!protectFrom.trim() || !protectTo.trim()) throw new Error('目标保护区起点和终点需要同时填写');
    return waveRange({ fromNm: Number(protectFrom), toNm: Number(protectTo) });
  }
  function cancel() {
    request.current?.abort(); operation.current++; setBusy(null);
    setStatus('已取消请求；服务商已开始的计算可能仍计费');
  }
  async function runAi(test: boolean) {
    setError(''); setStatus('');
    const controller = new AbortController(), token = ++operation.current;
    request.current?.abort(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      if (!consent) throw new Error('请先勾选数据发送与个人账户计费说明');
      const input: AnalysisInput | null = test ? null : {
        spectra: targets.map(({ id, name, points }) => ({ id, name, points })),
        excitationNm: Number(excitation), solvent, protectedRange: protection(),
        blank: blank ? { id: blank.id, name: blank.name, points: blank.points } : null,
      };
      if (!test && blank && !sameConditions) throw new Error('使用空白参与 AI 分析前，请确认测量条件一致');
      setBusy(test ? 'test' : 'analyze');
      const result = await requestAi(credentials, input, controller.signal);
      if (token !== operation.current || controller.signal.aborted) return;
      if (test) setStatus('连接成功，可以使用当前密钥和模型');
      else if (result) {
        setAiRecord({ provider: credentials.provider, model: credentials.model, summary: result.summary });
        setRegions((previous) => [
          ...previous.filter((r) => r.origin === 'manual'),
          ...result.regions.map((r) => ({ ...r, id: uid(), enabled: false, origin: 'ai' as const })),
        ]);
        setPreview(null); setApplied(null);
        setStatus(result.regions.length ? 'AI 建议已返回，请逐项确认后预览' : 'AI 未提出可排除区间，请查看分析说明');
      }
    } catch (e) {
      if (token === operation.current) setError(controller.signal.aborted ? '请求超时或已取消，可按需重试' : (e as Error).message);
    } finally {
      clearTimeout(timer);
      if (token === operation.current) setBusy(null);
    }
  }
  function addRegion() {
    setError('');
    try {
      if (!manualFrom.trim() || !manualTo.trim()) throw new Error('请填写排除区间起点和终点');
      const range = waveRange({ fromNm: Number(manualFrom), toNm: Number(manualTo) });
      const protectedRange = protection();
      if (protectedRange && overlaps(range, protectedRange)) throw new Error('排除区间与目标保护区重叠');
      const samples = targets.filter((s) => manualTarget === '*' || s.id === manualTarget);
      if (!samples.length) throw new Error('请选择有效的待处理样品');
      if (!manualReason.trim()) throw new Error('请填写排除理由');
      const additions = samples.map((s) => ({ ...range, spectrumId: s.id, id: uid(), enabled: true,
        origin: 'manual' as const, reason: manualReason.trim() }));
      // Reuse numeric validation before adding a region to the plan.
      processSpectra(samples, { regions: additions, protectedRange, subtractBlank: false, blank: null, sameConditions: false });
      setRegions((previous) => [...previous, ...additions]);
      setManualFrom(''); setManualTo('');
    } catch (e) { setError((e as Error).message); }
  }
  function makePreview() {
    setError(''); setApplied(null);
    try {
      const result = processSpectra(targets, {
        regions, protectedRange: protection(), subtractBlank, blank, sameConditions,
      });
      setPreview({ key: planKey, result, audit: {
        sheet, excitation, solvent, appliedOn: dateStamp(), ai: aiRecord,
      } });
      setStatus('预览已生成；确认应用后可以导出 Excel');
    } catch (e) { setPreview(null); setError((e as Error).message); }
  }
  async function save() {
    if (!liveApplied) return;
    setExporting(true); setError('');
    try { await exportProcessing(liveApplied.result, liveApplied.audit); }
    catch { setError('Excel 导出失败，请重试'); }
    finally { setExporting(false); }
  }
  const previewChart = useMemo(() => {
    if (!livePreview) return '';
    const series: Series[] = [];
    for (const s of livePreview.result.spectra) {
      series.push({ name: `${s.name} 原始`, color: '#a5b0ac', dashed: true,
        points: s.points.map((p) => ({ x: p.x, y: p.original })) });
      series.push(...processedSegments(s.points).map((points) => ({
        name: `${s.name} 处理`, color: s.color, points, ...(points.length === 1 ? { kind: 'scatter' as const } : {}),
      })));
      const excluded = s.points.filter((p) => p.y === null).map((p) => ({ x: p.x, y: p.original }));
      if (excluded.length) series.push({ name: '排除点', color: '#b74b40', kind: 'scatter', points: excluded });
    }
    return chartSVG({ series }, { ...defaultStyle('spectra'), title: '处理前后对比', legend: 'none', fontSize: 14 });
  }, [livePreview]);
  return <section className="panel ai-panel" aria-labelledby="ai-panel-title">
    <SectionHead title="AI 辅助光谱处理" detail="自带 API Key · 先预览再应用 · 原始光谱独立保留" action={<Sparkles size={21} />} />
    <span id="ai-panel-title" className="sr-only">AI 辅助光谱处理</span>
    <details className="ai-settings" open>
      <summary><KeyRound size={16} /> AI 设置与个人账户计费</summary>
      <div className="ai-grid">
        <Field label="AI 服务商"><select value={credentials.provider} onChange={(e) => { setProvider(e.target.value as AiProvider); setConsent(false); }}>
          {Object.entries(AI_PROVIDERS).map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}
        </select></Field>
        <Field label="AI 模型"><select value={credentials.model} onChange={(e) => setModel(e.target.value)}>
          {provider.models.map((model) => <option key={model}>{model}</option>)}
        </select></Field>
        <Field label="个人 API Key" hint="按服务商保存在当前浏览器中（本地明文），刷新或重新打开仍保留；手动清除可删除。">
          <input type={showKey ? 'text' : 'password'} value={credentials.apiKey} autoComplete="off" spellCheck={false}
            maxLength={512} onChange={(e) => setKey(e.target.value)} placeholder="输入该服务商的 API Key" />
        </Field>
      </div>
      <div className="ai-actions">
        <label className="check-line"><input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} />显示密钥</label>
        <button className="small-button" onClick={() => { clearKey(); setShowKey(false); }}>清除密钥</button>
        <button className="small-button" onClick={() => { clearAllKeys(); setShowKey(false); }}>清除全部服务商密钥</button>
        <button className="small-button" disabled={!!busy || !credentials.apiKey || !consent} onClick={() => void runAi(true)}>测试连接（可能计费）</button>
      </div>
      {storageError && <ErrorNote>{storageError}</ErrorNote>}
      <label className="ai-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>我同意：点击 AI 分析时，将所选光谱的完整波长与强度、名称、测量条件及所选空白发送给 {provider.name}；密钥经本站后端临时转发。测试与分析费用由我的 API 账户承担，本站服务器不保存密钥。</span>
      </label>
    </details>
    <div className="ai-grid ai-conditions">
      <Field label="AI 分析激发波长 / nm"><input type="number" min={1} value={excitation} placeholder="例如 350"
        onChange={(e) => onExcitationChange(e.target.value)} /></Field>
      <Field label="溶剂或基质"><input value={solvent} maxLength={200} placeholder="例如 水 / 乙醇 / 实际水样" onChange={(e) => setSolvent(e.target.value)} /></Field>
      <Field label="目标保护区起点 / nm"><input type="number" value={protectFrom} placeholder="可选" onChange={(e) => setProtectFrom(e.target.value)} /></Field>
      <Field label="目标保护区终点 / nm"><input type="number" value={protectTo} placeholder="可选" onChange={(e) => setProtectTo(e.target.value)} /></Field>
      <Field label="空白参考光谱"><select value={blankId} onChange={(e) => { setBlankId(e.target.value); setSameConditions(false); }}>
        <option value="">不使用空白</option>{spectra.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></Field>
    </div>
    <p className="ai-note">激发波长与下方峰特性分析共用。仅凭单条光谱不能确定重叠峰的真实组成。</p>
    <div className="ai-actions">
      <label className="check-line"><input type="checkbox" checked={sameConditions} disabled={!blank} onChange={(e) => setSameConditions(e.target.checked)} />确认空白与样品测量条件一致</label>
      <label className="check-line"><input type="checkbox" checked={subtractBlank} disabled={!blank} onChange={(e) => setSubtractBlank(e.target.checked)} />启用 1:1 空白扣除</label>
    </div>
    <fieldset className="ai-samples"><legend>待处理光谱（当前 sheet）</legend>
      {spectra.length ? spectra.map((s) => <label key={s.id} className="check-line">
        <input type="checkbox" checked={selected.includes(s.id) && s.id !== blankId} disabled={s.id === blankId}
          onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, s.id] : ids.filter((id) => id !== s.id))} />
        <span className="ai-swatch" style={{ background: s.color }} />{s.name}{s.id === blankId ? '（空白参考）' : ''}
      </label>) : <p className="ai-note">请先通过上方导入 TXT，或输入数据并根据表格绘图。</p>}
    </fieldset>
    <div className="ai-actions">
      <button className="primary" disabled={!!busy || !targets.length || !credentials.apiKey || !consent} onClick={() => void runAi(false)}><Sparkles size={16} />AI 分析干扰</button>
      {busy && <button onClick={cancel}><X size={15} />取消请求</button>}
      <span className="ai-note">{targets.length} 条样品 · {pointCount} 点（含空白）；AI 单次最多 {MAX_AI_SPECTRA} 条 / {MAX_AI_POINTS} 点，超限需分批，不抽稀。</span>
    </div>
    {busy && <p role="status" className="ai-message">{busy === 'test' ? '正在测试连接…' : '正在分析，最长约 60 秒…'}</p>}
    {status && <p role="status" className="ai-message">{status}</p>}
    {error && <ErrorNote>{error}</ErrorNote>}
    {aiRecord && <div className="ai-analysis"><strong>AI 分析说明 · {aiRecord.model}</strong><p>{aiRecord.summary}</p></div>}
    <div className="ai-manual">
      <h3>排除区间</h3>
      <p className="ai-note">AI 建议默认不勾选；手动区间可直接添加。调整数据或测量条件会清除建议与预览。被排除的数据留空，图中保留断口。</p>
      <div className="ai-grid">
        <Field label="手动区间适用光谱"><select value={manualTarget} onChange={(e) => setManualTarget(e.target.value)}>
          <option value="*">全部已选样品</option>{targets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></Field>
        <Field label="排除区间起点 / nm"><input type="number" value={manualFrom} onChange={(e) => setManualFrom(e.target.value)} /></Field>
        <Field label="排除区间终点 / nm"><input type="number" value={manualTo} onChange={(e) => setManualTo(e.target.value)} /></Field>
        <Field label="排除理由"><input value={manualReason} maxLength={500} onChange={(e) => setManualReason(e.target.value)} /></Field>
      </div>
      <button className="small-button" onClick={addRegion} disabled={!targets.length}>添加手动区间</button>
      {!!regions.length && <div className="ai-table-scroll"><table className="ai-regions"><thead><tr>
        <th>应用</th><th>光谱</th><th>起点 / nm</th><th>终点 / nm</th><th>来源与理由</th><th>操作</th>
      </tr></thead><tbody>{regions.map((r, index) => {
        let protectedOverlap = false;
        try { const p = protection(); protectedOverlap = !!p && overlaps(r, p); } catch { /* Validated before preview. */ }
        return <tr key={r.id}>
          <td><input type="checkbox" aria-label={`应用区间 ${index + 1}`} checked={r.enabled} disabled={protectedOverlap}
            onChange={(e) => setRegions((rows) => rows.map((row) => row.id === r.id ? { ...row, enabled: e.target.checked } : row))} /></td>
          <td>{targets.find((s) => s.id === r.spectrumId)?.name ?? '已移除样品'}</td>
          <td><input type="number" aria-label={`区间 ${index + 1} 起点`} value={r.fromNm}
            onChange={(e) => setRegions((rows) => rows.map((row) => row.id === r.id ? { ...row, fromNm: Number(e.target.value) } : row))} /></td>
          <td><input type="number" aria-label={`区间 ${index + 1} 终点`} value={r.toNm}
            onChange={(e) => setRegions((rows) => rows.map((row) => row.id === r.id ? { ...row, toNm: Number(e.target.value) } : row))} /></td>
          <td><small>{r.origin === 'ai' ? 'AI 建议 · 待人工确认' : '手动标记'}{protectedOverlap ? ' · 与保护区重叠' : ''}</small>
            <input aria-label={`区间 ${index + 1} 理由`} value={r.reason} maxLength={500}
              onChange={(e) => setRegions((rows) => rows.map((row) => row.id === r.id ? { ...row, reason: e.target.value } : row))} /></td>
          <td><button className="small-button" onClick={() => setRegions((rows) => rows.filter((row) => row.id !== r.id))}>移除</button></td>
        </tr>;
      })}</tbody></table></div>}
    </div>
    <div className="ai-actions">
      <button disabled={!!busy || !targets.length} onClick={makePreview}>预览处理</button>
      <button className="primary" disabled={!!busy || !livePreview || !!liveApplied} onClick={() => {
        setApplied(livePreview); setStatus('已应用为独立处理结果，原始工作表保持完整');
      }}>确认应用处理</button>
      <button disabled={!liveApplied || exporting} onClick={() => void save()}><Download size={16} />{exporting ? '正在导出…' : '导出处理 Excel'}</button>
      <button disabled={!regions.length && !preview} onClick={() => {
        setRegions([]); setPreview(null); setApplied(null); setAiRecord(null); setError(''); setStatus('已清除区间与处理结果');
      }}>清除处理结果</button>
    </div>
    {livePreview && <div className="ai-preview">
      <div className="ai-actions"><strong>{liveApplied ? '已应用结果' : '处理预览'}</strong><span className="ai-note">灰色虚线：原始光谱 · 彩色实线：处理光谱 · 红点：排除位置</span></div>
      <div data-testid="ai-processing-chart" role="img" aria-label="原始光谱与处理光谱对比" dangerouslySetInnerHTML={{ __html: previewChart }} />
      <ul className="ai-result-list">{livePreview.result.spectra.map((s) => <li key={s.id}>
        <span className="ai-swatch" style={{ background: s.color }} />{s.name}：{s.points.length} 点，排除 {s.points.filter((p) => p.y === null).length} 点
      </li>)}</ul>
      <p className="ai-note">Excel 包含原始数据、处理数据、修改记录、处理参数四张表。处理结果不会自动用于校准或浓度计算。</p>
    </div>}
  </section>;
}
