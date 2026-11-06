# v1.2.0：分组柱状图、重复测量统计与科研导出

对象筛选原先只能绘制单系列。现在每个 Sheet 可切换为分组柱状图，对比多个探针 / 实验条件的 Mean，并添加 SD、SEM 或手动误差棒。

- 分组数据独立保存，保留原始重复测量和用户输入统计值；空值不变成 0，SD 使用 n−1，n < 2 时不生成自动误差。
- 复用 Worksheet、撤销重做、工作簿及 ChartPanel；支持动态系列、区域粘贴、CSV / XLSX 导入为新 Sheet。
- SVG / PDF 保留矢量柱体、连续渐变和误差棒；PNG 支持 300 / 600 dpi，Excel 独立导出原始值、统计与误差。
- 应用版本更新为 1.2.0；Workspace.version 和 .plab 格式版本仍为 1，旧项目默认单系列。

验证：377 项单元测试、145 项浏览器测试、新增测试严格类型检查、`npm run build`、`npm run build:app`、`npm run test:desktop` 全部通过。macOS 实测 .plab 保存 / 关闭重开、A/B 项目缓存隔离及 v1.1.0 格式兼容；PDF 实际渲染、SVG / PNG 像素和 Excel 空值检查通过。

保留草稿状态，待补 Windows 原生运行与 .plab 重开验收；本 PR 不包含安装包制作、签名或生产部署。现有 Vite 大分包提示保留。

[使用说明与更新日志](https://github.com/kent-Leo/Perovskite-Lab/blob/feature/v1.2.0-grouped-bar/docs/分组柱状图-v1.2.0-2026.11.6.md) · [验收记录、修改文件清单与截图](https://github.com/kent-Leo/Perovskite-Lab/blob/feature/v1.2.0-grouped-bar/docs/验收记录-v1.2.0-2026.11.6.md)
