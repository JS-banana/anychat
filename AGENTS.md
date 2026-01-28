# AnyChat (Primary Development - Tauri)

这是 AnyChat 的主分支，采用 Tauri 架构，旨在提供高性能、低占用的多 AI 聊天聚合体验。

## 分支说明

- **main**: 稳定/主开发分支。目前专注基于 Tauri 的聚合体验与核心功能维护。
- **tauri**: 技术攻关分支。专注通过 MITM 代理攻克数据捕获（CSP 绕过）难题。
- **electron**: 备选分支。存放 Electron 方案的研究报告和实验性代码，作为 Plan B 待命。

## 当前开发重点

1. **多 Webview 聚合体验**: 优化服务切换、窗口管理和快捷键。
2. **数据沉淀架构**: 维护本地 SQLite 数据库，整合各分支的研究成果。
3. **性能优化**: 保持极低的内存占用和安装包体积。

## 关键文件

- `src/App.tsx`: 前端入口与路由逻辑
- `src/stores/app-store.ts`: 全局状态管理
- `src/components/WebViewContainer.tsx`: 核心 WebView 容器
- `src-tauri/src/lib.rs`: Rust 后端核心
- `src/services/database.ts`: 本地 SQLite 服务

## 相关文档

- [技术路线图](.sisyphus/plans/)
- [数据捕获方案调研报告](docs/research/data-capture-implementation-report.md)
- [Gemini 研究报告](docs/research/2026-01-20 研究报告gemini.md)
- [任务跟踪记录](docs/plans/2026-01-28-anychat-triage.md)

---
_详细信息请参阅文档索引中的具体文档_
