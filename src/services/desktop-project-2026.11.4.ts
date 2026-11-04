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
  | { type: 'loaded'; path: string; content: string };

export type DesktopProjectBridge = {
  isDesktop: true;
  save(content: string, saveAs?: boolean): Promise<{ canceled: boolean; path?: string; error?: string }>;
  open(): Promise<{ canceled: boolean; path?: string; content?: string; error?: string }>;
  setCommandHandler(handler: ((command: ProjectCommand) => void) | null): void;
};

/** 浏览器里为 undefined，桌面端由 preload 注入。 */
export const desktopProject: DesktopProjectBridge | undefined = (
  globalThis as { desktopProject?: DesktopProjectBridge }
).desktopProject;

export const isDesktopApp = desktopProject?.isDesktop === true;

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
