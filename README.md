<p align="center">
  <img src="https://raw.githubusercontent.com/js-banana/anychat/main/logo.png" width="80" height="80" alt="AnyChat Logo">
</p>

<h1 align="center">AnyChat</h1>

<p align="center">
  <strong>多 AI Chat 聚合桌面客户端</strong>
</p>

<p align="center">
  <a href="https://github.com/tauri-apps/tauri"><img src="https://img.shields.io/badge/Tauri-2.0-blue?logo=tauri" alt="Tauri 2.0"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-blue?logo=react" alt="React 19"></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-1.70+-orange?logo=rust" alt="Rust 1.70+"></a>
  <img src="https://img.shields.io/badge/Platform-macOS-lightgrey?logo=apple" alt="Platform macOS">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License MIT">
</p>

AnyChat 是一个聚合了多个 AI 聊天服务的桌面应用，旨在提供统一的入口和本地化数据存储。它不仅让你能在一个窗口中无缝切换不同的 AI，还能将你的聊天记录自动备份到本地 SQLite 数据库，实现数据的完全可控。

## 界面

<img src="./anychat-ui.png" alt="界面 UI">

## ✨ 核心特性

- **🚀 多服务聚合**: 统一管理 ChatGPT, Gemini, Claude 等 12+ 种主流 AI 服务。
- **⌨️ 效率优先**: 支持快捷键快速切换服务，极简的 UI 设计。
- **⌨️ 性能优先**: 高性能、低占用，基于 Tauri，安装包大小仅 7 MB。
- **💾 本地存储**: 所有聊天记录持久化至本地 SQLite，支持全文搜索。
- **🔒 私有可控**: 数据不出本地，隐私第一。

## 规划

- [x] 多入口聊天 Chat 聚合
- [x] 支持自定义网站 chat
- [x] 自动获取网站 logo
- [x] google 账号授权登录
- [ ] 聊天数据本地化缓存
