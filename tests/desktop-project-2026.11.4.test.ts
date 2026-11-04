import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, parseProject, serializeProject } from '../src/services/desktop-project-2026.11.4';
import { blankWorkspace } from '../src/state/workspace';

describe('桌面端项目文件', () => {
  it('保存后可以完整还原工作区', () => {
    const workspace = blankWorkspace();
    workspace.blankRepeats = '4';
    const text = serializeProject(workspace, new Date('2026-11-04T00:00:00Z'));
    const raw = JSON.parse(text);
    expect(raw.format).toBe(PROJECT_FORMAT);
    expect(raw.version).toBe(1);
    const parsed = parseProject(text);
    expect(parsed.legacyBackup).toBe(false);
    expect(parsed.workspace).toEqual(workspace);
    expect(parsed.savedAt).toBe('2026-11-04T00:00:00.000Z');
  });

  it('兼容旧版「下载数据备份」导出的 JSON', () => {
    const workspace = blankWorkspace();
    const parsed = parseProject(JSON.stringify(workspace));
    expect(parsed.legacyBackup).toBe(true);
    expect(parsed.workspace).toEqual(workspace);
  });

  it('忽略 BOM 与首尾空白', () => {
    const workspace = blankWorkspace();
    const parsed = parseProject(`\uFEFF${JSON.stringify(workspace)}`);
    expect(parsed.workspace.version).toBe(1);
  });

  it('拒绝非项目文件并给出中文原因', () => {
    expect(() => parseProject('not json')).toThrow('文件不是有效的 JSON');
    expect(() => parseProject('null')).toThrow('文件内容不是项目对象');
    expect(() => parseProject('[1,2]')).toThrow('文件内容不是项目对象');
    expect(() => parseProject('{"a":1}')).toThrow('项目版本不受支持');
    expect(() => parseProject(JSON.stringify({ format: PROJECT_FORMAT, version: 1 }))).toThrow(
      '项目文件缺少工作区数据',
    );
    expect(() => parseProject(JSON.stringify({ version: 1, spectra: [] }))).toThrow('项目文件缺少必要字段');
  });
});
