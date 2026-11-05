import {
  app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell,
  type MenuItemConstructorOptions,
} from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { handleAiRequest } from '../server/ai-handler-2026.10.24';
import {
  PROJECT_FILTERS,
  defaultProjectFileName,
  ensureProjectExtension,
  readProjectFile,
  windowTitle,
  writeFileAtomic,
} from './project-files-2026.11.5';

/**
 * 桌面壳：把 dist/ 静态站点挂到稳定的 app://local 源上，
 * 并把 /api/* 原样交给既有的 handleAiRequest，不改动前端任何代码。
 * 固定源（而不是 http://127.0.0.1:随机端口）可保证 localStorage
 * 中的工作区与 AI 密钥在版本升级后依然存在。
 */
const SCHEME = 'app';
const APP_ORIGIN = `${SCHEME}://local`;
/** 中继只接受同源请求，这里用固定基址构造 Request 以便复用同一套校验。 */
const RELAY_ORIGIN = 'http://app.local';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
};

const plain = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
const jsonText = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const staticRoot = () => path.join(app.getAppPath(), 'dist');

async function serveStatic(pathname: string): Promise<Response> {
  let relative = pathname;
  try { relative = decodeURIComponent(pathname); } catch { return plain('Bad Request', 400); }
  if (relative === '/' || relative === '') relative = '/index.html';
  const root = staticRoot();
  const target = path.normalize(path.join(root, relative));
  if (target !== root && !target.startsWith(root + path.sep)) return plain('Forbidden', 403);
  try {
    const data = await readFile(target);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      },
    });
  } catch {
    return plain('Not Found', 404);
  }
}

async function serveApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  // 渲染进程是本机唯一调用方；沿用中继里的同源守卫，把来源归一到固定基址。
  if (headers.has('Origin')) headers.set('Origin', RELAY_ORIGIN);
  headers.delete('Sec-Fetch-Site');
  const init: RequestInit = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  return handleAiRequest(new Request(new URL(url.pathname + url.search, RELAY_ORIGIN), init));
}

async function route(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith('/api/')) return serveStatic(pathname);
  try {
    return await serveApi(request);
  } catch {
    return jsonText({ error: '本地 AI 接口处理失败' }, 500);
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

/** ---------------- 项目文件（.plab） ---------------- */

type ProjectCommand =
  | { type: 'save' }
  | { type: 'save-as' }
  | { type: 'open' }
  | { type: 'new' }
  | { type: 'loaded'; path: string; content: string }
  | { type: 'load-error'; path: string; error: string };

type ProjectSession = { lastProjectPath: string | null };

/** 当前打开的项目文件；为空表示尚未落盘。仅存在主进程，渲染进程不持有路径。 */
let projectPath: string | null = null;
/** 渲染进程上报的未保存状态，只用于窗口标题与关闭确认。 */
let projectDirty = false;
/** 应用启动前双击项目文件时，先暂存，等窗口就绪后再送过去。 */
let pendingProjectFile: string | null = null;
/** 已通过校验、等待渲染进程 adopt 的路径；渲染进程确认前不改动 projectPath。 */
let confirmedProjectFile: string | null = null;
let startupSession: ProjectSession = { lastProjectPath: null };
let initialStateCache: { path: string | null; content?: string; explicit: boolean } | null = null;
let closeAfterSave = false;
let closing = false;
let closePromptOpen = false;

const projectFilters = PROJECT_FILTERS;

function sessionFile() {
  return path.join(app.getPath('userData'), 'project-session.json');
}

async function readSession(): Promise<ProjectSession> {
  try {
    const data = JSON.parse(await readFile(sessionFile(), 'utf8')) as {
      lastProjectPath?: unknown;
    };
    return {
      lastProjectPath: typeof data.lastProjectPath === 'string' ? data.lastProjectPath : null,
    };
  } catch {
    return { lastProjectPath: null };
  }
}

async function writeSession() {
  try {
    await writeFile(
      sessionFile(),
      JSON.stringify({ lastProjectPath: projectPath } satisfies ProjectSession),
      'utf8',
    );
  } catch {
    /* 会话记录失败不影响项目文件本身 */
  }
}

function projectFileFromArgv(argv: string[]) {
  return argv.find((arg) => !arg.startsWith('-') && /\.plab$/i.test(arg)) ?? null;
}

function focusedWindow(event?: Electron.IpcMainInvokeEvent) {
  const fromEvent = event ? BrowserWindow.fromWebContents(event.sender) : null;
  return fromEvent ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function updateWindowTitle() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  win.setTitle(windowTitle(projectPath, projectDirty, app.getVersion()));
}

function sendProjectCommand(command: ProjectCommand) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send('project:command', command);
}

/** 只读取内容，不改变当前项目路径：路径要等渲染进程校验、确认后再 adopt。 */
async function readProjectContent(filePath: string) {
  confirmedProjectFile = filePath;
  return readProjectFile(filePath);
}

async function deliverProjectFile(filePath: string) {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.webContents.isLoading()) {
    pendingProjectFile = filePath;
    return;
  }
  try {
    const content = await readProjectContent(filePath);
    win.webContents.send('project:command', { type: 'loaded', path: filePath, content });
  } catch (error) {
    confirmedProjectFile = null;
    win.webContents.send('project:command', {
      type: 'load-error',
      path: filePath,
      error: `读取失败：${(error as Error).message}`,
    });
  }
}

/**
 * 启动恢复只使用「上次打开的项目文件」和「未命名草稿」：
 * - 命令行 / Finder 显式指定了 .plab 时，只加载该文件，绝不用上次的工作区顶替；
 * - 没有指定文件时，先读上次的项目文件内容，并由渲染进程决定是否改用更新的本地草稿。
 */
function computeInitialState() {
  if (initialStateCache) return initialStateCache;
  const explicit = pendingProjectFile ?? projectFileFromArgv(process.argv);
  if (explicit) {
    try {
      // 已随启动参数加载，避免 did-finish-load 时重复投递同一文件。
      pendingProjectFile = null;
      initialStateCache = {
        path: explicit,
        content: readFileSync(explicit, 'utf8'),
        explicit: true,
      };
      return initialStateCache;
    } catch {
      pendingProjectFile = null;
      initialStateCache = { path: null, explicit: true };
      return initialStateCache;
    }
  }
  const last = startupSession.lastProjectPath;
  if (last) {
    try {
      initialStateCache = { path: last, content: readFileSync(last, 'utf8'), explicit: false };
      return initialStateCache;
    } catch {
      /* 上次的文件被移动或删除：按新项目启动 */
    }
  }
  initialStateCache = { path: null, explicit: false };
  return initialStateCache;
}

function registerProjectHandlers() {
  ipcMain.on('project:initial-state', (event) => {
    event.returnValue = computeInitialState();
  });

  ipcMain.handle('project:save', async (event, payload: { content?: unknown; saveAs?: unknown }) => {
    const content = typeof payload?.content === 'string' ? payload.content : '';
    if (!content) return { canceled: true, error: '没有可保存的数据' };
    const win = focusedWindow(event);
    let target = payload?.saveAs === true ? null : projectPath;
    if (!target) {
      const options: Electron.SaveDialogOptions = {
        title: '保存项目',
        defaultPath: path.join(app.getPath('documents'), defaultProjectFileName()),
        filters: projectFilters,
      };
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { canceled: true };
      target = ensureProjectExtension(result.filePath);
    }
    try {
      await writeFileAtomic(target, content);
      projectPath = target;
      projectDirty = false;
      updateWindowTitle();
      await writeSession();
      return { canceled: false, path: target };
    } catch (error) {
      return { canceled: true, error: `写入失败：${(error as Error).message}` };
    }
  });

  ipcMain.handle('project:open', async (event) => {
    const win = focusedWindow(event);
    const options: Electron.OpenDialogOptions = {
      title: '打开项目',
      properties: ['openFile'],
      filters: projectFilters,
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const [filePath] = result.filePaths;
    if (result.canceled || !filePath) return { canceled: true };
    try {
      return { canceled: false, path: filePath, content: await readProjectContent(filePath) };
    } catch (error) {
      confirmedProjectFile = null;
      return { canceled: true, error: `读取失败：${(error as Error).message}` };
    }
  });

  /** 渲染进程完成解析与用户确认后才调用：此刻才真正切换当前项目。 */
  ipcMain.handle('project:adopt', async (_event, payload: { path?: unknown }) => {
    const target = typeof payload?.path === 'string' ? payload.path : '';
    if (!target) return { ok: false, error: '缺少项目路径' };
    if (confirmedProjectFile && confirmedProjectFile !== target)
      return { ok: false, error: '项目文件已在别处更改，请重新打开' };
    try {
      await stat(target);
    } catch {
      return { ok: false, error: '项目文件已不存在' };
    }
    projectPath = target;
    projectDirty = false;
    confirmedProjectFile = null;
    updateWindowTitle();
    await writeSession();
    return { ok: true, path: target };
  });

  /** 新建项目：清空当前路径，下一次保存重新弹出文件选择窗口。 */
  ipcMain.handle('project:new', async () => {
    projectPath = null;
    projectDirty = false;
    confirmedProjectFile = null;
    updateWindowTitle();
    await writeSession();
    return { ok: true };
  });

  ipcMain.handle('project:set-dirty', (event, dirty: unknown) => {
    projectDirty = dirty === true;
    updateWindowTitle();
    const win = focusedWindow(event);
    if (!projectDirty && closeAfterSave) {
      closeAfterSave = false;
      closing = true;
      win?.close();
    }
    return projectDirty;
  });

  ipcMain.handle('project:confirm-unsaved', async (event, payload: { name?: unknown }) => {
    const win = focusedWindow(event);
    const name = typeof payload?.name === 'string' && payload.name ? payload.name : '当前项目';
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['保存', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: `${name} 有未保存的修改`,
      detail: '继续操作会替换当前工作区；已保存到磁盘的项目文件不受影响。',
    };
    const { response } = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
    return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel';
  });
}

/** 关闭窗口前确认未保存修改；选择保存时等渲染进程保存完成再关闭。 */
function guardProjectClose(win: BrowserWindow) {
  win.on('close', (event) => {
    if (closing || !projectDirty) return;
    event.preventDefault();
    if (closePromptOpen) return;
    closePromptOpen = true;
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        buttons: ['保存', '不保存', '取消'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        message: `${projectPath ? path.basename(projectPath) : '当前项目'} 有未保存的修改`,
        detail: '关闭前是否保存到项目文件？',
      })
      .then(({ response }) => {
        if (response === 2) return;
        if (response === 1) {
          closing = true;
          win.close();
          return;
        }
        closeAfterSave = true;
        sendProjectCommand({ type: 'save' });
      })
      .finally(() => {
        closePromptOpen = false;
      });
  });
  // 页面 <title> 会让 Electron 覆盖自定义标题，这里统一由主进程维护窗口标题。
  win.on('page-title-updated', (event) => event.preventDefault());
}

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: '文件',
      submenu: [
        { label: '新建项目', accelerator: 'CmdOrCtrl+N', click: () => sendProjectCommand({ type: 'new' }) },
        { label: '打开项目…', accelerator: 'CmdOrCtrl+O', click: () => sendProjectCommand({ type: 'open' }) },
        { type: 'separator' },
        { label: '保存项目', accelerator: 'CmdOrCtrl+S', click: () => sendProjectCommand({ type: 'save' }) },
        {
          label: '项目另存为…',
          accelerator: 'Shift+CmdOrCtrl+S',
          click: () => sendProjectCommand({ type: 'save-as' }),
        },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
        ...(process.platform === 'darwin'
          ? []
          : [{ role: 'quit' as const, label: '退出' }]),
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#142d2a',
    title: 'Perovskite Lab',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  guardProjectClose(win);

  // 站内导航只允许 app://local，外部链接交给系统浏览器。
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`${APP_ORIGIN}/`)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-finish-load', deliverPendingProjectFile);

  const entry = path.join(staticRoot(), 'index.html');
  try {
    await readFile(entry);
  } catch {
    await dialog.showMessageBox({
      type: 'error',
      message: '未找到前端构建产物',
      detail: '请先运行 npm run build:app 生成 dist/ 后再启动桌面端。',
      buttons: ['好'],
    });
    app.quit();
    return;
  }

  await win.loadURL(`${APP_ORIGIN}/index.html`);
  updateWindowTitle();
}

/** 页面每次加载完成都要补投递一次：双击项目文件可能发生在窗口加载前后。 */
function deliverPendingProjectFile() {
  if (!pendingProjectFile) return;
  const filePath = pendingProjectFile;
  pendingProjectFile = null;
  void deliverProjectFile(filePath);
}

const locked = app.requestSingleInstanceLock();
if (!locked) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const filePath = projectFileFromArgv(argv);
    if (filePath) void deliverProjectFile(filePath);
  });

  // macOS：Finder 双击 .plab 会走 open-file，可能发生在 app ready 之前。
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    void deliverProjectFile(filePath);
  });

  const startupProject = projectFileFromArgv(process.argv);
  if (startupProject) pendingProjectFile = startupProject;

  void app.whenReady().then(async () => {
    app.setAboutPanelOptions({
      applicationName: 'Perovskite Lab',
      applicationVersion: app.getVersion(),
    });

    startupSession = await readSession();

    protocol.handle(SCHEME, (request) =>
      route(request).catch(() => jsonText({ error: '本地资源读取失败' }, 500)));

    registerProjectHandlers();

    // 导出（xlsx / pdf / png / svg）走 a.download，统一弹原生“另存为”。
    session.defaultSession.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({
        title: '保存导出文件',
        defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
      });
    });

    buildMenu();
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
