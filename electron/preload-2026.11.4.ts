import { contextBridge, ipcRenderer } from 'electron';

/** 主进程 → 渲染进程的项目指令。 */
type ProjectCommand =
  | { type: 'save' }
  | { type: 'save-as' }
  | { type: 'open' }
  | { type: 'new' }
  | { type: 'loaded'; path: string; content: string }
  | { type: 'load-error'; path: string; error: string };

type SaveResult = { canceled: boolean; path?: string; error?: string };
type OpenResult = { canceled: boolean; path?: string; content?: string; error?: string };
type AdoptResult = { ok: boolean; path?: string; error?: string };
type InitialProjectState = { path: string | null; content?: string; explicit: boolean };

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
 * 启动状态必须同步读取：React 首帧就要决定加载哪个工作区（项目文件 / 草稿 / 示例），
 * 否则会先渲染上一次的工作区，再被替换，出现「打开 A 却看到上次数据」的闪烁。
 */
function readInitialState(): InitialProjectState {
  try {
    const state = ipcRenderer.sendSync('project:initial-state') as InitialProjectState | undefined;
    if (state && typeof state === 'object')
      return {
        path: typeof state.path === 'string' ? state.path : null,
        content: typeof state.content === 'string' ? state.content : undefined,
        explicit: state.explicit === true,
      };
  } catch {
    /* 主进程还没注册处理器时按新项目启动 */
  }
  return { path: null, explicit: false };
}

/**
 * 只暴露项目文件的读写，不暴露任何 Node / 文件系统能力。
 * 渲染进程通过 contextIsolation 拿到这个受限对象。
 */
contextBridge.exposeInMainWorld('desktopProject', {
  isDesktop: true as const,
  initial: readInitialState(),
  save: (content: string, saveAs = false): Promise<SaveResult> =>
    ipcRenderer.invoke('project:save', { content, saveAs }),
  open: (): Promise<OpenResult> => ipcRenderer.invoke('project:open'),
  adopt: (path: string): Promise<AdoptResult> => ipcRenderer.invoke('project:adopt', { path }),
  newProject: (): Promise<AdoptResult> => ipcRenderer.invoke('project:new'),
  setDirty: (dirty: boolean): Promise<boolean> => ipcRenderer.invoke('project:set-dirty', dirty),
  confirmUnsaved: (name?: string): Promise<'save' | 'discard' | 'cancel'> =>
    ipcRenderer.invoke('project:confirm-unsaved', { name }),
  setCommandHandler: (callback: ((command: ProjectCommand) => void) | null) => {
    handler = callback;
    if (!callback) return;
    while (pending.length) callback(pending.shift()!);
  },
});
