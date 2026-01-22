<p align="center">
  <img src="https://raw.githubusercontent.com/tw93/Pake/master/screenshot/logo.png" width="80" height="80" alt="AnyChat Logo">
</p>

<h1 align="center">AnyChat</h1>

<p align="center">
  <strong>基于 Tauri 2.0 的多 AI Chat 聚合桌面客户端</strong>
</p>

<p align="center">
  <a href="https://github.com/tauri-apps/tauri"><img src="https://img.shields.io/badge/Tauri-2.0-blue?logo=tauri" alt="Tauri 2.0"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-blue?logo=react" alt="React 19"></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-1.70+-orange?logo=rust" alt="Rust 1.70+"></a>
  <img src="https://img.shields.io/badge/Platform-macOS-lightgrey?logo=apple" alt="Platform macOS">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License MIT">
</p>

AnyChat 是一个聚合了多个 AI 聊天服务的桌面应用，旨在提供统一的入口和本地化数据存储。它不仅让你能在一个窗口中无缝切换不同的 AI，还能将你的聊天记录自动备份到本地 SQLite 数据库，实现数据的完全可控。

## ✨ 核心特性

- **🚀 多服务聚合**: 统一管理 ChatGPT, Gemini, Claude 等 12+ 种主流 AI 服务。
- **⌨️ 效率优先**: 支持快捷键快速切换服务，极简的 UI 设计。
- **💾 本地存储**: 所有聊天记录持久化至本地 SQLite，支持全文搜索。
- **📤 导入导出**: 支持 ChatGPT 官方数据导入，以及全量数据导出。
- **🔒 私有可控**: 数据不出本地，隐私第一。

## 🌿 分支策略

本项目采用多方案并行的策略进行核心功能（数据捕获）的研发：

- **`main`**: 稳定生产分支，包含已验证的 UI 和核心管理逻辑。
- **`tauri`**: Tauri 方案开发分支，专注于通过 MITM 代理绕过 CSP 限制实现数据捕获。
- **`electron`**: Electron 方案探索分支，利用成熟的 Webview API 作为 Tauri 的后备方案。

## 🛠️ 技术栈

- **框架**: Tauri 2.0, React 19, TypeScript
- **样式**: Tailwind CSS, shadcn/ui
- **存储**: SQLite (@tauri-apps/plugin-sql)
- **状态**: Zustand

## 🏁 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发环境
pnpm tauri dev

# 构建生产版本
pnpm tauri build
```

---

_详细信息请参阅 [AGENTS.md](./AGENTS.md) 或 [文档索引](./docs/README.md)_
