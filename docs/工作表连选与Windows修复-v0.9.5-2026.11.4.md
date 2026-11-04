# 工作表连选与 Windows 修复（v0.9.5）

日期：2026-11-04　分支：`feature/v0.9.5`　基础版本：v0.9.4

本轮处理四件事：Windows 打开项目空白、Windows 安装/卸载报错、拖拽越过表格边缘继续选中、Excel 式整行整列快速选中。

## 1. Windows 打开项目后空白

**现象**：Windows 上双击 `.plab`（或启动时带项目文件）后应用打开，但工作区是空的。

**根因**：主进程在 `did-finish-load` 时把 `{ type: 'loaded' }` 推给渲染进程，而 React 的 `useEffect` 里才调用 `setCommandHandler`。两者存在竞态——指令先到就会被 `handler?.(command)` 静默丢弃。macOS 上因为点菜单「打开项目」走的是 IPC 返回值，不经过这条通道，所以没有暴露。

**修复**：`electron/preload-2026.11.4.ts` 改为先入队再补发。

```ts
ipcRenderer.on('project:command', (_event, command) => {
  if (handler) { handler(command); return; }
  pending.push(command);            // 渲染进程还没挂好监听
  if (pending.length > 8) pending.shift();
});
setCommandHandler(callback) {
  handler = callback;
  while (pending.length) callback(pending.shift()!);   // 注册后按序补发
}
```

**验证**：`npm run test:desktop` 新增「命令行带项目文件启动」用例，断言启动后工作区确实载入（6 条光谱）。

## 2. Windows 安装 / 卸载时报 NSIS 错误

**现象**：`Installer integrity check has failed. Common causes include incomplete download and damaged media.`

这个报错来自 NSIS 对安装包数据块的 CRC 校验，含义只有一句：**手上的 exe 和构建出来的 exe 不一致**。

**两个可能来源，都已处理**：

| 来源 | 处理 |
| --- | --- |
| 文件在传输中损坏（微信 / 网盘 / 下载中断） | 新增 `release/SHA256SUMS.txt`，提供校验和供核对 |
| 打包目录复用导致安装包与内嵌卸载器不一致 | 新增 `npm run clean:win`，`dist:win` 每次先删除 `win-unpacked`、旧 setup、`.blockmap` 与 `__uninstaller.exe`；同时设置 `nsis.differentialPackage: false`（差分打包依赖 blockmap，混用旧产物时最容易对不上） |

**校验方法**

```bash
# macOS
shasum -a 256 PerovskiteLab-0.9.4-x64-setup.exe
# Windows
certutil -hashfile PerovskiteLab-0.9.4-x64-setup.exe SHA256
```

与 `release/SHA256SUMS.txt` 比对，一致说明文件完整。

**注意**：未签名的安装包在部分机器上还会弹「Windows 已保护你的电脑」，那是 SmartScreen 的发布者信誉提示，与完整性校验是两回事，需要代码签名证书才能消除。

## 3. 拖拽越过表格边缘继续选中

原来只在指针落在表格内时延伸选区，拖出边界就停住。现在把命中点夹到数据区域最近的边缘：

```ts
const rect = surface.getBoundingClientRect();
const x = Math.min(Math.max(e.clientX, rect.left + 2), rect.right - 18);
const y = Math.min(Math.max(e.clientY, rect.top + 2), rect.bottom - 18);
```

- 向右拖出边界 → 选区一路延伸到末列
- 向下拖出边界 → 延伸到末行
- 斜向拖出 → 延伸到右下角
- 18px 内缩用于避开滚动条本体

## 4. Excel 式快速选中

| 操作 | 效果 |
| --- | --- |
| 单击列标 | 选中整列 |
| 单击行号 | 选中整行 |
| 单击左上角 ▦ | 选中整张表 |
| `Shift` + 单击列标 / 行号 | 从锚点连选多列 / 多行 |
| 按住列标 / 行号拖动 | 连续多选，实时跟随指针 |
| 选区覆盖整列 / 整行 | 对应表头高亮（`th.is-selected`） |

实现要点：

- 列标再选逻辑抽成纯函数 `columnSelection()` / `rowSelection()`（`src/domain/worksheet-v0.2.0-2026.10.19.ts`），便于单测。
- 表头拖动用 window 级 `pointermove` + `elementFromPoint`，由 `data-col` / `data-row` 定位。
- 行号在「可拖动排序」的工作表里仍是原生 DnD 把手，那种表只保留单击与 Shift 连选。

## 验证

| 项目 | 结果 |
| --- | --- |
| `npm test` | 27 个文件、309 个用例通过（新增 6 个选区用例） |
| 越界拖拽 | `A1` 拖到表格外右下 → 选区 `A1:C6`（末行末列） |
| Shift 连选列 | 点 A 列 → `A1:A6`；Shift 点 C 列 → `A1:C6` |
| 行号拖拽 | 1 → 3 → `A1:C3` |
| `npm run test:desktop` | 源 / 字体 / 中继 / 保存打开 / 双击打开 全部通过 |

## 产物

版本号已同步升级到 **0.9.5**（`APP_VERSION`、`package.json`、两个 HTML 标题、`打开前端-v0.9.5-2026.11.4.command`、README 与浏览器测试中的版本断言）。

| 文件 | 大小 | SHA-256 前缀 |
| --- | ---: | --- |
| `PerovskiteLab-0.9.5-arm64.dmg` | 150 MB | `c59fcb92` |
| `PerovskiteLab-0.9.5-arm64.zip` | 146 MB | `e6b694c1` |
| `PerovskiteLab-0.9.5-x64-setup.exe` | 136 MB | `80f447a9` |

完整哈希见 `release/SHA256SUMS.txt`。旧的 0.9.4 安装包已删除，请一律使用 0.9.5。

## 附：ad-hoc 签名在 iCloud 目录下失败

打包目录位于 `~/Documents` 时，iCloud / FileProvider 会持续往 `.app` 写入 `com.apple.FinderInfo`、`com.apple.fileprovider.fpfs#P`，`codesign` 会报 `resource fork, Finder information, or similar detritus not allowed`，重试也无效（属性会立刻写回）。

现在 `electron/after-pack-2026.11.4.cjs` 的做法是：把 `.app` 复制到系统临时目录 → `xattr -cr` → `codesign --sign -` → 移回 `release/`。临时目录不受 iCloud 同步，签名稳定成功。
