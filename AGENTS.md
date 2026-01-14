# AnyChat

定位：基于 Tauri 2.0 的多 AI Chat 聚合桌面客户端，聚焦"统一入口 + 本地可控的聊天数据沉淀"。
完整产品介绍与使用说明请参考 `README.md`，此处仅保留对开发决策关键的内容。

## 当前目标（优先级）

- P0：自动数据捕获（建议 iframe + postMessage 方案）
- P1：自动备份
- P2：系统托盘、Gemini 导入
- P3：浅色模式

## 预置服务列表

共 12 个预置服务，定义在 `src/types/index.ts`：

- 默认启用：ChatGPT、Gemini、Claude
- 默认隐藏：Grok、Copilot、Perplexity、Poe、DeepSeek、通义千问、Kimi、豆包、智谱清言

用户可在设置中自由启用/禁用任意服务。

## 关键约束与注意事项

- 多 Webview 窗口：使用 `add_child` 创建子 Webview 后，IPC 命令参数**必须使用 `Window`**，不能使用 `WebviewWindow`，否则会触发 `current webview is not a WebviewWindow` 导致命令失败。
- 外部站点 Webview 无 `__TAURI__` 注入，无法直接 IPC；要稳定采集数据需 iframe + postMessage。
- 自定义服务图标：`iconUrl` 可能 404/403，需提供兜底 favicon 来源（已在 UI 做候选兜底）。

## 近期变更（2026-01-14）

- 项目重命名为 AnyChat
- 扩展预置服务至 12 个
- 优化 Sidebar 激活状态 UI（左侧指示条 + 轻微背景）
- 添加工程化配置（Prettier、EditorConfig、Vitest）
- 添加核心业务逻辑测试

## 结构 / 命令

- 详见 `README.md`（避免重复）。
