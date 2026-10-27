import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSISTANT_PARAMETERS,
  processAssistantSpectrum,
  type AssistantParameters,
} from '../src/domain/assistant-processing-v0.9.1-2026.10.27';
import { interpretAssistantCommand } from '../src/domain/assistant-command-v0.9.1-2026.10.27';
import type { Point } from '../src/domain/types';

const params = (overrides: Partial<AssistantParameters> = {}): AssistantParameters => ({
  ...DEFAULT_ASSISTANT_PARAMETERS,
  ...overrides,
});
const context = (overrides: Partial<AssistantParameters> = {}) => ({
  parameters: params(overrides),
  result: null,
  hasBlank: true,
  confirmed: false,
});

describe('AI 光谱助手自然语言指令', () => {
  it('turns an analysis-range sentence into a concrete parameter', () => {
    const result = interpretAssistantCommand('重新分析 450–550 nm 区域', context());
    expect(result.matched).toBe(true);
    expect(result.parameters.analysisRange).toEqual({ fromNm: 450, toNm: 550 });
    expect(result.action).toBe('recompute');
    expect(result.reply).toContain('重分析区间');
  });

  it('protects the main peak and a numeric window without touching intensities', () => {
    const main = interpretAssistantCommand('不要修改主峰附近', context({ protectMainPeak: false }));
    expect(main.parameters.protectMainPeak).toBe(true);
    const range = interpretAssistantCommand('保护 500 到 540 nm', context());
    expect(range.parameters.userProtectedRange).toEqual({ fromNm: 500, toNm: 540 });
    expect(range.parameters.protectMainPeak).toBe(true);
  });

  it('enables or disables repair, scattering masks and blank subtraction as explicit parameters', () => {
    const markOnly = interpretAssistantCommand('只标记不修改', context());
    expect(markOnly.parameters.repairSpikes).toBe(false);
    expect(markOnly.parameters.maskUnrepairable).toBe(false);
    const repair = interpretAssistantCommand('帮我处理异常尖峰', context({ repairSpikes: false }));
    expect(repair.parameters.repairSpikes).toBe(true);
    const scattering = interpretAssistantCommand('屏蔽散射', context());
    expect(scattering.parameters.maskScattering).toBe(true);
    const keepScattering = interpretAssistantCommand('不要屏蔽散射', context({ maskScattering: true }));
    expect(keepScattering.parameters.maskScattering).toBe(false);
    const blank = interpretAssistantCommand('扣除空白', context());
    expect(blank.process.subtractBlank).toBe(true);
    const noBlank = interpretAssistantCommand('不要扣空白', context());
    expect(noBlank.process.subtractBlank).toBe(false);
  });

  it('adjusts thresholds, strength, window and maximum repair run within supported bounds', () => {
    const conservative = interpretAssistantCommand('阈值更保守', context({ thresholdSigma: 4 }));
    expect(conservative.parameters.thresholdSigma).toBe(5);
    expect(conservative.parameters.sensitivity).toBe('conservative');
    const aggressive = interpretAssistantCommand('更灵敏', context({ thresholdSigma: 4 }));
    expect(aggressive.parameters.thresholdSigma).toBe(3);
    const numeric = interpretAssistantCommand('异常阈值设为 6.5σ', context());
    expect(numeric.parameters.thresholdSigma).toBe(6.5);
    const strength = interpretAssistantCommand('处理强度 强', context());
    expect(strength.parameters.sensitivity).toBe('aggressive');
    expect(strength.parameters.thresholdSigma).toBe(3);
    const window = interpretAssistantCommand('窗口 9', context());
    expect(window.parameters.windowSize).toBe(9);
    const run = interpretAssistantCommand('最多修复 5 个点', context());
    expect(run.parameters.maxRepairRun).toBe(5);
  });

  it('maps view, confirmation, export and sync commands to verifiable UI actions', () => {
    expect(interpretAssistantCommand('显示处理前后的光谱', context()).action).toBe('show-compare');
    expect(interpretAssistantCommand('只看原始光谱', context()).action).toBe('show-original');
    expect(interpretAssistantCommand('确认处理结果', context()).action).toBe('confirm');
    expect(interpretAssistantCommand('导出 Excel', context()).action).toBe('export');
    expect(interpretAssistantCommand('同步到 Sheet', context()).action).toBe('sync');
    expect(interpretAssistantCommand('恢复默认参数', context({ thresholdSigma: 8 })).action).toBe(
      'reset',
    );
  });

  it('refuses to export or sync before confirmation and never mutates on unknown text', () => {
    const before = JSON.stringify(context().parameters);
    const unknown = interpretAssistantCommand('今天天气怎么样', context());
    expect(unknown.matched).toBe(false);
    expect(JSON.stringify(unknown.parameters)).toBe(before);
    expect(unknown.action).toBe('none');
    expect(unknown.reply).toContain('没有把这句话识别');
    const exportUnconfirmed = interpretAssistantCommand('导出 Excel', context());
    expect(exportUnconfirmed.reply).toContain('尚未确认');
    const confirmed = interpretAssistantCommand('导出 Excel', {
      ...context(),
      confirmed: true,
    });
    expect(confirmed.reply).toContain('正在导出');
  });

  it('warns when blank subtraction is requested without a blank spectrum', () => {
    const result = interpretAssistantCommand('扣除空白', {
      ...context(),
      hasBlank: false,
    });
    expect(result.process.subtractBlank).toBe(true);
    expect(result.reply).toContain('尚未选择空白光谱');
  });

  it('produces parameters that the numerical engine can apply', () => {
    const points: Point[] = Array.from({ length: 41 }, (_, index) => ({
      x: 460 + index,
      y: 10 + (index === 20 ? 60 : 0) + (index === 30 ? 5 : 0),
    }));
    const command = interpretAssistantCommand('分析 470–490 nm，阈值 3，只标记不修改', context());
    expect(command.parameters.analysisRange).toEqual({ fromNm: 470, toNm: 490 });
    const result = processAssistantSpectrum({
      points,
      excitationNm: 350,
      solvent: '水',
      slitNm: 2.5,
      blank: null,
      subtractBlank: false,
      blankSameConditions: false,
      parameters: command.parameters,
    });
    expect(result.points.find((point) => point.x === 480)?.status).toBe('unresolved');
    expect(result.points.find((point) => point.x === 480)?.processed).toBe(
      result.points.find((point) => point.x === 480)?.corrected,
    );
  });
});
