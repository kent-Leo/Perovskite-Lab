import path from 'node:path';
import os from 'node:os';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

/**
 * 桌面端冒烟测试：启动打包产物，验证 app://local 源、静态资源、
 * 字体读取、/api 中继，以及项目文件的保存/打开闭环。用法：
 *   npm run test:desktop
 *   APP_PATH="/path/to/Perovskite Lab.app/Contents/MacOS/Perovskite Lab" npm run test:desktop
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const executablePath =
  process.env.APP_PATH ?? path.join(root, 'release/mac-arm64/Perovskite Lab.app/Contents/MacOS/Perovskite Lab');
const userDataDir = path.join(os.tmpdir(), 'perovskite-lab-desktop-smoke');
const projectFile = path.join(os.tmpdir(), 'perovskite-lab-desktop-smoke.plab');

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
};

await rm(projectFile, { force: true });

const app = await electron.launch({ executablePath, args: [`--user-data-dir=${userDataDir}`] });
try {
  const win = await app.firstWindow({ timeout: 30000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 30000 });

  const title = await win.title();
  const origin = await win.evaluate(() => location.origin);
  if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT, fullPage: false });
  const font = await win.evaluate(async () => {
    const response = await fetch('./fonts/PerovskiteLabSong-Regular-2026.11.3.woff');
    return { ok: response.ok, bytes: (await response.arrayBuffer()).byteLength };
  });
  const relay = await win.evaluate(async () => {
    const response = await fetch('/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer smoke-test-key' },
      body: JSON.stringify({ provider: 'deepseek', model: 'nope' }),
    });
    return { status: response.status, body: await response.text() };
  });

  console.log(`  标题     ${title}`);
  console.log(`  源       ${origin}`);
  console.log(`  字体     ${font.ok ? `ok ${font.bytes} bytes` : 'FAILED'}`);
  console.log(`  中继     ${relay.status} ${relay.body.slice(0, 80)}`);

  if (!title.includes('Perovskite Lab')) fail(`窗口标题异常：${title}`);
  if (origin !== 'app://local') fail(`自定义协议源异常：${origin}`);
  if (!font.ok || font.bytes < 1000) fail('字体未能通过 app://local 读取');
  // 中继走到「不支持此模型」说明请求已被 handleAiRequest 接收并校验
  if (relay.status !== 400 || !relay.body.includes('模型')) fail(`AI 中继异常：${relay.status} ${relay.body.slice(0, 120)}`);

  // —— 项目文件闭环：把保存/打开对话框换成固定路径，走真实 IPC 与真实写盘 ——
  const bridged = await win.evaluate(() => window.desktopProject?.isDesktop === true);
  if (!bridged) fail('preload 未注入 window.desktopProject');

  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, projectFile);

  // 工作区写入 localStorage 有 500 ms 防抖，等它落盘后再取
  await win.waitForFunction(() => Boolean(localStorage.getItem('perovskite-lab-workspace-v1')));
  const content = await win.evaluate(() => localStorage.getItem('perovskite-lab-workspace-v1') ?? '');
  const saved = await win.evaluate(([text]) => window.desktopProject.save(text, true), [content]);
  const reopened = await win.evaluate(() => window.desktopProject.open());
  let onDisk = '';
  try {
    onDisk = await readFile(projectFile, 'utf8');
  } catch {
    /* 下面统一报告 */
  }

  console.log(
    `  项目文件 保存 ${saved.canceled ? 'FAILED' : `${onDisk.length} bytes`} / 打开 ${reopened.content ? 'ok' : 'FAILED'}`,
  );
  if (saved.canceled || !saved.path) fail(`保存项目失败：${saved.error ?? '未返回路径'}`);
  if (!content) fail('未读取到工作区数据');
  if (onDisk !== content) fail('项目文件落盘内容与工作区不一致');
  if (reopened.canceled || reopened.content !== content) fail('重新打开项目文件内容不一致');

  // —— 模拟双击 .plab 启动：命令行带文件，页面就绪后主进程推送 loaded 指令 ——
  // 这条路径以前会丢指令（渲染进程还没注册 handler），Windows 上表现为打开即空白。
  const appWithFile = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}-import`, projectFile],
  });
  try {
    const win2 = await appWithFile.firstWindow({ timeout: 30000 });
    win2.on('dialog', (dialog) => void dialog.accept());
    await win2.waitForLoadState('domcontentloaded');
    await win2.waitForFunction(
      () => Boolean(localStorage.getItem('perovskite-lab-workspace-v1')),
      null,
      { timeout: 20000 },
    );
    const applied = await win2.evaluate(() =>
      JSON.parse(localStorage.getItem('perovskite-lab-workspace-v1') ?? 'null'),
    );
    const expected = JSON.parse(content);
    const sameShape =
      applied?.version === expected?.version &&
      Array.isArray(applied?.spectra) &&
      applied.spectra.length === expected.spectra.length &&
      applied.spectra[0]?.name === expected.spectra[0]?.name &&
      Array.isArray(applied?.objects) &&
      applied.objects.length === expected.objects.length;
    console.log(`  双击打开 ${sameShape ? 'ok' : 'FAILED'}（${applied?.spectra?.length ?? 0} 条光谱）`);
    if (!sameShape) fail('双击 .plab 启动后工作区没有载入');
  } finally {
    await appWithFile.close();
  }

  if (!process.exitCode) console.log('✓ 桌面端冒烟测试通过');
} finally {
  await app.close();
}
