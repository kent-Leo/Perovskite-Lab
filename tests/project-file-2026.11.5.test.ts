import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  defaultProjectFileName,
  ensureProjectExtension,
  projectDisplayName,
  readProjectFile,
  windowTitle,
  writeFileAtomic,
} from '../electron/project-files-2026.11.5';

describe('项目文件命名与标题', () => {
  it('默认文件名使用不补零的 YYYY.M.D', () => {
    expect(defaultProjectFileName(new Date(2026, 10, 5))).toBe('Perovskite Lab 2026.11.5.plab');
    expect(defaultProjectFileName(new Date(2026, 0, 2))).toBe('Perovskite Lab 2026.1.2.plab');
    expect(defaultProjectFileName(new Date(2027, 11, 31))).toBe('Perovskite Lab 2027.12.31.plab');
  });

  it('补全扩展名但保留 .plab / .json', () => {
    expect(ensureProjectExtension('/tmp/实验')).toBe('/tmp/实验.plab');
    expect(ensureProjectExtension('/tmp/A.plab')).toBe('/tmp/A.plab');
    expect(ensureProjectExtension('/tmp/备份.json')).toBe('/tmp/备份.json');
  });

  it('窗口标题显示项目名与未保存标记', () => {
    expect(windowTitle('/tmp/A.plab', false, '1.1.0')).toBe('A.plab — Perovskite Lab v1.1.0');
    expect(windowTitle('/tmp/A.plab', true, '1.1.0')).toBe('*A.plab — Perovskite Lab v1.1.0');
    expect(windowTitle(null, true, '1.1.0')).toBe('*未命名项目 — Perovskite Lab v1.1.0');
    expect(projectDisplayName(null)).toBe('未命名项目');
  });
});

describe('安全写入', () => {
  let dir = '';
  const setup = async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'plab-atomic-'));
    return dir;
  };
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('写入后内容完全一致，且不残留临时文件', async () => {
    await setup();
    const target = path.join(dir, 'A.plab');
    await writeFileAtomic(target, '{"a":1}');
    await writeFileAtomic(target, '{"a":2}');
    expect(await readFile(target, 'utf8')).toBe('{"a":2}');
    expect((await readdir(dir)).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('写入失败时保留原文件，不会留下半写内容', async () => {
    const target = path.join(dir, 'B.plab');
    await writeFile(target, 'original', 'utf8');
    // 目标目录不存在且父级是一个文件：mkdir 失败，原文件不受影响。
    const blocker = path.join(dir, 'blocker');
    await writeFile(blocker, 'x', 'utf8');
    await expect(writeFileAtomic(path.join(blocker, 'C.plab'), 'next')).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('original');
    expect((await stat(target)).isFile()).toBe(true);
  });

  it('读取不存在的文件给出中文原因', async () => {
    await expect(readProjectFile(path.join(dir, 'missing.plab'))).rejects.toThrow('项目文件不存在');
  });
});

describe('草稿与项目身份', () => {
  beforeEach(() => {
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    });
  });

  it('未命名的草稿键与项目文件的草稿键彼此独立', async () => {
    const { draftStorageKey } = await import('../src/services/desktop-project-2026.11.4');
    const untitled = draftStorageKey(null);
    const a = draftStorageKey('/tmp/A.plab');
    const b = draftStorageKey('/tmp/B.plab');
    expect(new Set([untitled, a, b]).size).toBe(3);
    expect(a).toContain('/tmp/A.plab');
  });

  it('显式双击打开项目时忽略本地草稿，自动恢复时才读取草稿', async () => {
    const { draftStorageKey } = await import('../src/services/desktop-project-2026.11.4');
    const { blankWorkspace, demoWorkspace } = await import('../src/state/workspace');
    const workspace = blankWorkspace();
    workspace.blankRepeats = '9';
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    });
    store.set(draftStorageKey('/tmp/A.plab'), JSON.stringify(workspace));
    vi.stubGlobal('desktopProject', {
      isDesktop: true,
      initial: { path: '/tmp/A.plab', content: JSON.stringify(demoWorkspace()), explicit: true },
    });
    vi.resetModules();
    const explicit = await import('../src/state/desktop-bootstrap-2026.11.5');
    const first = explicit.bootstrapDesktopProject();
    expect(first.dirty).toBe(false);
    expect(first.workspace?.blankRepeats).not.toBe('9');

    vi.stubGlobal('desktopProject', {
      isDesktop: true,
      initial: { path: '/tmp/A.plab', content: JSON.stringify(demoWorkspace()), explicit: false },
    });
    vi.resetModules();
    const restored = await import('../src/state/desktop-bootstrap-2026.11.5');
    const second = restored.bootstrapDesktopProject();
    expect(second.dirty).toBe(true);
    expect(second.workspace?.blankRepeats).toBe('9');
  });

  it('桌面端升级后接管旧版 localStorage 工作区', async () => {
    const { blankWorkspace } = await import('../src/state/workspace');
    const legacy = blankWorkspace();
    legacy.excitation = '488';
    const store = new Map<string, string>([
      ['perovskite-lab-workspace-v1', JSON.stringify(legacy)],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    });
    vi.stubGlobal('desktopProject', { isDesktop: true, initial: { path: null, explicit: false } });
    vi.resetModules();
    const { bootstrapDesktopProject } = await import('../src/state/desktop-bootstrap-2026.11.5');
    const boot = bootstrapDesktopProject();
    expect(boot.workspace?.excitation).toBe('488');
    expect(boot.dirty).toBe(true);
    expect(boot.projectPath).toBeNull();
    // 旧键保持原样，不会被迁移过程删除。
    expect(store.get('perovskite-lab-workspace-v1')).toContain('488');
  });

  it('项目文件损坏时启动不覆盖草稿，打开空白项目', async () => {
    vi.stubGlobal('desktopProject', {
      isDesktop: true,
      initial: { path: '/tmp/broken.plab', content: 'not json', explicit: true },
    });
    vi.resetModules();
    const { bootstrapDesktopProject } = await import('../src/state/desktop-bootstrap-2026.11.5');
    const boot = bootstrapDesktopProject();
    expect(boot.projectPath).toBeNull();
    expect(boot.error).toContain('无法加载');
    expect(boot.workspace?.spectra).toEqual([]);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });
});
