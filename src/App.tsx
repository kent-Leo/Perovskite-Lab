import { APP_VERSION } from './version-v0.3.0-2026.10.19';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChartColumnIncreasing,
  ChartScatter,
  FlaskConical,
  FolderOpen,
  Upload,
  Download,
  Atom,
  BookOpen,
  NotebookPen,
  Database,
  HardDrive,
  RotateCcw,
  Check,
  Layers3,
  Menu,
  X,
} from 'lucide-react';
import { useWorkspace, demoWorkspace } from './state/workspace';
import { Spectra } from './features/Spectra';
import { Screening } from './features/Screening';
import { Calibration } from './features/Calibration';
import { Gradient } from './features/Gradient';
import { ImportDialog } from './components/ImportDialog';
import { PasteSpectraTable } from './components/PasteSpectraTable-2026.10.18';
import { ErrorNote } from './components/ui';
import { dateStamp, downloadBlob, filename } from './services/download';
import type { ImportKind } from './services/import';
import { useLabTools } from './services/useLabTools';
const pages = [
  {
    id: 'spectra',
    label: '光谱工作台',
    icon: Activity,
    detail: '导入原始数据，完成光谱分析与科研绘图。',
  },
  {
    id: 'screening',
    label: '对象筛选',
    icon: ChartColumnIncreasing,
    detail: '自由定义分析对象，比较选择性与干扰响应。',
  },
  {
    id: 'calibration',
    label: '校准与检出限',
    icon: ChartScatter,
    detail: '从浓度与响应出发，建立可复核的定量关系。',
  },
  {
    id: 'gradient',
    label: '浓度梯度',
    icon: FlaskConical,
    detail: '设定目标浓度，生成每组实验的配液用量。',
  },
  { id: 'extensions', label: '后续扩展', icon: Layers3, detail: '连接实验、项目与文献的下一步。' },
];
function currentPage() {
  const id = location.hash.slice(1);
  return pages.some((p) => p.id === id) ? id : 'spectra';
}
export default function App() {
  useLabTools();
  const { w, update, notify, notice, storageError } = useWorkspace(),
    [page, setPage] = useState(currentPage),
    [files, setFiles] = useState<File[] | null>(null),
    [importKind, setImportKind] = useState<ImportKind>('wide'),
    [mobileOpen, setMobileOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = () => setPage(currentPage());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  const navigate = (id: string) => {
    location.hash = id;
    setPage(id);
    setMobileOpen(false);
  };
  const closeImport = useCallback(() => setFiles(null), []);
  const openImport = (kind: ImportKind) => {
    setImportKind(kind);
    input.current?.click();
  };
  function resetDemo() {
    if (!w.demo && !window.confirm('载入示例将替换当前工作区数据。请先导出需要保留的数据。'))
      return;
    update(demoWorkspace());
    notify('已载入人工生成的示例数据');
  }
  function clearWorkspace() {
    if (!window.confirm('清空当前工作区？已下载的文件不会受影响。')) return;
    update({
      ...demoWorkspace(),
      demo: false,
      spectra: [],
      objects: [],
      calibration: [],
      blankId: '',
      calF0: '',
      blankRepeats: '',
    });
    notify('已建立空白工作区');
  }
  function template() {
    const data =
      page === 'screening'
        ? 'Name,Concentration,Intensity\nBlank,0,12000\nMy target,10,2800\nSample A,10,11350\n'
        : page === 'calibration'
          ? 'Concentration,Intensity\n0,12000\n1,10920\n2,9940\n4,7780\n6,5730\n'
          : 'Wavelength,Blank,Sample A\n500,4500,3100\n505,7500,5000\n510,10600,7000\n515,12000,8000\n520,11200,7600\n525,8500,5900\n530,5600,3800\n';
    downloadBlob(
      new Blob(['\uFEFF' + data], { type: 'text/csv;charset=utf-8' }),
      filename('导入模板', 'csv'),
    );
  }
  const current = pages.find((p) => p.id === page)!;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <Atom size={25} />
          </div>
          <div>
            <strong>
              Perovskite<span>Lab</span>
            </strong>
            <small>荧光研究工作台</small>
          </div>
          <button
            className="mobile-close icon-button"
            aria-label="关闭导航"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-switch">
          <span className="workspace-icon">
            <FlaskConical size={19} />
          </span>
          <div>
            我的实验工作区<small>本地 · v{APP_VERSION}</small>
          </div>
        </div>
        <div className="nav-label">数据分析</div>
        <nav>
          {pages.slice(0, 4).map((p) => (
            <a
              key={p.id}
              href={`#${p.id}`}
              className={page === p.id ? 'selected' : ''}
              onClick={() => {
                setPage(p.id);
                setMobileOpen(false);
              }}
            >
              <p.icon size={19} />
              {p.label}
              {page === p.id && <span className="nav-active" />}
            </a>
          ))}
        </nav>
        <div className="nav-label future-label">科研管理</div>
        <nav>
          <a
            href="#extensions"
            className={page === 'extensions' ? 'selected' : ''}
            onClick={() => {
              setPage('extensions');
              setMobileOpen(false);
            }}
          >
            <Layers3 size={19} />
            扩展规划<span className="nav-badge">后续</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-icon">
            <HardDrive size={19} />
          </div>
          <strong>数据保留在本机</strong>
          <p>文件在浏览器中处理，工作区自动保存在当前浏览器。</p>
          <span className="version-label">PEROVSKITE LAB / v{APP_VERSION}</span>
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          aria-label="收起导航"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="打开导航"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            <span>工作区</span>
            <span>/</span>
            <strong>{current.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-label">
              <HardDrive size={14} />
              本地工作区
            </span>
            <span className="date-label">{dateStamp()}</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                PEROVSKITE LAB{' '}
                <span>/ {String(pages.findIndex((p) => p.id === page) + 1).padStart(2, '0')}</span>
              </div>
              <h1>{current.label}</h1>
              <p>{current.detail}</p>
            </div>
            <div className="page-actions">
              <button onClick={resetDemo}>
                <RotateCcw size={16} />
                载入示例
              </button>
              {page !== 'gradient' && page !== 'extensions' && (
                <button
                  className="primary"
                  onClick={() =>
                    openImport(
                      page === 'screening'
                        ? 'objects'
                        : page === 'calibration'
                          ? 'calibration'
                          : 'wide',
                    )
                  }
                >
                  <Upload size={17} />
                  导入数据
                </button>
              )}
            </div>
          </div>
          {storageError && <ErrorNote>{storageError}</ErrorNote>}
          <div className={`workspace-status ${w.demo ? 'demo' : ''}`}>
            <div>
              {w.demo ? <FlaskConical size={16} /> : <Check size={16} />}
              <span>
                {w.demo
                  ? '示例工作区 · 当前数据为人工生成，仅用于体验功能'
                  : '当前工作区 · 自动保存在此浏览器'}
              </span>
            </div>
            <div className="status-actions">
              <button onClick={clearWorkspace}>新建空白工作区</button>
              <button
                onClick={() => {
                  downloadBlob(
                    new Blob([JSON.stringify(w, null, 2)], { type: 'application/json' }),
                    filename('工作区备份', 'json'),
                  );
                  notify('工作区数据已备份为 JSON');
                }}
              >
                下载数据备份
              </button>
            </div>
          </div>
          {(page === 'spectra' || page === 'screening' || page === 'calibration') && (
            <div
              className="import-strip"
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const f = Array.from(e.dataTransfer.files);
                if (f.length) {
                  setImportKind(
                    page === 'screening'
                      ? 'objects'
                      : page === 'calibration'
                        ? 'calibration'
                        : 'wide',
                  );
                  setFiles(f);
                }
              }}
            >
              <div>
                <FolderOpen size={19} />
                <span>将数据文件拖到此处，或使用右上角导入</span>
                <small>XLSX · XLS · CSV · TXT</small>
              </div>
              <button className="text-button" onClick={template}>
                <Download size={14} />
                下载模板
              </button>
            </div>
          )}
          {page === 'spectra' && (
            <>
              <PasteSpectraTable />
              <Spectra onImport={() => openImport('wide')} onNavigate={navigate} />
            </>
          )}
          {page === 'screening' && <Screening onImport={() => openImport('objects')} />}
          {page === 'calibration' && <Calibration onImport={() => openImport('calibration')} />}
          {page === 'gradient' && <Gradient />}
          {page === 'extensions' && (
            <div className="extension-grid">
              {[
                {
                  icon: NotebookPen,
                  title: '实验记录',
                  tag: 'EXPERIMENTS',
                  text: '关联原始数据、实验条件、分析结果与图表，保留每次实验的完整过程。',
                  fields: '实验名称 · 条件 · 数据文件 · 结果快照',
                },
                {
                  icon: FolderOpen,
                  title: '项目管理',
                  tag: 'PROJECTS',
                  text: '按研究主题组织实验和文献，支持后续跨实验结果比较。',
                  fields: '项目名称 · 描述 · 实验列表 · 文献列表',
                },
                {
                  icon: BookOpen,
                  title: '文献数据库',
                  tag: 'LITERATURE',
                  text: '保存论文信息、DOI、研究标签及检测性能，与实验关联。',
                  fields: '题目 · 作者 · 期刊 · DOI · 性能指标',
                },
              ].map((item) => (
                <section className="panel extension-card" key={item.title}>
                  <div className="extension-icon">
                    <item.icon size={25} />
                  </div>
                  <small>{item.tag}</small>
                  <h2>{item.title}</h2>
                  <p>{item.text}</p>
                  <div>{item.fields}</div>
                  <span className="planned-badge">已预留接口 · 后续实现</span>
                </section>
              ))}
              <div className="extension-foot">
                <Database size={19} />
                <span>当前版本专注数据分析。科研管理模块将在后续接入存储与服务。</span>
              </div>
            </div>
          )}
          <footer className="page-footer">
            <span>Perovskite Lab</span>
            <span>从原始数据，到可复核的结果。</span>
          </footer>
        </main>
      </div>
      <input
        className="sr-only"
        type="file"
        multiple
        accept=".xlsx,.xls,.csv,.txt,.tsv"
        aria-label="选择数据文件"
        ref={input}
        onChange={(e) => {
          if (e.target.files?.length) setFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      {files && (
        <ImportDialog
          files={files}
          kind={importKind}
          onClose={closeImport}
          onImported={(kind) =>
            navigate(
              kind === 'objects' ? 'screening' : kind === 'calibration' ? 'calibration' : 'spectra',
            )
          }
        />
      )}{' '}
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
    </div>
  );
}
