import { APP_VERSION } from '../version-v0.9.0-2026.10.27';
import type { Workspace } from '../state/workspace';

/** 项目文件格式标识，用于区分「项目文件」和旧的「工作区备份 JSON」。 */
export const PROJECT_FORMAT = 'perovskite-lab-project';
export const PROJECT_EXTENSION = 'plab';

export type ProjectFile = {
  format: typeof PROJECT_FORMAT;
  version: 1;
  appVersion: string;
  savedAt: string;
  workspace: Workspace;
};

export type ProjectCommand =
  | { type: 'save' }
  | { type: 'save-as' }
  | { type: 'open' }
  | { type: 'new' }
  | { type: 'loaded'; path: string; content: string }
  | { type: 'load-error'; path: string; error: string };

export type InitialProjectState = {
  path: string | null;
  content?: string;
  /** 启动参数/双击显式指定了项目文件：此时文件内容优先，草稿不再参与恢复。 */
  explicit: boolean;
};

export type DesktopProjectBridge = {
  isDesktop: true;
  initial: InitialProjectState;
  save(content: string, saveAs?: boolean): Promise<{ canceled: boolean; path?: string; error?: string }>;
  open(): Promise<{ canceled: boolean; path?: string; content?: string; error?: string }>;
  adopt(path: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  newProject(): Promise<{ ok: boolean; error?: string }>;
  setDirty(dirty: boolean): Promise<boolean>;
  confirmUnsaved(name?: string): Promise<'save' | 'discard' | 'cancel'>;
  setCommandHandler(handler: ((command: ProjectCommand) => void) | null): void;
};

/** 浏览器里为 undefined，桌面端由 preload 注入。 */
export const desktopProject: DesktopProjectBridge | undefined = (
  globalThis as { desktopProject?: DesktopProjectBridge }
).desktopProject;

export const isDesktopApp = desktopProject?.isDesktop === true;

/** 浏览器里的自动保存键（保持旧版本工作区可继续读取）。 */
export const BROWSER_STORAGE_KEY = 'perovskite-lab-workspace-v1';
const DRAFT_PREFIX = 'perovskite-lab-draft-v1';

/**
 * 桌面端草稿按「项目身份」分开存放：
 * 未落盘的新项目共用 `untitled`，已保存项目按绝对路径区分。
 * 这样项目 A 的自动恢复数据永远不会被项目 B 覆盖。
 */
export function draftStorageKey(projectPath: string | null | undefined): string {
  return projectPath ? `${DRAFT_PREFIX}:file:${projectPath}` : `${DRAFT_PREFIX}:untitled`;
}

export function readDraft(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 隐私模式等场景下无法清理，忽略即可 */
  }
}

export function serializeProject(workspace: Workspace, savedAt = new Date()): string {
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: 1,
    appVersion: APP_VERSION,
    savedAt: savedAt.toISOString(),
    workspace,
  };
  return JSON.stringify(file, null, 2);
}

export type ParsedProject = {
  workspace: Workspace;
  savedAt?: string;
  appVersion?: string;
  legacyBackup: boolean;
};

/**
 * 兼容两种文件：
 * 1. 桌面端「项目文件」（.plab，带 format 字段）
 * 2. 旧版「下载数据备份」导出的工作区 JSON（.json）
 */
export function parseProject(text: string): ParsedProject {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('文件内容不是项目对象');
  const record = data as Record<string, unknown>;
  const legacyBackup = record.format !== PROJECT_FORMAT;
  const candidate = legacyBackup ? record : record.workspace;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
    throw new Error('项目文件缺少工作区数据');
  const workspace = candidate as Workspace;
  if (workspace.version !== 1) throw new Error('项目版本不受支持');
  if (
    !Array.isArray(workspace.spectra) ||
    !Array.isArray(workspace.objects) ||
    !Array.isArray(workspace.calibration) ||
    !workspace.styles ||
    !workspace.gradient
  )
    throw new Error('项目文件缺少必要字段');
  return {
    workspace,
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : undefined,
    appVersion: typeof record.appVersion === 'string' ? record.appVersion : undefined,
    legacyBackup,
  };
}
