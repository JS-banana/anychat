# AnyChat (Primary Development - Tauri)

这是 AnyChat 的主分支，采用 Tauri 架构，旨在提供高性能、低占用的多 AI 聊天聚合体验。

> 迁移说明
>
> `2026-03-21` 起，原 `electron` 主线已经拆分为独立项目 **AmberKeeper**：`https://github.com/JS-banana/amberkeeper`。本仓库不再承载 Electron 主线的新功能开发。

## 分支说明

- **main**: 稳定分支，用于保存当前主线代码。
- **dev**: 开发分支，用于日常集成与迭代。

## 当前开发重点

1. **多 Webview 聚合体验**: 优化服务切换、窗口管理和快捷键。
2. **核心能力维护**: 持续整理 Tauri 主线能力与交互体验。
3. **性能优化**: 保持极低的内存占用和安装包体积。

## 关键文件

- `src/App.tsx`: 前端入口与路由逻辑
- `src/stores/app-store.ts`: 全局状态管理
- `src/components/SettingsPage.tsx`: 设置页与关于页入口
- `src/components/WebViewContainer.tsx`: 核心 WebView 容器
- `src-tauri/src/lib.rs`: Rust 后端核心

## 相关文档

- [技术路线图](.sisyphus/plans/)
- [Gemini 研究报告](docs/research/2026-01-20 研究报告gemini.md)
- [任务跟踪记录](docs/plans/2026-01-28-anychat-triage.md)
- [遗留捕获链路清理计划](docs/plans/2026-03-24-remove-legacy-capture-plumbing.md)

---

_详细信息请参阅文档索引中的具体文档_
