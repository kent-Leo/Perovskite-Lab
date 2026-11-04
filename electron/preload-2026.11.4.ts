import { contextBridge, ipcRenderer } from 'electron';

/** 主进程 → 渲染进程的项目指令。 */
type ProjectCommand =
  | { type: 'save' }
  | { type: 'save-as' }
  | { type: 'open' }
  | { type: 'loaded'; path: string; content: string };

type SaveResult = { canceled: boolean; path?: string; error?: string };
type OpenResult = { canceled: boolean; path?: string; content?: string; error?: string };

let handler: ((command: ProjectCommand) => void) | null = null;
ipcRenderer.on('project:command', (_event, command: ProjectCommand) => handler?.(command));

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
  },
});
