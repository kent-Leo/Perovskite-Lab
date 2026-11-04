const { execFileSync } = require('node:child_process');
const path = require('node:path');

/**
 * 未配置签名证书时，为 arm64 产物补一次 ad-hoc 签名。
 * Apple Silicon 要求所有可执行页有签名，否则会直接 Killed: 9。
 * 拿到 Developer ID 后配置 CSC_LINK / CSC_NAME 即可自动跳过此步。
 */
module.exports = async function afterPack(context) {
  if (process.platform !== 'darwin') return;
  if (context.electronPlatformName !== 'darwin') return;
  const hasIdentity = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
  if (hasIdentity) return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // 打包过程可能留下 Finder 信息等扩展属性，codesign 会直接报错
  // “resource fork, Finder information, or similar detritus not allowed”。
  // Spotlight/Finder 有时会在清理后立刻写回，所以这里重试几次。
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const last = attempt === 3;
    execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' });
    try {
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: last ? 'inherit' : 'pipe' });
      console.log(`  • ad-hoc signed ${path.basename(appPath)}`);
      return;
    } catch (error) {
      if (last) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};
