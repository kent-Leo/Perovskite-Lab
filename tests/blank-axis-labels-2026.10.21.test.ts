import { describe, expect, it } from 'vitest';
import { chartSVG } from '../src/domain/chart';
import { chartAxes, type PlotData } from '../src/domain/types';
import { demoWorkspace, normalizeWorkspaceUnits } from '../src/state/workspace';
const data: PlotData = { series: [{ name: 'Ca', color: '#157c65', points: [{ x: 400, y: 8 }, { x: 500, y: 100 }] }] };

describe('blank top/right axis titles in saved workspaces', () => {
  it.each(['top', 'right'] as const)('draws after restoring a visible %s axis with no title', (side) => {
    const workspace = demoWorkspace();
    workspace.styles.spectra.axes = { [side]: { visible: true } };
    const restored = normalizeWorkspaceUnits(JSON.parse(JSON.stringify(workspace)));
    expect(() => chartSVG(data, restored.styles.spectra)).not.toThrow();
    expect(chartAxes(restored.styles.spectra)[side].label).toBe('');
    expect(restored.spectra).toEqual(workspace.spectra);
  });
  it('handles an explicitly undefined axis title and preserves nonblank titles', () => {
    const style = demoWorkspace().styles.spectra;
    style.axes = { top: { visible: true, label: undefined }, right: { visible: true, label: 'µM' } };
    expect(() => chartSVG(data, style)).not.toThrow();
    expect(chartAxes(style).top.label).toBe('');
    expect(chartAxes(normalizeWorkspaceUnits({ ...demoWorkspace(), styles: { ...demoWorkspace().styles, spectra: style } }).styles.spectra).right.label).toBe('µmol/L');
  });
});
