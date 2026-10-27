import type { WaveRange } from '../../shared/ai-contract-v0.9.1-2026.10.27';
import {
  DEFAULT_ASSISTANT_PARAMETERS,
  normalizeAssistantParameters,
  SENSITIVITY_THRESHOLD,
  type AssistantParameters,
  type AssistantProcessingResult,
} from './assistant-processing-v0.9.1-2026.10.27';

/**
 * Deterministic chat-to-parameter translation.
 *
 * Every recognised sentence changes an explicit processing parameter or asks
 * the UI to perform a verifiable action. Free-form AI text never mutates data.
 */

export type AssistantAction =
  | 'recompute'
  | 'show-compare'
  | 'show-original'
  | 'confirm'
  | 'export'
  | 'sync'
  | 'reset'
  | 'none';

export interface AssistantCommandContext {
  parameters: AssistantParameters;
  result?: AssistantProcessingResult | null;
  hasBlank?: boolean;
  confirmed?: boolean;
}

export interface AssistantCommandResult {
  matched: boolean;
  parameters: AssistantParameters;
  /** Process-input changes that are not part of AssistantParameters. */
  process: { subtractBlank?: boolean };
  action: AssistantAction;
  changes: string[];
  reply: string;
}

function normalizeText(text: string) {
  return text
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ',')
    .replace(/[～〜]/g, '~')
    .replace(/[—–]/g, '-')
    .replace(/(\d)\s*(?:到|至|~)\s*(\d)/g, '$1-$2')
    .replace(/纳米/g, 'nm')
    .replace(/\s+/g, ' ')
    .trim();
}

function toRange(from: string, to: string): WaveRange | null {
  const a = Number(from),
    b = Number(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= a) return null;
  return { fromNm: a, toNm: b };
}

function sameRange(a: WaveRange | null, b: WaveRange | null) {
  return a?.fromNm === b?.fromNm && a?.toNm === b?.toNm;
}

function describedRange(range: WaveRange | null) {
  return range ? `${range.fromNm}–${range.toNm} nm` : '全范围';
}

const HELP =
  '我可以把指令转换成分步、可复核的处理参数。例如：处理异常尖峰 / 只标记不修改 / 屏蔽散射 / 扣除空白 / 保护 500–540 nm / 不要修改主峰附近 / 重新分析 450–550 nm / 阈值更保守 / 显示处理前后的光谱 / 确认处理 / 导出 Excel / 同步到 Sheet。';

export function interpretAssistantCommand(
  rawText: string,
  context: AssistantCommandContext,
): AssistantCommandResult {
  const text = normalizeText(rawText),
    original = context.parameters,
    parameters: AssistantParameters = { ...original },
    process: { subtractBlank?: boolean } = {},
    changes: string[] = [];
  let action: AssistantAction = 'none';
  let recognised = false;
  const set = <K extends keyof AssistantParameters>(
    key: K,
    value: AssistantParameters[K],
    label: string,
  ) => {
    if (JSON.stringify(parameters[key]) === JSON.stringify(value)) return;
    parameters[key] = value;
    changes.push(label);
  };

  // Negative phrases are evaluated first so "不要扣空白" cannot enable it.
  if (/(不要|不|取消|关闭|停止).*(扣|减).*空白/.test(text)) {
    process.subtractBlank = false;
    changes.push('关闭空白扣除');
    recognised = true;
    action = 'recompute';
  } else if (/(扣除|减去|扣掉|减掉).*空白|空白扣除/.test(text)) {
    process.subtractBlank = true;
    changes.push('启用 1:1 空白扣除');
    recognised = true;
    action = 'recompute';
  }
  if (/(不要|不|取消|关闭|停止|保留).*(修复|处理|修改).*(异常|尖峰|杂峰)/.test(text) || /只(?:标记|标注|显示)(?:不修改|异常)?/.test(text)) {
    set('repairSpikes', false, '关闭局部修复，仅标记异常点');
    set('maskUnrepairable', false, '关闭自动屏蔽');
    recognised = true;
    action = 'recompute';
  } else if (/(开启|恢复|允许|执行).*(修复|处理).*(异常|尖峰|杂峰)/.test(text) || /修复异常尖峰/.test(text)) {
    set('repairSpikes', true, '启用孤立异常点局部修复');
    recognised = true;
    action = 'recompute';
  }
  if (/(不要|不|取消|关闭|保留).*(屏蔽|去掉|扣除).*(散射|瑞利|拉曼)/.test(text)) {
    set('maskScattering', false, '保留散射区间，仅作标记');
    recognised = true;
    action = 'recompute';
  } else if (/(屏蔽|扣掉|去除|去掉|处理).*(散射|瑞利|拉曼)/.test(text)) {
    set('maskScattering', true, '屏蔽未与保护区重叠的散射候选区间');
    recognised = true;
    action = 'recompute';
  }
  if (/(不要|不|取消|关闭).*(保护).*(主峰|目标峰)/.test(text)) {
    set('protectMainPeak', false, '关闭主峰自动保护');
    recognised = true;
    action = 'recompute';
  } else if (/(保护|保留|不要修改|不要动).*(主峰|目标峰)/.test(text)) {
    set('protectMainPeak', true, '启用主峰自动保护');
    if (/更宽|加宽|扩大/.test(text)) {
      set('protectExtraNm', Math.max(5, parameters.protectExtraNm), '主峰保护边界扩大到至少 5 nm');
    }
    recognised = true;
    action = 'recompute';
  }

  const protectMatch = text.match(
    /(?:保护|保留|不要修改|不要动|避开)(?:区间|范围|区域)?\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/,
  );
  if (protectMatch) {
    const range = toRange(protectMatch[1], protectMatch[2]);
    if (range) {
      set('userProtectedRange', range, `手动保护区 ${range.fromNm}–${range.toNm} nm`);
      set('protectMainPeak', true, '启用主峰自动保护');
      recognised = true;
      action = 'recompute';
    }
  }
  if (/(取消|清除|移除).*(保护).*(区间|范围)/.test(text)) {
    set('userProtectedRange', null, '取消手动保护区');
    recognised = true;
    action = 'recompute';
  }

  const analysisMatch = text.match(
    /(?:重新)?分析(?:区间|范围|区域)?\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/,
  );
  if (analysisMatch) {
    const range = toRange(analysisMatch[1], analysisMatch[2]);
    if (range) {
      set('analysisRange', range, `重分析区间 ${range.fromNm}–${range.toNm} nm`);
      recognised = true;
      action = 'recompute';
    }
  }
  if (/(全范围|整个范围|全谱|分析全部|取消.*(?:分析)?区间|清除.*分析范围)/.test(text)) {
    set('analysisRange', null, '恢复全谱分析');
    recognised = true;
    action = 'recompute';
  }

  const thresholdMatch = text.match(
    /(?:阈值|σ|sigma)\s*(?:设为|调到|改为|为|=|:)?\s*(\d+(?:\.\d+)?)/i,
  );
  if (thresholdMatch) {
    const value = Number(thresholdMatch[1]);
    if (Number.isFinite(value) && value >= 2.5 && value <= 10) {
      set('thresholdSigma', value, `异常阈值 ${value}σ`);
      recognised = true;
      action = 'recompute';
    }
  } else if (/(更保守|提高阈值|降低灵敏度|少识别)/.test(text)) {
    set(
      'thresholdSigma',
      Math.min(10, Math.round((parameters.thresholdSigma + 1) * 10) / 10),
      `异常阈值提高到 ${Math.min(10, Math.round((parameters.thresholdSigma + 1) * 10) / 10)}σ`,
    );
    set('sensitivity', 'conservative', '灵敏度设为保守');
    recognised = true;
    action = 'recompute';
  } else if (/(更激进|更灵敏|降低阈值|提高灵敏度|多识别)/.test(text)) {
    set(
      'thresholdSigma',
      Math.max(2.5, Math.round((parameters.thresholdSigma - 1) * 10) / 10),
      `异常阈值降低到 ${Math.max(2.5, Math.round((parameters.thresholdSigma - 1) * 10) / 10)}σ`,
    );
    set('sensitivity', 'aggressive', '灵敏度设为激进');
    recognised = true;
    action = 'recompute';
  }
  const strengthMatch = text.match(/(?:处理强度|强度)\s*(保守|中|平衡|强|激进)/);
  if (strengthMatch) {
    const token = strengthMatch[1],
      sensitivity =
        token === '保守' ? 'conservative' : token === '强' || token === '激进' ? 'aggressive' : 'balanced';
    set('sensitivity', sensitivity, `处理强度设为${token}`);
    set('thresholdSigma', SENSITIVITY_THRESHOLD[sensitivity], `异常阈值设为 ${SENSITIVITY_THRESHOLD[sensitivity]}σ`);
    recognised = true;
    action = 'recompute';
  }

  const windowMatch = text.match(/(?:窗口|邻域)\s*(?:设为|调到|改为|为|=|:)?\s*(\d+)/);
  if (windowMatch) {
    const value = Math.min(15, Math.max(5, Number(windowMatch[1])));
    set('windowSize', value, `Hampel 窗口 ${value} 点`);
    recognised = true;
    action = 'recompute';
  }
  const runMatch = text.match(/(?:最多|最大).*(?:修复|插值)\s*(\d+)\s*(?:个)?点/);
  if (runMatch) {
    const value = Math.min(10, Math.max(1, Number(runMatch[1])));
    set('maxRepairRun', value, `最多连续修复 ${value} 点`);
    recognised = true;
    action = 'recompute';
  }

  if (/恢复默认|重置参数|重置设置|恢复初始/.test(text)) {
    Object.assign(parameters, DEFAULT_ASSISTANT_PARAMETERS);
    changes.push('恢复默认处理参数');
    recognised = true;
    action = 'reset';
  }
  if (/显示.*(?:处理前后|前后|对比)|处理前后.*(?:光谱|图)|对比图/.test(text)) {
    recognised = true;
    if (!changes.length) action = 'show-compare';
  }
  if (/显示.*原始|只看原始/.test(text)) {
    recognised = true;
    if (!changes.length) action = 'show-original';
  }
  if (/(确认|接受|应用)(?:当前)?(?:处理|结果|建议)/.test(text)) {
    recognised = true;
    if (!changes.length) action = 'confirm';
  }
  if (/导出\s*(?:Excel|xlsx)|下载\s*(?:Excel|xlsx)/i.test(text)) {
    recognised = true;
    if (!changes.length) action = 'export';
  }
  if (/同步.*(?:Sheet|工作表)|保存.*(?:Sheet|工作表)/i.test(text)) {
    recognised = true;
    if (!changes.length) action = 'sync';
  }
  if (/(?:重新)?(?:生成|计算|处理)(?:结果|光谱|异常尖峰)?$/.test(text) && !changes.length && action === 'none') {
    recognised = true;
    action = 'recompute';
  }
  if (/帮我处理异常尖峰|处理异常尖峰|处理杂峰|去杂峰|修复异常/.test(text)) {
    set('repairSpikes', true, '启用孤立异常点局部修复');
    recognised = true;
    action = 'recompute';
  }

  const next = normalizeAssistantParameters(parameters);
  const result = context.result;
  const stats = result
    ? `当前结果：修复 ${result.stats.repaired} 点、屏蔽 ${result.stats.masked} 点、待判断 ${result.stats.unresolved} 点；主峰 ${result.mainPeak?.originalX ?? '未识别'} nm。`
    : '';
  if (!recognised)
    return {
      matched: false,
      parameters: next,
      process: {},
      action: 'none',
      changes: [],
      reply: `我没有把这句话识别为可验证的处理操作，因此没有修改任何参数。${HELP}`,
    };

  const changed =
    process.subtractBlank !== undefined ||
    !sameRange(original.userProtectedRange, next.userProtectedRange) ||
    !sameRange(original.analysisRange, next.analysisRange) ||
    JSON.stringify(original) !== JSON.stringify(next);
  if (changed && action !== 'reset') action = 'recompute';

  let reply = '';
  if (changes.length) {
    reply = `已更新处理参数：${changes.join('；')}。${stats} 参数已变化，请点击“重新生成结果”并重新确认后才能导出或同步。`;
    if (process.subtractBlank && !context.hasBlank)
      reply += ' 当前尚未选择空白光谱；请先上传或指定空白，并确认测量条件一致。';
  } else if (action === 'show-compare') reply = `当前图表已切换为处理前后对比。${stats}`;
  else if (action === 'show-original') reply = '已切换为原始光谱视图；处理结果仍然保留，可随时切回对比视图。';
  else if (action === 'confirm')
    reply = context.confirmed
      ? '当前结果已经确认。'
      : '请使用结果区的“确认处理结果”按钮完成确认；确认前不会允许导出或同步。';
  else if (action === 'export')
    reply = context.confirmed
      ? '正在导出当前已确认结果；Excel 与 Sheet 同步使用同一份处理数据。'
      : '当前结果尚未确认，不能导出。请先预览、确认处理结果。';
  else if (action === 'sync')
    reply = context.confirmed
      ? '正在把当前已确认结果同步到新的 Sheet；不会覆盖已有工作表。'
      : '当前结果尚未确认，不能同步。请先预览、确认处理结果。';
  else if (action === 'recompute') reply = `已按当前参数重新生成结果。${stats}`;
  else if (action === 'reset') reply = '已恢复默认参数，请重新生成结果并确认。';
  else reply = `已识别指令。${stats}`;
  return { matched: true, parameters: next, process, action, changes, reply };
}
