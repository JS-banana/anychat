# AnyChat

定位：基于 Tauri 2.0 的多 AI Chat 聚合桌面客户端，聚焦"统一入口 + 本地可控的聊天数据沉淀"。
完整产品介绍与使用说明请参考 `README.md`，此处仅保留对开发决策关键的内容。

## 当前目标（优先级）

- P0：自动数据捕获（采用 Fetch/XHR 劫持 + dangerousRemoteUrlIpcAccess 方案）—— 进行中
- P1：自动备份

## 已完成功能

- 设置页面重构为 Cherry Studio 风格（左侧导航 + 右侧内容区双栏布局）
- 聊天历史管理整合到设置页面「数据管理」分类
- 添加自定义服务交互优化（Dialog弹窗 + Logo自动获取 + 预设图标选择）
- 移除 Import ChatGPT / Import Gemini 按钮（用户通过官方账号登录使用，无需离线导入）
- 系统托盘
- 浅色模式

## 预置服务列表

共 12 个预置服务，定义在 `src/types/index.ts`，用户可在设置中自由启用/禁用任意服务。

## 关键约束与注意事项

- 多 Webview 窗口：使用 `add_child` 创建子 Webview 后，IPC 命令参数**必须使用 `Window`**，不能使用 `WebviewWindow`，否则会触发 `current webview is not a WebviewWindow` 导致命令失败。
- 外部站点 Webview 默认无 `__TAURI__` 注入，需配置 `dangerousRemoteUrlIpcAccess` 开启特定域名的 IPC 访问。
- 自定义服务图标：`iconUrl` 可能 404/403，需提供兜底 favicon 来源（已在 UI 做候选兜底）。

## 数据捕获技术方案（2026-01-15 更新）

### 核心问题

用户在 webview 中使用 ChatGPT/Gemini/Claude 等 AI 服务聊天时，需要自动捕获聊天数据并缓存到本地 SQLite 数据库。

### 技术方案对比

| 方案                        | 数据源        | 稳定性     | 完整性     | 推荐度    |
| :-------------------------- | :------------ | :--------- | :--------- | :-------- |
| **Fetch/XHR 劫持** (推荐)   | API 原始 JSON | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ 主方案 |
| DOM MutationObserver (当前) | 渲染后 HTML   | ⭐⭐       | ⭐⭐       | 兜底方案  |
| 本地 HTTP Server            | -             | ⭐⭐⭐     | -          | 备选通信  |
| iframe + postMessage        | -             | ❌         | -          | 不可行    |

> ⚠️ **注意**：iframe + postMessage 方案不可行，因为主流 AI 站点设置了 `X-Frame-Options: DENY`。当前使用的 Tauri 子 Webview (`add_child`) 是正确的方案。

### 主方案：Fetch/XHR 劫持 + Tauri IPC

**原理**：通过 `initialization_script` 注入脚本，在页面加载前劫持 `window.fetch`，拦截 AI 服务的 API 请求，克隆响应并解析数据。

**关键步骤**：

1. 配置 `dangerousRemoteUrlIpcAccess` 允许 AI 域名调用 Tauri 命令
2. 重写 `window.fetch`，拦截特定 API 路径
3. 解析 SSE (Server-Sent Events) 流式响应
4. 通过 `window.__TAURI__.core.invoke()` 发送数据到 Rust 后端

**SSE 处理**：ChatGPT/Claude 使用 SSE 实现流式输出（打字机效果），需要：

- 读取 `ReadableStream`
- 解析 `data:` 前缀的每一行
- 累积所有片段组装完整消息
- 检测 `[DONE]` 标记结束

**API 端点**：

- ChatGPT: `/backend-api/conversation` (SSE)
- Claude: `/api/organizations/.*/chat_conversations/.*/completion` (SSE)
- Gemini: `/_/BardChatUi/data/batchexecute` (嵌套数组)

### 备选方案：本地 HTTP Server

当 IPC 方案失败时（如某些站点 CSP 限制），回退到本地 HTTP 服务器：

- 已在 `lib.rs` 中实现 warp 服务器，监听 `127.0.0.1:33445`
- 注入脚本通过 `fetch('http://127.0.0.1:33445/capture', ...)` 发送数据

### 兜底方案：DOM MutationObserver

针对未适配的站点，保留现有 DOM 捕获逻辑：

- 选择器配置在 `AUTH_SCRIPT` 的 `CHAT_SELECTORS` 中
- 通过 MutationObserver 监控 DOM 变化
- 解析渲染后的 HTML 提取文本

## 执行计划

详细执行步骤见：

- `.sisyphus/plans/001-data-capture-implementation.md` - 技术方案文档
- `.sisyphus/plans/001-data-capture-execution-checklist.md` - 执行清单

### Phase 1: Tauri 配置更新

- [ ] 在 `tauri.conf.json` 配置 `dangerousRemoteUrlIpcAccess`
- [ ] 添加 12 个 AI 服务域名

### Phase 2: 注入脚本重构

- [ ] 实现 Fetch 拦截器框架
- [ ] 实现 SSE 解析器
- [ ] 开发服务适配器（ChatGPT、Claude、Gemini）

### Phase 3: 后端增强

- [ ] 增强 `capture_chat_message` 命令
- [ ] 添加 `external_id` 和 `meta` 字段

### Phase 4: 数据库更新

- [ ] 执行 SQL 迁移
- [ ] 更新 TypeScript 类型定义

### Phase 5: 测试验证

- [ ] ChatGPT 单条/流式消息捕获
- [ ] Claude 对话捕获
- [ ] 回退机制验证

## 近期变更

### 2026-01-15

- 完成数据捕获技术方案调研
- 确定采用 Fetch/XHR 劫持 + dangerousRemoteUrlIpcAccess 方案
- 创建详细执行计划文档

### 2026-01-14

- 项目重命名为 AnyChat
- 扩展预置服务至 12 个
- 优化 Sidebar 激活状态 UI（左侧指示条 + 轻微背景）
- 添加工程化配置（Prettier、EditorConfig、Vitest）
- 添加核心业务逻辑测试

## 结构 / 命令

- 详见 `README.md`（避免重复）。
