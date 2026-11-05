import { APP_VERSION } from '../../src/version-v0.9.0-2026.10.27';

/**
 * 导出文件名里的版本片段（点号已转义，可直接拼进 RegExp）。
 * 版本号升到 v1.0.0 后，各 spec 不再写死 0.9.5。
 */
export const versionTag = `v${APP_VERSION.replace(/\./g, '\\.')}`;
