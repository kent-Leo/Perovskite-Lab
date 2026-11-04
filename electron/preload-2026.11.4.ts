import { contextBridge, ipcRenderer } from 'electron';

/** 主进程 → 渲染进程的项目指令。 */
type ProjectCommand =
  | { type: 'save' }
  | { type: 'save-as' }
  | { type: 'open' }
  | { type: 'loaded'; path: string; content: string };

type SaveResult = { canceled: boolean; path?: string; error?: string };
type OpenResult = { canceled: boolean; path?: string; content?: string; error?: string };

/**
 * 渲染进程可能还没挂上监听（React 的 effect 晚于 did-finish-load），
 * 此时主进程送来的「打开项目」会被丢弃，表现为双击 .plab 后界面空白。
 * 先把指令缓存起来，等 setCommandHandler 注册后按顺序补发。
 */
let handler: ((command: ProjectCommand) => void) | null = null;
const pending: ProjectCommand[] = [];
const PENDING_LIMIT = 8;

ipcRenderer.on('project:command', (_event, command: ProjectCommand) => {
  if (handler) {
    handler(command);
    return;
  }
  pending.push(command);
  if (pending.length > PENDING_LIMIT) pending.shift();
});

/**
 * 只暴露项目文件的读写，不暴露任何 Node / 文件系统能力。
 * 渲染进程通过 contextIsolation 拿到这个受限对象。
 */
contextBridge.exposeInMainWorld('desktopProject', {
  isDesktop: true as const,
  save: (content: string, saveAs = false): Promise<SaveResult> =>
    ipcRenderer.invoke('project:save', { content, saveAs }),
  open: (): Promise<OpenResult> => ipcRenderer.invoke('project:open'),
  setCommandHandler: (callback: ((command: ProjectCommand) => void) | null) => {
    handler = callback;
    if (!callback) return;
    while (pending.length) callback(pending.shift()!);
  },
});
