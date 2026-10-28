import { test, expect, type Page } from '@playwright/test';
import type { ChatInput } from '../../shared/ai-chat-2026.10.25';

const key = 'browser-chat-test-key-not-real';
function spectrum(name: string, centre = 520) {
  const rows = Array.from({ length: 101 }, (_, i) => {
    const x = 450 + i;
    return `${x}\t${10 + 500 * Math.exp(-0.5 * ((x - centre) / 8) ** 2) + (x === 480 ? 40 : 0)}`;
  });
  return { name, mimeType: 'text/plain', buffer: Buffer.from(`Sample:\t'test
Instrument
Model:\tF-7100 FL Spectrophotometer
Instrument parameters
Measurement type:\tWavelength scan
Scan mode:\tEmission
EX WL:\t350.0 nm
EM  Start WL:\t450.0 nm
EM  End WL:\t550.0 nm
Data points
nm\tData
${rows.join('\n')}`) };
}
async function start(page: Page, upload = true) {
  await page.goto('/#assistant');
  const region = page.getByRole('region', { name: 'AI 光谱助手', exact: true });
  if (upload) await region.getByLabel('上传 F-7100 TXT 光谱').setInputFiles(spectrum('光谱A.TXT'));
  await region.getByText('AI 服务商与连接', { exact: true }).click();
  await region.getByLabel('个人 API Key').fill(key);
  await region.getByLabel(/我同意/).check();
  return region;
}
async function ask(page: Page, question: string) {
  await page.getByLabel('向 AI 光谱助手提问').fill(question);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}

test('无文件问候、不同问题和连续追问均调用模型，支持多行输入', async ({ page }) => {
  const requests: ChatInput[] = [];
  await page.route('**/api/ai/chat', async (route) => {
    const body = route.request().postDataJSON(); requests.push(body.input);
    expect(body.provider).toBe('deepseek'); expect(body.model).toBe('deepseek-flash');
    expect(route.request().headers().authorization).toBe(`Bearer ${key}`);
    expect(JSON.stringify(body)).not.toContain(key);
    await route.fulfill({ json: { reply: requests.length === 1 ? '你好，我可以回答光谱问题。'
      : requests.length === 2 ? '瑞利散射是弹性散射；拉曼散射有能量交换。' : '连续追问已收到，上轮讨论的是散射。', operation: null } });
  });
  const region = await start(page, false), log = region.getByRole('log');
  await ask(page, '你好'); await expect(log).toContainText('你好，我可以回答光谱问题。');
  expect(requests[0].context).toBeNull();
  await ask(page, '瑞利散射和拉曼散射有什么区别？'); await expect(log).toContainText('弹性散射');
  await page.getByLabel('向 AI 光谱助手提问').fill('继续解释');
  await page.getByLabel('向 AI 光谱助手提问').press('Shift+Enter');
  await page.getByLabel('向 AI 光谱助手提问').press('a');
  await expect(page.getByLabel('向 AI 光谱助手提问')).toHaveValue('继续解释\na');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(log).toContainText('上轮讨论的是散射');
  expect(requests[2].history.map((v) => v.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(requests[2].history[0].content).toBe('你好');
  await region.getByRole('button', { name: '清除当前对话' }).click();
  await expect(log).not.toContainText('弹性散射');
});

test('真实F-7100指标、多轮历史、草稿与文件会话分别隔离', async ({ page }) => {
  const requests: ChatInput[] = [];
  await page.route('**/api/ai/chat', async (route) => {
    const { input } = route.request().postDataJSON() as { input: ChatInput }; requests.push(input);
    await route.fulfill({ json: { reply: `${input.context!.file.name} 主峰候选 ${input.context!.preview.mainPeak!.x} nm，激发 ${input.context!.file.excitationNm} nm。第${input.history.length}条历史。`, operation: null } });
  });
  const region = await start(page), log = region.getByRole('log');
  await ask(page, '分析一下主峰强度、峰位和谱线特征'); await expect(log).toContainText('主峰候选 520 nm');
  const ctx = requests[0].context!;
  expect(ctx.file).toMatchObject({ name: '光谱A.TXT', pointCount: 101, excitationNm: 350, scanRange: { fromNm: 450, toNm: 550 } });
  expect(ctx.file.rawMaximum).toEqual({ x: 520, y: 510 });
  expect(ctx.data.points).toHaveLength(101);
  await ask(page, '它是不是杂峰？'); await expect(log).toContainText('第2条历史');
  expect(requests[1].history[0].content).toBe('分析一下主峰强度、峰位和谱线特征');
  await page.getByLabel('向 AI 光谱助手提问').fill('A 的未发送草稿');
  await region.getByLabel('上传 F-7100 TXT 光谱').setInputFiles(spectrum('光谱B.TXT', 515));
  await expect(log).not.toContainText('它是不是杂峰');
  await ask(page, '这份呢？'); await expect(log).toContainText('光谱B.TXT 主峰候选 515 nm');
  expect(requests[2].history).toEqual([]);
  expect(requests[2].context!.sessionId).not.toBe(ctx.sessionId);
  await region.getByRole('tab', { name: /光谱A/ }).click();
  await expect(page.getByLabel('向 AI 光谱助手提问')).toHaveValue('A 的未发送草稿');
  await expect(log).toContainText('它是不是杂峰'); await expect(log).not.toContainText('光谱B.TXT 主峰候选');
  await region.getByRole('button', { name: '清除当前对话' }).click();
  await ask(page, '重新开始'); await expect(log).toContainText('第0条历史');
  await region.getByRole('button', { name: '移除 光谱A.TXT' }).click();
  await expect(log).toContainText('光谱B.TXT 主峰候选');
});

test('模型建议经用户应用生成预览，确认前禁止导出；旧建议不能跨版本使用', async ({ page }) => {
  await page.route('**/api/ai/chat', async (route) => {
    const { input } = route.request().postDataJSON() as { input: ChatInput };
    await route.fulfill({ json: { reply: '建议阈值设为5σ，并保护500–540nm，待你应用预览。', operation: {
      type: 'update-parameters', sessionId: input.context!.sessionId, revision: input.context!.revision,
      parameters: { thresholdSigma: 5, protectMainPeak: true, userProtectedRange: { fromNm: 500, toNm: 540 } },
    } } });
  });
  const region = await start(page);
  await region.getByLabel(/确认处理后自动同步/).uncheck();
  await region.getByRole('button', { name: '确认处理结果', exact: true }).click();
  await expect(region.getByRole('button', { name: '导出 Excel', exact: true })).toBeEnabled();
  await ask(page, '把异常检测阈值提高到 5σ，保护 500–540 nm 的主峰区域。');
  const apply = region.getByRole('button', { name: '应用建议并生成预览' });
  await expect(apply).toBeVisible();
  await expect(region.getByLabel('异常识别阈值 / σ')).toHaveValue('4');
  await expect(region.getByRole('button', { name: '导出 Excel', exact: true })).toBeEnabled();
  await apply.click();
  await expect(region.getByLabel('异常识别阈值 / σ')).toHaveValue('5');
  await expect(region.getByLabel('手动目标保护区起点')).toHaveValue('500');
  await expect(region.getByRole('button', { name: '导出 Excel', exact: true })).toBeDisabled();
  await expect(region.getByRole('log')).toContainText('本地算法生成新预览');
  await expect(region.getByRole('button', { name: '已生成预览', exact: true })).toBeDisabled();
  await ask(page, '再生成建议');
  await expect(apply).toBeVisible();
  await region.getByLabel('异常识别阈值 / σ').fill('6');
  await expect(region.getByRole('button', { name: '参数已变化，请重新提问' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/AI多轮对话-操作预览-2026.10.25.png', fullPage: true });
});

test('缺少Key、额度失败、取消、重新生成和清除均显示真实状态', async ({ page }) => {
  await page.goto('/#assistant');
  await ask(page, '你好');
  await expect(page.getByRole('region', { name: 'AI 光谱助手', exact: true })).toContainText('请先在 AI 设置中填写个人 API Key');
  const region = await start(page, false), log = region.getByRole('log');
  let attempt = 0, release: (() => void) | undefined;
  await page.route('**/api/ai/chat', async (route) => {
    attempt++;
    if (attempt === 1) await route.fulfill({ status: 402, json: { error: 'AI 账户余额不足，请在服务商平台充值' } });
    else if (attempt === 2) {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ json: { reply: '不应显示的迟到响应', operation: null } }).catch(() => {});
    } else await route.fulfill({ json: { reply: '重新生成成功', operation: null } });
  });
  await ask(page, '你好'); await expect(region).toContainText('账户余额不足');
  await expect(log.locator('.assistant-message.assistant')).toHaveCount(0);
  await region.getByRole('button', { name: '重新生成回复' }).click();
  await expect(region.getByRole('button', { name: '取消聊天请求' })).toBeVisible();
  await expect.poll(() => !!release).toBe(true);
  await region.getByRole('button', { name: '取消聊天请求' }).click(); release!();
  await expect(region).toContainText('请求已取消'); await expect(log).not.toContainText('迟到响应');
  await region.getByRole('button', { name: '重新生成回复' }).click(); await expect(log).toContainText('重新生成成功');
  await expect(log.locator('.assistant-message.user')).toHaveCount(1);
  await region.getByRole('button', { name: '清除当前对话' }).click(); await expect(log.locator('article')).toHaveCount(0);
});

test('390px手机聊天无横向溢出，并隐藏输入中粘贴的Key', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/ai/chat', async (route) => {
    expect(route.request().postData()).not.toContain(key);
    await route.fulfill({ json: { reply: '请勿在对话中粘贴密钥。', operation: null } });
  });
  const region = await start(page, false);
  await ask(page, `你好 ${key}`); await expect(region.getByRole('log')).toContainText('[密钥已隐藏]');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/AI多轮对话-手机端-2026.10.25.png', fullPage: true });
});

test('删除或清空正在请求的文件会话后，迟到回复不能重新出现', async ({ page }) => {
  const pending: (() => void)[] = [];
  await page.route('**/api/ai/chat', async (route) => {
    await new Promise<void>((resolve) => { pending.push(resolve); });
    await route.fulfill({ json: { reply: '已取消会话的迟到模型输出', operation: null } }).catch(() => {});
  });
  const region = await start(page);
  await ask(page, 'A 文件请求'); await expect.poll(() => pending.length).toBe(1);
  await region.getByLabel('上传 F-7100 TXT 光谱').setInputFiles(spectrum('光谱B.TXT', 515));
  await expect(region.getByRole('button', { name: '发送消息' })).toBeDisabled(); // empty draft, no inherited busy request
  await ask(page, 'B 文件请求'); await expect.poll(() => pending.length).toBe(2);
  await region.getByRole('button', { name: '移除 光谱A.TXT' }).click(); pending[0]();
  await region.getByRole('button', { name: '清除当前对话' }).click(); pending[1]();
  await expect(region.getByRole('log').locator('article')).toHaveCount(0);
  await expect(region.getByRole('log')).not.toContainText('迟到模型输出');
  await expect(region.getByRole('tab', { name: /光谱A/ })).toHaveCount(0);
  await page.getByLabel('向 AI 光谱助手提问').fill('新的问题');
  await expect(region.getByRole('button', { name: '发送消息' })).toBeEnabled();
});
