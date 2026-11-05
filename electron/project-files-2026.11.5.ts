import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * 项目文件（.plab）的平台无关工具：文件名、窗口标题、原子写入。
 * 这里刻意不引用 electron，方便单元测试直接导入。
 */
export const PROJECT_EXTENSION = 'plab';

export const PROJECT_FILTERS = [
  { name: 'Perovskite Lab 项目', extensions: [PROJECT_EXTENSION] },
  { name: '工作区备份 JSON', extensions: ['json'] },
];

/** 默认文件名：日期严格使用 `YYYY.M.D`（不补零），例如 `Perovskite Lab 2026.11.5.plab`。 */
export function defaultProjectFileName(date = new Date()): string {
  return `Perovskite Lab ${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}.${PROJECT_EXTENSION}`;
}

/** 补全扩展名；用户显式输入的 .plab / .json 保持不变。 */
export function ensureProjectExtension(filePath: string): string {
  return /\.(plab|json)$/i.test(filePath) ? filePath : `${filePath}.${PROJECT_EXTENSION}`;
}

export function projectDisplayName(filePath: string | null | undefined): string {
  return filePath ? path.basename(filePath) : '未命名项目';
}

/** 窗口标题：未保存修改以 `*` 前缀标记，始终包含应用名与版本。 */
export function windowTitle(
  filePath: string | null | undefined,
  dirty: boolean,
  version: string,
): string {
  return `${dirty ? '*' : ''}${projectDisplayName(filePath)} — Perovskite Lab v${version}`;
}

/**
 * 安全写入：先在同一目录写临时文件并 fsync，再用 rename 原子替换目标文件。
 * 写入中断时最多留下一个临时文件，原项目文件不会被截断或半写。
 */
export async function writeFileAtomic(target: string, content: string): Promise<void> {
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const temp = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${Date.now().toString(36)}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temp, 'wx');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temp, target);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/** 读取项目文件；失败时抛出中文原因，调用方据此保持当前项目不变。 */
export async function readProjectFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error('项目文件不存在');
    if (code === 'EACCES' || code === 'EPERM') throw new Error('没有读取该文件的权限');
    throw new Error((error as Error).message);
  }
}
