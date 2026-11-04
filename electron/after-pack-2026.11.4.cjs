const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * 未配置签名证书时，为 macOS 产物补一次 ad-hoc 签名。
 * Apple Silicon 要求所有可执行页有签名，否则会直接 Killed: 9。
 * 拿到 Developer ID 后配置 CSC_LINK / CSC_NAME 即可自动跳过此步。
 *
 * 项目放在 ~/Documents 时，iCloud / FileProvider 会不断往 bundle 上写
 * com.apple.FinderInfo、com.apple.fileprovider.fpfs#P 等扩展属性，而
 * codesign 遇到这些属性会直接报
 * “resource fork, Finder information, or similar detritus not allowed”。
 * 所以先复制到系统临时目录（不受 iCloud 同步）完成签名，再放回原位。
 */
module.exports = async function afterPack(context) {
  if (process.platform !== 'darwin') return;
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const name = path.basename(appPath);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'perovskite-sign-'));
  const staged = path.join(stage, name);

  try {
    fs.cpSync(appPath, staged, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    execFileSync('xattr', ['-cr', staged], { stdio: 'inherit' });
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', staged], { stdio: 'inherit' });
    fs.rmSync(appPath, { recursive: true, force: true });
    try {
      fs.renameSync(staged, appPath);
    } catch {
      // 临时目录与项目不在同一卷时退回复制
      fs.cpSync(staged, appPath, {
        recursive: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
    }
    console.log(`  • ad-hoc signed ${name}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
};
