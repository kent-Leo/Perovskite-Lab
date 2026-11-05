# 桌面端打包（Electron · macOS + Windows）

日期：2026-11-04　版本：v0.9.4

## 1. 目标

把现有 Vite/React 前端原样装进 macOS / Windows 桌面应用，**不改动 `src/` 里任何业务代码**。

## 2. 架构

```
Perovskite Lab.app
└── Electron 主进程 (dist-electron/main.cjs)
    ├── 自定义协议 app://local  ──→ 读取 dist/ 静态文件（index.html / worksheet / fonts / assets）
    └── app://local/api/*       ──→ handleAiRequest()（复用 server/ai-handler-2026.10.24.ts）
```

**为什么用 `app://local` 而不是本地 HTTP 端口**

- 端口一旦变化，`localStorage` 的 origin 就变了，用户的工作区（`perovskite-lab-workspace-v1`）和 AI 密钥（`perovskite-lab-ai-credentials-v1`）会全部丢失；固定源可以跨版本保留。
- 前端所有请求都是相对路径（`/api/ai/*`、`${BASE_URL}fonts/*`），自定义协议天然同源，无需配置 CORS。
- `file://` 方案不可用：`fetch` 在 file 协议下会被拒绝，导出字体与 AI 请求都会失败。

**AI 中继**：`server/vite-ai-2026.10.24.ts` 里的中间件逻辑不需要了，主进程直接把 `app://local/api/*` 的请求体转成标准 `Request` 交给 `handleAiRequest`。中继里的同源守卫通过把 `Origin` 归一到固定基址来保持不变；`Sec-Fetch-Site` 由主进程移除（渲染进程是唯一调用方）。

## 3. 新增文件

| 文件 | 作用 |
| --- | --- |
| `electron/main-2026.11.4.ts` | 主进程：协议注册、静态资源、AI 中继、窗口与菜单、下载落盘 |
| `electron/after-pack-2026.11.4.cjs` | 打包后对 `.app` 做 ad-hoc 签名（Apple Silicon 必需） |
| `electron-builder.yml` | 打包配置（appId / 产物名 / dmg 布局） |
| `dist-electron/main.cjs` | esbuild 产出的主进程 bundle（构建生成，勿手改） |

`package.json` 新增：

```json
"main": "dist-electron/main.cjs",
"build:main": "esbuild electron/main-2026.11.4.ts --bundle ... --outfile=dist-electron/main.cjs",
"build:app": "npm run build && npm run build:main",
"app:dev": "npm run build:app && electron ."
```

## 4. 常用命令

```bash
# 本地起桌面端（先构建再启动）
npm run app:dev

# 分别打包
npm run dist:mac   # dmg + zip
npm run dist:win   # NSIS 安装包（x64）
npm run dist       # 两个平台一起出

# 清理桌面端产物
npm run clean:app
```

Windows 安装包可以在 macOS 上交叉构建，不需要 Wine，也不需要 Windows 机器。

安装依赖若被 pnpm 拦截构建脚本，需在 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 中保留 `electron`，然后手动执行一次：

```bash
cd node_modules/electron && ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node install.js
```

## 5. 产物

```
release/
├── PerovskiteLab-0.9.4-arm64.dmg          150 MB   双击安装
├── PerovskiteLab-0.9.4-arm64.zip          146 MB   用于自动更新
├── PerovskiteLab-0.9.4-x64-setup.exe      148 MB   Windows 安装向导
├── mac-arm64/Perovskite Lab.app
└── win-unpacked/Perovskite Lab.exe
```

- macOS 默认只出当前架构（本机为 `arm64`）；Windows 固定 `x64`（可在 `win.target.arch` 再加 `arm64`）。
- 两个平台的 `app.asar` 均为 48 MB，内容是 `dist/` + `dist-electron/` + `package.json`。
- 未配置图标时使用 Electron 默认图标，打包日志会出现 `default Electron icon is used` 警告，属正常。
- `electron-builder.yml` 里的 `'!node_modules/**/*'` 不可删除：主进程已被 esbuild 完整内联，带上 `node_modules` 只会让 asar 从 48 MB 涨到 108 MB。

## 6. 首次运行

**macOS**：本地构建的 `.app` 带 ad-hoc 签名、且没有网络下载隔离标记，双击即可运行。

通过微信 / 网盘 / 浏览器下载后会被打上 `com.apple.quarantine`，未公证的应用会提示「无法验证开发者」或「已损坏」，需要：

1. 右键 → 打开 → 再点「打开」；或
2. 终端执行 `xattr -dr com.apple.quarantine "/Applications/Perovskite Lab.app"`

**Windows**：未签名的安装包在少数机器上会触发 SmartScreen「Windows 已保护你的电脑」，点「更多信息 → 仍要运行」即可；360 等安全软件可能提示未知发布者，属未签名应用的正常表现。

要彻底消除这类提示，需要分别购买 Apple Developer 账号与 Windows 代码签名证书（见第 8 节）。

## 7. 桌面端与浏览器的行为差异

| 项目 | 说明 |
| --- | --- |
| 下载导出 | `a.download` 会弹原生「另存为」，默认目录为「下载」 |
| 刷新 / 开发者工具 | 菜单「视图」中保留（正式包也可用，便于排障） |
| 外链 | `will-navigate` 拦截，非 `app://local` 的链接交给系统浏览器 |
| 单实例 | 重复启动会聚焦已有窗口 |
| 项目文件 | 桌面端可用「文件」菜单或状态栏按钮存成 `.plab`，浏览器端隐藏该入口 |
| 数据位置 | macOS：`~/Library/Application Support/Perovskite Lab`；Windows：`%APPDATA%\Perovskite Lab` |

## 8. 项目文件（.plab）

桌面端支持把整个工作区存成一个可继续编辑的文件，而不是导出死数据。

**入口**

- 菜单「文件」：打开项目 `⌘/Ctrl+O`、保存项目 `⌘/Ctrl+S`、项目另存为 `⇧⌘/Ctrl+S`
- 工作区状态栏：`保存项目` / `打开项目` 两个按钮（浏览器端不渲染）
- Finder / 资源管理器双击 `.plab`（`electron-builder.yml` 的 `fileAssociations` 已注册）

**文件内容**

```json
{
  "format": "perovskite-lab-project",
  "version": 1,
  "appVersion": "0.9.4",
  "savedAt": "2026-11-04T12:00:00.000Z",
  "workspace": { "version": 1, "spectra": [], "objects": [], "…": "…" }
}
```

**兼容与边界**

- 旧的「下载数据备份」导出的 JSON 也能直接打开（会自动识别为备份格式）。
- 打开项目会替换当前工作区，替换前弹确认框；已落盘的文件不受影响。
- 文件里**不含** AI Key：密钥仍在 localStorage 的独立记录中，不会随项目文件外传。
- 打开/保存逻辑在 `src/services/desktop-project-2026.11.4.ts`（纯函数，可单元测试），
  文件读写与对话框在主进程 `registerProjectHandlers()`，渲染进程只通过 preload 的
  `window.desktopProject` 调用，拿不到任何 Node 能力。

## 9. 后续开启签名 + 公证

**macOS**：在 `electron-builder.yml` 删除 `mac.identity: null`，并提供以下环境变量即可自动完成签名、公证与 staple：

```
CSC_LINK                     # .p12 的 base64 或路径
CSC_KEY_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

`after-pack` 钩子检测到 `CSC_LINK` / `CSC_NAME` 时会自动跳过 ad-hoc 签名。

**Windows**：配置 `CSC_LINK` / `CSC_KEY_PASSWORD`（.pfx）或 Azure Trusted Signing 的环境变量，electron-builder 会自动签名 `Perovskite Lab.exe`、卸载器与安装包本身。

## 9.1 项目文件工作方式（v1.1.0）

项目文件的生命周期已在 `docs/项目文件与表格结构操作-2026.11.5.md` 中细化，这里只列与打包相关的结论：

- 路径只存在主进程，渲染进程通过受限的 `window.desktopProject` 读写；新增 `adopt` / `newProject` / `setDirty` / `confirmUnsaved` 与同步的 `initial` 启动状态。
- `.plab` 写入改为「临时文件 + rename」原子替换，写入中断不会损坏已有项目文件。
- `npm run test:desktop` 默认跑仓库里的 Electron + 最新 `dist/`（无需先打包），`APP_PATH=...` 或 `SMOKE_PACKAGED=1` 时才跑 `release/` 里的安装包。

## 10. 验收清单

- [ ] `npm run build:app` 无类型错误，`dist-electron/main.cjs` 与 `preload.cjs` 生成
- [ ] `npm run app:dev` 打开窗口，标题为 Perovskite Lab
- [ ] 存量 `localStorage` 在工作区面板正常载入（源为 `app://local`）
- [ ] 「AI 设置」填入 Key → 连接测试成功（`app://local/api/ai/test`）
- [ ] 导出 PNG / SVG / PDF / XLSX 各一次，均弹出保存对话框且文件可打开
- [ ] 图表中文字体渲染正常（导出字体走 `app://local/fonts/*`）
- [ ] `⌘S` 保存项目 → 关闭重开 → `⌘O` 打开，工作区完全一致
- [ ] 双击 `.plab` 能直接唤起应用并载入该项目
- [ ] 保存 A / 另存为 B 后，打开 A 显示 A、打开 B 显示 B，互不覆盖
- [ ] 有未保存修改时打开新项目，可选择保存 / 放弃 / 取消，取消后路径与数据不变
- [ ] 损坏的 `.plab` 只提示错误，不改变当前项目
- [ ] 窗口标题显示项目名，未保存时带 `*`
- [ ] `npm run test:desktop` 冒烟测试通过
- [ ] `npm run dist:mac` 生成 dmg，拖入 Applications 后可启动
- [ ] `npm run dist:win` 生成 exe，在 Windows 上安装后可启动（macOS 上无法自测）
