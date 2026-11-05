import { APP_VERSION } from './version-v0.9.0-2026.10.27';
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
  HardDrive,
  RotateCcw,
  Check,
  Menu,
  Sparkles,
  X,
} from 'lucide-react';
import { useWorkspace, demoWorkspace, blankWorkspace, prepareWorkspace, type Workspace } from './state/workspace';
import { Spectra } from './features/Spectra';
import { Screening } from './features/Screening';
import { Calibration } from './features/Calibration';
import { Gradient } from './features/Gradient';
import { Recognition } from './features/Recognition-2026.10.27';
import { AiAssistant } from './features/AiAssistant-2026.10.25';
import { ImportDialog } from './components/ImportDialog';
import { PasteSpectraTable } from './components/PasteSpectraTable-2026.10.18';
import { ErrorNote } from './components/ui';
import { dateStamp, downloadBlob, filename } from './services/download';
import {
  clearDraft,
  desktopProject,
  draftStorageKey,
  parseProject,
  serializeProject,
} from './services/desktop-project-2026.11.4';
import type { DesktopBootstrap } from './state/desktop-bootstrap-2026.11.5';
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
    id: 'assistant',
    label: 'AI 光谱助手',
    icon: Sparkles,
    detail: '上传 F-7100 TXT，自动识别杂峰与散射干扰，保护真实发射峰，并导出或同步处理结果。',
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
  {
    id: 'recognition',
    label: '多探针识别分析',
    icon: ChartScatter,
    detail: '直接录入多探针猝灭率，绘制 PCA、层次聚类与热图。',
  },
];
function currentPage() {
  const id = location.hash.slice(1);
  return pages.some((p) => p.id === id) ? id : 'spectra';
}
export default function App({ desktopBootstrap }: { desktopBootstrap?: DesktopBootstrap } = {}) {
  useLabTools();
  const {
      w,
      update,
      notify,
      notice,
      storageError,
      dirty,
      replaceWorkspace,
      markSaved,
      setStorageKey,
    } = useWorkspace(),
    [page, setPage] = useState(currentPage),
    [files, setFiles] = useState<File[] | null>(null),
    [importKind, setImportKind] = useState<ImportKind>('wide'),
    [mobileOpen, setMobileOpen] = useState(false),
    [projectPath, setProjectPath] = useState<string | null>(desktopBootstrap?.projectPath ?? null);
  const input = useRef<HTMLInputElement>(null);
  // 桌面端：项目文件读写。浏览器里 desktopProject 为 undefined，所有分支都会跳过。
  const latestWorkspace = useRef(w);
  latestWorkspace.current = w;
  const latestDirty = useRef(dirty);
  latestDirty.current = dirty;
  const latestPath = useRef(projectPath);
  latestPath.current = projectPath;
  const projectName = projectPath ? (projectPath.split(/[\\/]/).pop() ?? '项目文件') : '未命名项目';

  /** 保存到当前项目文件；返回是否真的写盘成功（取消或失败为 false）。 */
  const saveProjectFile = useCallback(
    async (saveAs: boolean) => {
      if (!desktopProject) return false;
      const result = await desktopProject.save(serializeProject(latestWorkspace.current), saveAs);
      if (result.canceled) {
        if (result.error) notify(result.error);
        return false;
      }
      const previous = latestPath.current;
      const target = result.path ?? previous;
      if (target) {
        // 正式文件已经包含全部修改，对应身份的自动恢复草稿不再需要。
        clearDraft(draftStorageKey(target));
        setStorageKey(draftStorageKey(target));
        latestPath.current = target;
        setProjectPath(target);
      }
      if (previous && previous !== target) clearDraft(draftStorageKey(previous));
      markSaved();
      notify(`项目已保存：${target?.split(/[\\/]/).pop() ?? '项目文件'}`);
      return true;
    },
    [markSaved, notify, setStorageKey],
  );

  /** 有未保存修改时询问保存 / 放弃 / 取消（桌面端用原生三按钮对话框）。 */
  const confirmUnsaved = useCallback(async (): Promise<'save' | 'discard' | 'cancel'> => {
    if (!desktopProject) return 'discard';
    return desktopProject.confirmUnsaved(projectName);
  }, [projectName]);

  /**
   * 打开项目：先解析校验，再处理未保存修改，最后才切换路径与工作区。
   * 任何一步失败都保持当前项目不变。
   */
  const openProjectContent = useCallback(
    async (path: string, content: string) => {
      if (!desktopProject) return false;
      let workspace: Workspace;
      let legacyBackup = false;
      try {
        const parsed = parseProject(content);
        workspace = prepareWorkspace(parsed.workspace);
        legacyBackup = parsed.legacyBackup;
      } catch (error) {
        notify(`打开失败：${(error as Error).message}`);
        return false;
      }
      if (latestDirty.current) {
        const choice = await confirmUnsaved();
        if (choice === 'cancel') return false;
        if (choice === 'save' && !(await saveProjectFile(false))) return false;
      }
      const adopted = await desktopProject.adopt(path);
      if (!adopted.ok) {
        notify(adopted.error ?? '项目文件无法切换');
        return false;
      }
      const key = draftStorageKey(path);
      clearDraft(key);
      latestPath.current = path;
      setProjectPath(path);
      replaceWorkspace(workspace, { storageKey: key });
      notify(legacyBackup ? '已从备份 JSON 恢复工作区' : `已打开项目：${path.split(/[\\/]/).pop()}`);
      return true;
    },
    [confirmUnsaved, notify, replaceWorkspace, saveProjectFile],
  );

  const openProjectFile = useCallback(async () => {
    if (!desktopProject) return;
    const result = await desktopProject.open();
    if (result.canceled) {
      if (result.error) notify(result.error);
      return;
    }
    if (result.path && result.content !== undefined)
      await openProjectContent(result.path, result.content);
  }, [notify, openProjectContent]);

  /** 新建空白项目：丢弃当前路径，下一次保存重新选择文件位置。 */
  const newProject = useCallback(async () => {
    if (latestDirty.current) {
      const choice = await confirmUnsaved();
      if (choice === 'cancel') return;
      if (choice === 'save' && !(await saveProjectFile(false))) return;
    }
    if (desktopProject) {
      const result = await desktopProject.newProject();
      if (!result.ok) {
        notify(result.error ?? '无法新建项目');
        return;
      }
    } else if (!window.confirm('新建空白项目会替换当前工作区，确定继续？')) return;
    const key = draftStorageKey(null);
    latestPath.current = null;
    setProjectPath(null);
    setStorageKey(key);
    replaceWorkspace(blankWorkspace(), { storageKey: key });
    notify('已新建空白项目');
  }, [confirmUnsaved, notify, replaceWorkspace, saveProjectFile, setStorageKey]);

  useEffect(() => {
    if (!desktopProject) return;
    desktopProject.setCommandHandler((command) => {
      if (command.type === 'loaded') void openProjectContent(command.path, command.content);
      else if (command.type === 'load-error') notify(`打开失败：${command.error}`);
      else if (command.type === 'open') void openProjectFile();
      else if (command.type === 'new') void newProject();
      else void saveProjectFile(command.type === 'save-as');
    });
    return () => desktopProject?.setCommandHandler(null);
  }, [newProject, notify, openProjectContent, openProjectFile, saveProjectFile]);

  // 窗口标题里的未保存状态由主进程维护，这里只同步 dirty。
  useEffect(() => {
    if (!desktopProject) return;
    void desktopProject.setDirty(dirty);
  }, [dirty]);

  // 启动时只有「文件已成功解析」才把路径交给主进程：
  // 损坏的项目文件会保持 projectPath 为空，绝不覆盖上次可用项目或草稿。
  useEffect(() => {
    if (!desktopProject) return;
    const initial = desktopProject.initial;
    const loadedPath = desktopBootstrap?.projectPath;
    if (initial?.path && loadedPath === initial.path) {
      void desktopProject.adopt(initial.path).then((result) => {
        if (!result.ok) return;
        if (initial.explicit) clearDraft(draftStorageKey(initial.path));
        latestPath.current = initial.path;
        setProjectPath(initial.path);
      });
    }
    if (desktopBootstrap?.error) notify(desktopBootstrap.error);
  }, []);

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
    notify('已载入示例数据');
  }
  function clearWorkspace() {
    if (!window.confirm('清空当前工作区？已下载的文件不会受影响。')) return;
    update(blankWorkspace());
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
  const showingDemo = page === 'recognition' ? !!w.recognition?.demo : w.demo;
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
          {pages.map((p) => (
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
        <div className="sidebar-bottom">
          <div className="privacy-icon">
            <HardDrive size={19} />
          </div>
          <strong>工作区保留在本机</strong>
          <p>工作区自动保存在当前浏览器。使用 AI 分析时，所选数据经本站转发给你选择的 AI 助手。</p>
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
              {page !== 'recognition' && <button onClick={resetDemo}>
                <RotateCcw size={16} />
                载入示例
              </button>}
              {(page === 'spectra' || page === 'screening' || page === 'calibration') && (
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
          <div className={`workspace-status ${showingDemo ? 'demo' : ''}`}>
            <div>
              {showingDemo ? <FlaskConical size={16} /> : <Check size={16} />}
              <span>
                {showingDemo
                  ? '示例工作区 · 仅用于体验功能'
                  : desktopProject
                    ? `当前项目 · ${projectName}${dirty ? ' · 未保存 ( * )' : ' · 已保存'}`
                    : '当前工作区 · 自动保存在此浏览器'}
              </span>
            </div>
            <div className="status-actions">
              {desktopProject && (
                <>
                  <button onClick={() => void newProject()}>新建项目</button>
                  <button onClick={() => void saveProjectFile(false)}>保存项目</button>
                  <button onClick={() => void saveProjectFile(true)}>另存为</button>
                  <button onClick={() => void openProjectFile()}>打开项目</button>
                </>
              )}
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
              <Spectra />
            </>
          )}
          {/* Keep the assistant mounted so uploads, chat and unconfirmed results survive page switching. */}
          <div hidden={page !== 'assistant'}>
            <AiAssistant onOpenWorkspace={() => navigate('spectra')} />
          </div>
          {page === 'screening' && <Screening onImport={() => openImport('objects')} />}
          {page === 'calibration' && <Calibration onImport={() => openImport('calibration')} />}
          {page === 'gradient' && <Gradient />}
          {page === 'recognition' && <Recognition />}
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
