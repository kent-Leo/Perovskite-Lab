import { describe, expect, it } from 'vitest';
import { defaultGroupedBar, emptyGroupedCell, groupedStatistics } from '../src/domain/grouped-bar-2026.11.6';
import { createSheet, ensureWorkbooks, switchSheet } from '../src/domain/workbook';
import { demoWorkspace, type Workspace } from '../src/state/workspace';
import { parseProject, serializeProject } from '../src/services/desktop-project-2026.11.4';

describe('分组柱状图数据与项目兼容', () => {
  it('旧项目默认单系列且不修改原来的荧光强度或工作区版本', () => {
    const legacy = demoWorkspace();
    const prior = structuredClone(legacy.objects);
    const restored = ensureWorkbooks(parseProject(serializeProject(legacy)).workspace);
    expect(restored.screeningChartType ?? 'single').toBe('single');
    expect(restored.objects).toEqual(prior);
    expect(restored.version).toBe(1);
  });

  it('不同 Sheet 的绘图类型、原始数据与样式随项目文件独立往返', () => {
    let workspace: Workspace = ensureWorkbooks(demoWorkspace());
    const grouped = defaultGroupedBar();
    const series = grouped.series[0];
    grouped.categories = [{ id: 'cd', name: 'Cd²⁺', cells: {
      [series.id]: { ...emptyGroupedCell(), mean: '0', sd: '0.2', replicates: ['1', '', '3'] },
    } }];
    grouped.style.yLabel = 'Response';
    workspace = { ...workspace, screeningChartType: 'grouped', groupedScreening: grouped };
    const oldId = workspace.workbooks!.screening!.activeId;
    workspace = { ...workspace, ...createSheet(workspace, 'screening') };
    const secondId = workspace.workbooks!.screening!.activeId;
    expect(secondId).not.toBe(oldId);
    expect(workspace.screeningChartType).toBe('single');
    expect(workspace.groupedScreening).toBeUndefined();
    const reopened = ensureWorkbooks(parseProject(serializeProject(workspace)).workspace);
    workspace = { ...reopened, ...switchSheet(reopened, 'screening', oldId) };
    expect(workspace.screeningChartType).toBe('grouped');
    expect(workspace.groupedScreening).toEqual(grouped);
    expect(workspace.groupedScreening?.categories[0].cells[series.id].replicates).toEqual(['1', '', '3']);
    workspace = { ...workspace, ...switchSheet(workspace, 'screening', secondId) };
    expect(workspace.screeningChartType).toBe('single');
    expect(workspace.groupedScreening).toBeUndefined();
  });
});

describe('重复实验与直接统计输入', () => {
  it('缺失值不计入 n，按样本标准差和标准误计算', () => {
    const cell = { ...emptyGroupedCell(), replicates: ['1', '', '2', '3'] };
    expect(groupedStatistics(cell, 'replicates', 'sd')).toEqual({ mean: 2, sd: 1, sem: 1 / Math.sqrt(3), n: 3, error: 1 });
    expect(groupedStatistics(cell, 'replicates', 'sem').error).toBeCloseTo(1 / Math.sqrt(3));
  });
  it('零是有效值，少于两个有效重复时没有 SD 或 SEM', () => {
    expect(groupedStatistics({ ...emptyGroupedCell(), replicates: ['', '0'] }, 'replicates', 'sd'))
      .toEqual({ mean: 0, sd: null, sem: null, n: 1, error: null });
    expect(groupedStatistics(emptyGroupedCell(), 'statistics', 'none').mean).toBeNull();
  });
  it('保留用户输入的统计结果并拒绝无效或负误差', () => {
    const cell = { ...emptyGroupedCell(), mean: '-4', sd: '2', sem: '1', manualError: '0.3' };
    expect(groupedStatistics(cell, 'statistics', 'manual')).toEqual({ mean: -4, sd: 2, sem: 1, n: null, error: 0.3 });
    expect(() => groupedStatistics({ ...cell, sd: '-1' }, 'statistics', 'sd')).toThrow('非负');
    expect(() => groupedStatistics({ ...cell, replicates: ['3', 'wrong'] }, 'replicates', 'sd')).toThrow('重复测量');
  });
});
