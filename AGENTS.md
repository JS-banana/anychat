# AnyChat

定位：基于 Tauri 2.0 的多 AI Chat 聚合桌面客户端，聚焦"统一入口 + 本地可控的聊天数据沉淀"。

## 当前目标

- P0：聊天数据自动捕获，并缓存
- P1：手动同步备份

## 当前开发任务

### 数据捕获功能 (P0)

**状态**: 🔄 进行中
**跟踪文件**: `.sisyphus/plans/003-task-tracker.md`

#### 核心阻塞

外部站点 CSP 阻止所有从 Webview 到本地的数据传输：
- `window.__TAURI__` 不可用 (Tauri Bug #11934)
- CSP 阻止 fetch 到 localhost
- CSP 阻止自定义协议请求

#### 采用方案

分阶段验证策略：

| 方案 | 状态 | 分支 | 工作目录 |
|------|------|------|----------|
| A: MITM 代理 | 🔄 进行中 | `feature/mitm-proxy` | `../anychat-mitm/` |
| B: Electron 迁移 | ⏸️ 待命 | `feature/electron-migration` | `../anychat-electron/` |

**方案 A 原理**: Rust 嵌入 HTTPS 代理 (hudsucker)，剥离 CSP 响应头，使注入脚本可以 fetch 到本地端点。

**方案 B 原理**: Electron `<webview>` + preload 脚本，使用 `session.webRequest` 剥离 CSP，`ipcRenderer.sendToHost()` 传输数据。

#### 相关文档

- 研究总结: `.sisyphus/plans/003-data-capture-research.md`
- 方案 A 计划: `.sisyphus/plans/003-plan-a-mitm-proxy.md`
- 方案 B 计划: `.sisyphus/plans/003-plan-b-electron.md`
- 之前的报告: `docs/data-capture-implementation-report.md`

#### Git Worktree

```bash
# 查看 worktree
git worktree list

# 方案 A
cd ../anychat-mitm/

# 方案 B (如需要)
cd ../anychat-electron/
```

## 关键文件

- `src-tauri/src/lib.rs`：Tauri 核心逻辑
  - AUTH_SCRIPT 注入脚本 (Fetch 拦截 + SSE 解析 + 消息提取)
  - 自定义协议处理器 `anychat://`
  - HTTP 服务器 (warp, 127.0.0.1:33445)
  - 数据队列轮询

- `src-tauri/capabilities/remote-access.json`：远程站点 IPC 配置 (当前不生效)

## 已完成模块

- ✅ Fetch 拦截器
- ✅ SSE 流解析器
- ✅ ChatGPT/Claude/Gemini 消息提取器
- ✅ 数据队列 `window.__anychatQueue`
- ✅ HTTP 服务器后端
- ✅ 自定义协议处理器
- ✅ UI 和界面优化

## 参考资料

- [Tauri Issue #11934](https://github.com/tauri-apps/tauri/issues/11934) - 远程 URL 不注入 __TAURI__
- [hudsucker](https://github.com/omame/hudsucker) - Rust MITM 代理库
- [Ferdium](https://github.com/ferdium/ferdium-app) - Electron 服务聚合器参考
