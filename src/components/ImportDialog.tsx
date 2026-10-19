import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Upload, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import {
  headers,
  mappedImport,
  readDataFile,
  mergeImport,
  inferMapping,
  type ImportFile,
  type ImportKind,
  type Mapping,
} from '../services/import';
import { units } from '../domain/math';
import { useWorkspace } from '../state/workspace';
import { ErrorNote, Field } from './ui';
import { downloadBlob, filename } from '../services/download';
const templates: Record<ImportKind, { title: string; csv: string; hint: string }> = {
  wide: {
    title: '光谱宽表',
    csv: 'Wavelength,Blank,Sample A\n500,100,60\n510,200,120\n520,100,60\n',
    hint: '第一列为波长（nm），其余每列是一条光谱的强度；每条光谱至少两个点。',
  },
  long: {
    title: '光谱长表',
    csv: 'Sample,Wavelength,Intensity\nBlank,500,100\nBlank,510,200\nSample A,500,60\nSample A,510,120\n',
    hint: '每行填写样品名称、波长和强度；同一样品的波长不能重复。',
  },
  objects: {
    title: '对象筛选',
    csv: 'Name,Intensity\nBlank,12000\nCd2+,2800\nSample A,11350\n',
    hint: '至少两列：名称和强度。浓度可省略，在浓度列选择“不提供浓度”。',
  },
  calibration: {
    title: '浓度校准',
    csv: 'Concentration,Intensity\n0,12000\n1,10920\n2,9940\n',
    hint: '两列：浓度和强度。浓度单位在上方选择，数值单元格只填数字。',
  },
};
export function ImportDialog({
  files,
  kind,
  onClose,
  onImported,
}: {
  files: File[];
  kind: ImportKind;
  onClose: () => void;
  onImported: (kind: ImportKind) => void;
}) {
  const { update, notify, w } = useWorkspace();
  const [index, setIndex] = useState(0),
    [data, setData] = useState<ImportFile | null>(null),
    [sheet, setSheet] = useState(0),
    [encoding, setEncoding] = useState('utf-8'),
    [delimiter, setDelimiter] = useState('auto'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [mapping, setMapping] = useState<Mapping>({
    kind,
    start: 1,
    header: true,
    x: 0,
    ys: [1],
    name: 0,
    concentration: 1,
    unit: w.calUnit,
  });
  const modal = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    modal.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const els = modal.current?.querySelectorAll<HTMLElement>(
          'button,input,select,[tabindex="0"]',
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handle);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, [onClose]);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError('');
    setData(null);
    readDataFile(files[index], encoding, delimiter)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setSheet(0);
          setMapping((m) => inferMapping(d.sheets[0], m.kind, m.unit));
        }
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [files, index, encoding, delimiter, kind]);
  const cols = data ? headers(data.sheets[sheet], mapping) : [];
  const result = useMemo(() => {
    if (!data) return null;
    try {
      return { value: mappedImport(data, sheet, mapping), error: '' };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  }, [data, sheet, mapping]);
  const set = (p: Partial<Mapping>) => setMapping((m) => ({ ...m, ...p }));
  const changeKind = (next: ImportKind) =>
    setMapping((m) =>
      data ? inferMapping(data.sheets[sheet], next, m.unit) : { ...m, kind: next },
    );
  const select = (label: string, value: number, change: (v: number) => void) => (
    <Field label={label}>
      <select value={value} onChange={(e) => change(Number(e.target.value))}>
        {label === '浓度列' && mapping.kind === 'objects' && <option value={-1}>不提供浓度</option>}
        {cols.map((c, i) => (
          <option key={i} value={i}>
            {i + 1} · {c}
          </option>
        ))}
      </select>
    </Field>
  );
  function commit() {
    if (!result?.value) return;
    const r = result.value;
    try {
      const patch = mergeImport(w, r, mapping.unit);
      update(patch);
      notify(
        `已导入 ${files[index].name}：${r.count} ${r.spectra.length ? '条光谱' : '行数据'}${r.skipped ? `，已跳过 ${r.skipped} 个无效记录` : ''}`,
      );
      if (index < files.length - 1) setIndex((i) => i + 1);
      else {
        onImported(mapping.kind);
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        tabIndex={-1}
        ref={modal}
      >
        <header>
          <div className="icon-tile">
            <FileSpreadsheet size={23} />
          </div>
          <div>
            <h2 id="import-title">导入实验数据</h2>
            <p>
              {files[index].name} · {index + 1} / {files.length}
            </p>
          </div>
          <button className="icon-button" aria-label="关闭导入" onClick={onClose}>
            <X size={21} />
          </button>
        </header>
        <div className="import-body">
          <div className="form-grid">
            <Field label="数据布局">
              <select
                value={mapping.kind}
                onChange={(e) => changeKind(e.target.value as ImportKind)}
              >
                <option value="wide">光谱宽表 · 波长 + 多列强度</option>
                <option value="long">光谱长表 · 样品 + 波长 + 强度</option>
                <option value="objects">对象筛选 · 名称 + 强度（浓度可选）</option>
                <option value="calibration">校准数据 · 浓度 + 强度</option>
              </select>
            </Field>
            {data && (
              <Field label="工作表">
                <select
                  value={sheet}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setSheet(next);
                    setMapping((m) => inferMapping(data.sheets[next], m.kind, m.unit));
                  }}
                >
                  {data.sheets.map((s, i) => (
                    <option key={i} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {!/\.xlsx?$/i.test(files[index].name) && (
              <>
                <Field label="文本编码">
                  <select value={encoding} onChange={(e) => setEncoding(e.target.value)}>
                    <option value="utf-8">UTF-8</option>
                    <option value="gb18030">GB18030 / GBK</option>
                    <option value="utf-16le">UTF-16 LE（Excel Unicode 文本）</option>
                  </select>
                </Field>
                <Field label="分隔符">
                  <select value={delimiter} onChange={(e) => setDelimiter(e.target.value)}>
                    <option value="auto">自动识别</option>
                    <option value=",">逗号</option>
                    <option value={'\t'}>制表符</option>
                    <option value=";">分号</option>
                    <option value="|">竖线</option>
                    <option value="space">空格</option>
                  </select>
                </Field>
              </>
            )}
            <Field label="起始行">
              <input
                type="number"
                min={1}
                value={mapping.start}
                onChange={(e) => set({ start: Number(e.target.value) })}
              />
            </Field>
            <label className="check-line">
              <input
                type="checkbox"
                checked={mapping.header}
                onChange={(e) => set({ header: e.target.checked })}
              />{' '}
              起始行包含列名
            </label>
          </div>
          {busy && <p>正在读取文件…</p>}
          {error && <ErrorNote>{error}</ErrorNote>}
          {data && (
            <>
              <div className="mapping-grid">
                {(mapping.kind === 'wide' || mapping.kind === 'long') &&
                  select('波长列', mapping.x, (v) =>
                    set({ x: v, ys: mapping.ys.filter((y) => y !== v) }),
                  )}
                {(mapping.kind === 'long' || mapping.kind === 'objects') &&
                  select('名称列', mapping.name, (v) => set({ name: v }))}
                {(mapping.kind === 'objects' || mapping.kind === 'calibration') &&
                  select('浓度列', mapping.concentration, (v) => set({ concentration: v }))}
                {mapping.kind !== 'wide' &&
                  select('荧光强度列', mapping.ys[0], (v) => set({ ys: [v] }))}
                <Field label="浓度单位">
                  <select value={mapping.unit} onChange={(e) => set({ unit: e.target.value })}>
                    {units.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </Field>
              </div>
              {mapping.kind === 'wide' && (
                <div className="column-choices">
                  <strong>选择荧光强度列</strong>
                  {cols.map((c, i) => (
                    <label key={i}>
                      <input
                        type="checkbox"
                        checked={mapping.ys.includes(i)}
                        disabled={i === mapping.x}
                        onChange={(e) =>
                          set({
                            ys: e.target.checked
                              ? [...mapping.ys, i]
                              : mapping.ys.filter((y) => y !== i),
                          })
                        }
                      />
                      {c}
                    </label>
                  ))}
                </div>
              )}
              <div className="preview-label">
                原始数据预览 <span>共 {data.sheets[sheet].rows.length} 行</span>
              </div>
              <div className="table-scroll preview-table">
                <table>
                  <thead>
                    <tr>
                      <th>行</th>
                      {cols.map((c, i) => (
                        <th key={i}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.sheets[sheet].rows
                      .slice(Math.max(0, mapping.start - 1), mapping.start + 5)
                      .map((r, i) => (
                        <tr key={i}>
                          <td>{mapping.start + i}</td>
                          {cols.map((_, j) => (
                            <td key={j}>{String(r[j] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {result?.error ? (
                <ErrorNote>{result.error}</ErrorNote>
              ) : (
                result?.value && (
                  <div className="import-summary">
                    <CheckCircle2 size={18} /> 可导入 {result.value.count}{' '}
                    {result.value.spectra.length ? '条光谱' : '行数据'}
                    {result.value.skipped > 0 && `；将跳过 ${result.value.skipped} 个无效记录`}
                  </div>
                )
              )}
              <p className="muted">
                已自动建议起始行与列映射，请对照预览确认。若所有内容挤在一列，请修改分隔符；若中文乱码，请修改文本编码。
              </p>
              <details className="import-help">
                <summary>查看 CSV 格式与下载模板</summary>
                <p>{templates[mapping.kind].hint}</p>
                <pre>{templates[mapping.kind].csv}</pre>
                <p>
                  建议 UTF-8
                  编码，英文逗号分隔，小数使用点（1.25），支持科学计数法（1.2E3）。单位写在列名或界面中。无列名时取消“起始行包含列名”；有仪器说明行时调整起始行。
                </p>
                <button
                  onClick={() =>
                    downloadBlob(
                      new Blob(['\uFEFF' + templates[mapping.kind].csv], {
                        type: 'text/csv;charset=utf-8',
                      }),
                      filename(`${templates[mapping.kind].title}模板`, 'csv'),
                    )
                  }
                >
                  下载当前布局 CSV 模板
                </button>
              </details>
              <p className="muted">
                示例工作区首次导入会清除全部示例数据。样品角色、浓度和空白参考可在导入后设置。
              </p>
            </>
          )}
        </div>
        <footer>
          <button onClick={onClose}>取消</button>
          {index < files.length - 1 && (
            <button onClick={() => setIndex((i) => i + 1)}>跳过此文件</button>
          )}
          <button className="primary" disabled={busy || !result?.value} onClick={commit}>
            <Upload size={16} />
            确认导入{index < files.length - 1 ? '并继续' : ''}
          </button>
        </footer>
      </div>
    </div>
  );
}
