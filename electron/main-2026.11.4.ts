import {
  app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell,
  type MenuItemConstructorOptions,
} from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { handleAiRequest } from '../server/ai-handler-2026.10.24';

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
  | { type: 'loaded'; path: string; content: string };

/** 当前打开的项目文件；为空表示尚未落盘。仅存在主进程，渲染进程不持有路径。 */
let projectPath: string | null = null;
/** 应用启动前双击项目文件时，先暂存，等窗口就绪后再送过去。 */
let pendingProjectFile: string | null = null;

const projectFilters = [
  { name: 'Perovskite Lab 项目', extensions: ['plab'] },
  { name: '工作区备份 JSON', extensions: ['json'] },
];

function defaultProjectName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `Perovskite Lab ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.plab`;
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
  const suffix = `Perovskite Lab v${app.getVersion()}`;
  win.setTitle(projectPath ? `${path.basename(projectPath)} — ${suffix}` : suffix);
}

function sendProjectCommand(command: ProjectCommand) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send('project:command', command);
}

async function readProjectFile(filePath: string) {
  const content = await readFile(filePath, 'utf8');
  projectPath = filePath;
  updateWindowTitle();
  return content;
}

async function deliverProjectFile(filePath: string) {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.webContents.isLoading()) {
    pendingProjectFile = filePath;
    return;
  }
  try {
    const content = await readProjectFile(filePath);
    win.webContents.send('project:command', { type: 'loaded', path: filePath, content });
  } catch {
    pendingProjectFile = filePath;
  }
}

function registerProjectHandlers() {
  ipcMain.handle('project:save', async (event, payload: { content?: unknown; saveAs?: unknown }) => {
    const content = typeof payload?.content === 'string' ? payload.content : '';
    if (!content) return { canceled: true, error: '没有可保存的数据' };
    const win = focusedWindow(event);
    let target = payload?.saveAs === true ? null : projectPath;
    if (!target) {
      const options: Electron.SaveDialogOptions = {
        title: '保存项目',
        defaultPath: path.join(app.getPath('documents'), defaultProjectName()),
        filters: projectFilters,
      };
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { canceled: true };
      target = result.filePath.endsWith('.plab') || result.filePath.endsWith('.json')
        ? result.filePath
        : `${result.filePath}.plab`;
    }
    try {
      await writeFile(target, content, 'utf8');
      projectPath = target;
      updateWindowTitle();
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
      return { canceled: false, path: filePath, content: await readProjectFile(filePath) };
    } catch (error) {
      return { canceled: true, error: `读取失败：${(error as Error).message}` };
    }
  });
}

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: '文件',
      submenu: [
        { label: '打开项目…', accelerator: 'CmdOrCtrl+O', click: () => sendProjectCommand({ type: 'open' }) },
        { label: '保存项目', accelerator: 'CmdOrCtrl+S', click: () => sendProjectCommand({ type: 'save' }) },
        {
          label: '项目另存为…',
          accelerator: 'Shift+CmdOrCtrl+S',
          click: () => sendProjectCommand({ type: 'save-as' }),
        },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
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
