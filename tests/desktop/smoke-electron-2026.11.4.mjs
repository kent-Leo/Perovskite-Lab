import path from 'node:path';
import os from 'node:os';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

/**
 * 桌面端冒烟测试：验证 app://local 源、静态资源、字体读取、/api 中继，
 * 以及项目文件闭环（保存 / 另存为 / 打开 / 取消 / 损坏文件 / 双击启动）。
 * 用法：
 *   npm run build:app && npm run test:desktop          # 用仓库里的 Electron 跑最新构建
 *   APP_PATH="/path/to/Perovskite Lab.app/Contents/MacOS/Perovskite Lab" npm run test:desktop
 *   SMOKE_PACKAGED=1 npm run test:desktop              # 用 release/ 里的安装包
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const exists = (target) => access(target).then(() => true, () => false);
const localElectron =
  process.platform === 'darwin'
    ? path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : process.platform === 'win32'
      ? path.join(root, 'node_modules/electron/dist/electron.exe')
      : path.join(root, 'node_modules/electron/dist/electron');
const packagedApp = path.join(
  root,
  'release/mac-arm64/Perovskite Lab.app/Contents/MacOS/Perovskite Lab',
);
const usePackaged = process.env.APP_PATH ? true : process.env.SMOKE_PACKAGED === '1';
const executablePath = process.env.APP_PATH ?? (usePackaged ? packagedApp : localElectron);
const appArgs = usePackaged ? [] : [root];

if (!(await exists(path.join(root, 'dist-electron/main.cjs')))) {
  console.error('✗ 缺少 dist-electron/main.cjs，请先执行 npm run build:app');
  process.exit(1);
}
if (usePackaged && !(await exists(executablePath))) {
  console.error(`✗ 找不到安装包：${executablePath}`);
  process.exit(1);
}
const userDataDir = path.join(os.tmpdir(), 'perovskite-lab-desktop-smoke');
const importUserDataDir = `${userDataDir}-import`;

const projectA = path.join(os.tmpdir(), 'plab-smoke-A.plab');
const projectB = path.join(os.tmpdir(), 'plab-smoke-B.plab');
const projectBroken = path.join(os.tmpdir(), 'plab-smoke-broken.plab');
const titleA = `plab-smoke-A.plab — Perovskite Lab v`;
const titleB = `plab-smoke-B.plab — Perovskite Lab v`;

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
};

const until = async (check, label, timeout = 20000) => {
  const started = Date.now();
  for (;;) {
    if (await check()) return true;
    if (Date.now() - started > timeout) {
      fail(`超时：${label}`);
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
};

/** 读主进程窗口标题（page.title() 只会返回渲染进程的 document.title）。 */
const windowTitle = (application) =>
  application.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? '',
  );

const projectOf = async (file) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
};

await Promise.all(
  [projectA, projectB, projectBroken, userDataDir, importUserDataDir].map((target) =>
    rm(target, { force: true, recursive: true }),
  ),
);
await writeFile(projectBroken, '这不是项目文件', 'utf8');

const app = await electron.launch({
  executablePath,
  args: [...appArgs, `--user-data-dir=${userDataDir}`],
});
try {
  const win = await app.firstWindow({ timeout: 30000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 30000 });

  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  const title = await windowTitle(app);
  const origin = await win.evaluate(() => location.origin);
  if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT, fullPage: false });
  const font = await win.evaluate(async () => {
    const response = await fetch('./fonts/PerovskiteLabSong-Regular-2026.11.3.woff');
    return { ok: response.ok, bytes: (await response.arrayBuffer()).byteLength };
  });
  const relay = await win.evaluate(async () => {
    const response = await fetch('/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: '******' },
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
  if (
    (relay.status !== 400 && relay.status !== 401) ||
    (!relay.body.includes('模型') && !relay.body.includes('API Key'))
  )
    fail(`AI 中继异常：${relay.status} ${relay.body.slice(0, 120)}`);

  const bridged = await win.evaluate(() => window.desktopProject?.isDesktop === true);
  if (!bridged) fail('preload 未注入 window.desktopProject');

  // 把系统对话框换成可控桩：保存 / 打开 / 未保存修改提醒。
  await app.evaluate(({ dialog }) => {
    globalThis.__plabSavePath = null;
    globalThis.__plabOpenPath = null;
    globalThis.__plabBoxResponse = 1;
    dialog.showSaveDialog = async () => ({
      canceled: !globalThis.__plabSavePath,
      filePath: globalThis.__plabSavePath ?? undefined,
    });
    dialog.showOpenDialog = async () => ({
      canceled: !globalThis.__plabOpenPath,
      filePaths: globalThis.__plabOpenPath ? [globalThis.__plabOpenPath] : [],
    });
    dialog.showMessageBox = async () => ({ response: globalThis.__plabBoxResponse, checkboxChecked: false });
  });
  const setDialog = (key, value) =>
    app.evaluate((_, payload) => {
      globalThis[payload.key] = payload.value;
    }, { key, value });
  const sendCommand = (type) =>
    app.evaluate(({ BrowserWindow }, command) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('project:command', { type: command });
    }, type);

  // —— 项目 A：录入数据并保存到真实文件 ——
  await win.getByRole('link', { name: '浓度梯度', exact: true }).click();
  const stock = win.getByLabel('母液浓度', { exact: true });
  await stock.fill('111');
  await until(async () => (await windowTitle(app)).startsWith('*'), '未保存标记 *');
  await setDialog('__plabSavePath', projectA);
  await sendCommand('save');
  await until(
    async () => (await windowTitle(app)) === `${titleA}${version}`,
    '保存后标题显示 A.plab',
  );
  const savedA = await projectOf(projectA);
  console.log(`  保存 A   ${savedA?.format ?? 'FAILED'} · stock=${savedA?.workspace?.gradient?.stock}`);
  if (savedA?.format !== 'perovskite-lab-project') fail('A.plab 不是项目文件格式');
  if (savedA?.workspace?.gradient?.stock !== '111') fail('A.plab 没有写入当前工作区数据');
  if ((await windowTitle(app)).includes('*')) fail('保存后标题仍带未保存标记');

  // —— 另存为 B：A 与 B 互相独立 ——
  await stock.fill('222');
  await setDialog('__plabSavePath', projectB);
  await sendCommand('save-as');
  await until(
    async () => (await windowTitle(app)) === `${titleB}${version}`,
    '另存为后标题显示 B.plab',
  );
  const savedB = await projectOf(projectB);
  if (savedB?.workspace?.gradient?.stock !== '222') fail('B.plab 没有写入另存为时的数据');
  if ((await projectOf(projectA))?.workspace?.gradient?.stock !== '111') fail('另存为覆盖了 A.plab');

  // —— Ctrl+S 保存到当前文件 B ——
  await stock.fill('333');
  await sendCommand('save');
  await until(async () => (await projectOf(projectB))?.workspace?.gradient?.stock === '333', 'B.plab 更新为 333');
  if ((await projectOf(projectA))?.workspace?.gradient?.stock !== '111') fail('保存 B 时改动了 A.plab');

  // —— 有未保存修改时打开 A：取消 / 不保存 ——
  await stock.fill('444');
  await until(async () => (await windowTitle(app)).startsWith('*'), '修改 B 后出现未保存标记');
  await setDialog('__plabOpenPath', projectA);
  await setDialog('__plabBoxResponse', 2); // 取消
  await sendCommand('open');
  await new Promise((resolve) => setTimeout(resolve, 800));
  // 取消时仍停留在 B 并保留未保存标记。
  if ((await windowTitle(app)) !== `*${titleB}${version}`) fail('取消打开后项目路径被改变');
  if ((await stock.inputValue()) !== '444') fail('取消打开后工作区被改写');

  await setDialog('__plabBoxResponse', 1); // 不保存
  await sendCommand('open');
  await until(
    async () => (await windowTitle(app)) === `${titleA}${version}`,
    '打开 A.plab',
  );
  await until(async () => (await stock.inputValue()) === '111', '打开 A 后加载 A 的实际内容');
  if ((await projectOf(projectB))?.workspace?.gradient?.stock !== '333') fail('打开 A 时覆盖了 B.plab');

  // —— 损坏的项目文件：保持当前项目不变 ——
  await setDialog('__plabOpenPath', projectBroken);
  await sendCommand('open');
  await until(
    async () =>
      (await win.locator('.toast').textContent().catch(() => ''))?.includes('打开失败') === true,
    '损坏文件提示',
  );
  if ((await windowTitle(app)) !== `${titleA}${version}`) fail('打开损坏文件后项目路径被改变');
  if ((await stock.inputValue()) !== '111') fail('打开损坏文件后工作区被覆盖');

  console.log(`  项目 A/B  ${savedA?.workspace?.gradient?.stock} / ${savedB?.workspace?.gradient?.stock}`);
} finally {
  await app.close();
}

// —— 双击 .plab 启动：命令行带文件，页面就绪后主进程推送 loaded 指令 ——
const appWithFile = await electron.launch({
  executablePath,
  args: [...appArgs, `--user-data-dir=${importUserDataDir}`, projectA],
});
try {
  const win2 = await appWithFile.firstWindow({ timeout: 30000 });
  win2.on('dialog', (dialog) => void dialog.accept());
  await win2.waitForLoadState('domcontentloaded');
  await win2.waitForSelector('#root > *', { timeout: 30000 });
  await win2.getByRole('link', { name: '浓度梯度', exact: true }).click();
  const loaded = await win2.getByLabel('母液浓度', { exact: true }).inputValue();
  const startupTitle = await windowTitle(appWithFile);
  console.log(`  双击打开 ${startupTitle} · stock=${loaded}`);
  if (loaded !== '111') fail('双击 .plab 启动后没有加载 A.plab 的内容');
  if (!startupTitle.startsWith('plab-smoke-A.plab'))
    fail(`双击启动的窗口标题异常：${startupTitle}`);
} finally {
  await appWithFile.close();
}

// —— 关闭后再打开：双击 B.plab 必须显示 B，而不是上次的 A ——
const appWithB = await electron.launch({
  executablePath,
  args: [...appArgs, `--user-data-dir=${importUserDataDir}`, projectB],
});
try {
  const win3 = await appWithB.firstWindow({ timeout: 30000 });
  win3.on('dialog', (dialog) => void dialog.accept());
  await win3.waitForLoadState('domcontentloaded');
  await win3.waitForSelector('#root > *', { timeout: 30000 });
  await win3.getByRole('link', { name: '浓度梯度', exact: true }).click();
  const loaded = await win3.getByLabel('母液浓度', { exact: true }).inputValue();
  console.log(`  双击 B   ${await windowTitle(appWithB)} · stock=${loaded}`);
  if (loaded !== '333') fail('双击 B.plab 后显示的不是 B 的数据（可能是上次自动恢复的工作区）');
} finally {
  await appWithB.close();
}

if (!process.exitCode) console.log('✓ 桌面端冒烟测试通过');
