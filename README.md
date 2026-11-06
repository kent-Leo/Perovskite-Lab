# Perovskite-Lab｜路臻

**比 Origin 更快、更简单的钙钛矿荧光传感科研工具站**

专为钙钛矿量子点、比率荧光探针、重金属废水检测开发。不用安装，浏览器打开即用，上手零门槛。

🔗 **在线使用：[lab.luzen.org](https://lab.luzen.org)** · 无广告 · 开源免费 · 离线可用

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Web%20%2F%20macOS%20%2F%20Windows-brightgreen)
![Data](https://img.shields.io/badge/Data-本地存储%20·%20不上传-blue)

---

## 为什么做它

做钙钛矿荧光传感的你，是否总被 Origin 繁琐操作拖累？
导入数据、调图层、反复拟合、保存工程，耗费大量时间。

Perovskite-Lab 把这个方向的标准流程内置好了：**Origin 半小时的重复工作，在这里十几秒搞定。**

## ✨ 核心功能

- 📈 **光谱处理**：PL / UV-Vis 光谱导入与处理，快速出图
- 📉 **Stern-Volmer 拟合**：猝灭数据一键拟合，猝灭率支持直接录入
- 🔬 **比率探针分析**：比率荧光探针的数据处理与分析
- 🎯 **离子筛选与校准**：离子筛选图、线性校准曲线绘制，检测离子种类可自定义
- 📊 **分组柱状图**：多探针 / 多条件宽表，重复测量 Mean、样本 SD、SEM 与手动误差；每个 Sheet 独立保存，支持 SVG、PNG、PDF 和原始数据 Excel 导出
- ⚗️ **实验计算**：前驱体摩尔浓度计算、母液稀释计算器、试剂称量
- 📋 **多工作表管理**：分组管理多组实验数据，本地持久保存；桌面端可存为 `.plab` 项目文件
- 🔒 **隐私安全**：所有数据保存在浏览器本地，不上传服务器

## 🖥️ 桌面端（macOS / Windows）

也能装成本地 App，双击即用，不再依赖浏览器标签页。桌面端沿用同一套前端，工作区与数据仍保存在本机，支持 `.plab` 项目文件（`⌘S` / `⌘O`，或双击文件打开），旧的工作区备份 JSON 也能直接打开。

```bash
npm run app:dev      # 本地启动桌面端
npm run dist:mac     # 打包 dmg / zip（当前架构）
npm run dist:win     # 打包 Windows 安装包（x64）
npm run test:desktop # 使用当前 Electron 构建做项目文件冒烟测试
```

## 📌 适合谁

钙钛矿量子点、荧光探针、环境重金属检测方向的硕博研究生与科研人员。

## English

**Perovskite-Lab** is a free, browser-based toolkit for perovskite quantum-dot fluorescence sensing — faster and simpler than Origin for routine lab work.

- Spectrum processing (PL / UV-Vis) and publication-ready plots
- Stern–Volmer quenching fits and ratiometric probe analysis
- Ion screening charts and linear calibration curves (customizable target ions)
- Grouped bars with replicates, sample SD / SEM, editable vector exports and Excel data
- Precursor concentration and stock-solution dilution calculators
- Multi-sheet experiment data management — everything stored locally, nothing uploaded

No installation, no sign-up. Try it live: **https://lab.luzen.org**

*Keywords: perovskite quantum dots, fluorescence sensing, Stern-Volmer, ratiometric probe, heavy metal detection, spectroscopy*

## ⭐ 支持与反馈

如果它帮你省下了在 Origin 里重复劳动的时间，给个 **Star** 是最好的鼓励，也能让更多同行找到它。
使用问题或功能建议，欢迎提 [Issue](../../issues)。

## 📝 开发与更新记录

当前本地开发版本：**v1.2.0**，分支 `feature/v1.2.0-grouped-bar`。线上版本以实际部署为准。

- [v1.2.0 分组柱状图使用说明与更新日志（2026.11.6）](docs/分组柱状图-v1.2.0-2026.11.6.md)
- [v1.1.0 项目文件与表格结构操作（2026.11.5）](docs/项目文件与表格结构操作-2026.11.5.md)
- [v1.0.0 工作表交互与中西文字体（2026.11.5）](docs/工作表交互与中西文字体-2026.11.5.md)
- [v0.9.5 工作表连选与 Windows 修复（2026.11.4）](docs/工作表连选与Windows修复-v0.9.5-2026.11.4.md)
- [v0.9.4 坐标轴刻度间隔（2026.11.4）](docs/坐标轴刻度间隔-v0.9.4-2026.11.4.md)
- [桌面端 Electron 打包（2026.11.4）](docs/桌面端Electron打包-v0.9.4-2026.11.4.md)
- [v0.9.3 修改与验证记录（2026.11.3）](docs/绘图校验与宋体-v0.9.3-2026.11.3.md)
- [v0.9.3 默认四边轴与衬线字体（2026.11.3）](docs/四边轴与衬线字体-v0.9.3-2026.11.3.md)
- [v0.9.2 图表样式与验证说明（2026.10.29）](docs/多探针图表优化-v0.9.2-2026.10.29.md)
- [猝灭率直接录入说明（2026.10.28）](docs/多探针猝灭率直接录入-2026.10.28.md)

## 📜 许可证

本项目基于 [AGPL-3.0](LICENSE) 开源：可免费使用与修改；若将修改版以网络服务形式对外提供，须同样开源。如需闭源商业使用，请通过 Issue 联系获取商业授权。
