import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 生成 release/SHA256SUMS.txt。
 * Windows 的 "Installer integrity check has failed" 多是文件在传输中损坏，
 * 让用户用 `shasum -a 256`（macOS）或 `certutil -hashfile` 核对即可判断。
 */
const dir = path.join(process.cwd(), 'release');
const names = (await readdir(dir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(dmg|zip|exe)$/i.test(entry.name))
  .map((entry) => entry.name)
  .sort();

const lines = [];
for (const name of names) {
  const hash = createHash('sha256')
    .update(await readFile(path.join(dir, name)))
    .digest('hex');
  lines.push(`${hash}  ${name}`);
}

if (!lines.length) {
  console.log('release/ 下没有可校验的安装包');
} else {
  await writeFile(path.join(dir, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8');
  console.log(lines.join('\n'));
}
