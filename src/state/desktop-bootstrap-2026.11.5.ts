import {
  BROWSER_STORAGE_KEY,
  desktopProject,
  draftStorageKey,
  parseProject,
  readDraft,
} from '../services/desktop-project-2026.11.4';
import { blankWorkspace, prepareWorkspace, type Workspace } from './workspace';

export type DesktopBootstrap = {
  /** 首帧工作区；undefined 表示交给 WorkspaceProvider 读取草稿或示例。 */
  workspace?: Workspace;
  storageKey?: string;
  dirty: boolean;
  projectPath: string | null;
  /** 启动时项目文件损坏等问题的提示。 */
  error: string;
};

/**
 * 桌面端启动决策：
 * 1. 显式双击/命令行传入 .plab：只加载该文件内容，草稿不参与（避免「打开 A 却显示上次工作区」）。
 * 2. 自动恢复上次项目：草稿比文件新时用草稿，并标记未保存。
 * 3. 没有项目文件：交给 WorkspaceProvider 读取未命名草稿或示例数据；
 *    桌面端首次升级时沿用旧版 localStorage 工作区，不让已有数据丢失。
 * 任何情况下项目文件解析失败都不会顶替当前工作区。
 */
export function bootstrapDesktopProject(): DesktopBootstrap {
  if (!desktopProject) return { dirty: false, projectPath: null, error: '' };
  const initial = desktopProject.initial ?? { path: null, explicit: false };
  const storageKey = draftStorageKey(initial.path);
  const draft = initial.explicit ? null : readDraft(storageKey);
  if (draft) {
    try {
      return {
        workspace: prepareWorkspace(parseProject(draft).workspace),
        storageKey,
        dirty: true,
        projectPath: initial.path,
        error: '',
      };
    } catch {
      /* 草稿损坏：退回到项目文件内容 */
    }
  }
  if (initial.content !== undefined) {
    try {
      return {
        workspace: prepareWorkspace(parseProject(initial.content).workspace),
        storageKey,
        dirty: false,
        projectPath: initial.path,
        error: '',
      };
    } catch (error) {
      return {
        workspace: prepareWorkspace(blankWorkspace()),
        storageKey: draftStorageKey(null),
        dirty: false,
        projectPath: null,
        error: `上次的项目文件无法加载（${(error as Error).message}），已打开空白项目`,
      };
    }
  }
  if (!initial.path) {
    // 旧版桌面端把工作区存在浏览器键里：升级后先接管它，原键保持不动。
    const legacy = readDraft(BROWSER_STORAGE_KEY);
    if (legacy) {
      try {
        return {
          workspace: prepareWorkspace(parseProject(legacy).workspace),
          storageKey,
          dirty: true,
          projectPath: null,
          error: '',
        };
      } catch {
        /* 旧数据损坏时不使用，交给示例数据兜底 */
      }
    }
  }
  return { storageKey, dirty: false, projectPath: initial.path, error: '' };
}
