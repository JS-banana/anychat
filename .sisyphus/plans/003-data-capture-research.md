# AnyChat 数据捕获技术研究总结

> 创建日期: 2026-01-20
> 状态: 研究完成，进入实施阶段

## 一、问题定义

**目标**: 在 Tauri 2.0 桌面应用中，自动捕获用户在外部 AI 站点 Webview 中的聊天数据，并保存到本地。

**核心阻塞**: 外部站点的 CSP (Content Security Policy) 阻止所有从 Webview 到本地的数据传输。

## 二、已验证的技术限制

| 方案 | 状态 | 失败原因 |
|------|------|----------|
| Tauri IPC (`__TAURI__`) | ❌ 不可用 | Bug #11934，远程 URL 不注入 |
| HTTP fetch 到 localhost | ❌ 被阻止 | CSP `connect-src` 限制 |
| 自定义协议 `anychat://` | ❌ 被阻止 | CSP `connect-src` 限制 |
| Image beacon | ❌ 可能被阻止 | CSP `img-src` 限制 |

## 三、已成功实现的模块

- ✅ Fetch 拦截器 (AUTH_SCRIPT in lib.rs)
- ✅ SSE 流解析器
- ✅ ChatGPT/Claude/Gemini 消息提取器
- ✅ 数据队列 `window.__anychatQueue`
- ✅ HTTP 服务器 (warp, 127.0.0.1:33445)
- ✅ 自定义协议处理器 `anychat://`

**结论**: 数据捕获层面已完成，问题在于数据传输通道被 CSP 阻断。

## 四、可行方案评估

### 方案 A: MITM 代理 (优先实施)

**原理**: Rust 嵌入 HTTPS 代理，剥离 CSP 响应头

**技术栈**:
- `hudsucker` 或 `http-mitm-proxy`: MITM 代理库
- `rcgen`: 动态生成 TLS 证书
- `rustls`: TLS 实现

**优势**:
- 保留 Tauri 轻量特性 (~300MB 内存)
- 安装包体积小 (<10MB)
- 根治 CSP 问题

**挑战**:
- 证书管理复杂
- macOS 需用户信任自签名 CA
- Windows 可通过 `--ignore-certificate-errors` 简化

**详细计划**: `003-plan-a-mitm-proxy.md`

### 方案 B: Electron 迁移 (保底)

**原理**: `<webview>` + preload 脚本绕过所有限制

**技术栈**:
- Electron 28+
- `session.webRequest.onHeadersReceived` 剥离 CSP
- `ipcRenderer.sendToHost()` 数据传输

**优势**:
- 成熟方案，100% 可行
- Ferdium/Tangram 等项目已验证
- 开发体验好

**劣势**:
- 内存占用高 (~1GB for 5 webviews)
- 安装包体积大 (~150MB)

**详细计划**: `003-plan-b-electron.md`

## 五、方案对比

| 维度 | 方案 A (MITM) | 方案 B (Electron) |
|------|--------------|-------------------|
| 技术可行性 | ⭐⭐⭐⭐ 高 | ⭐⭐⭐⭐⭐ 最高 |
| 开发复杂度 | ⭐⭐⭐ 高 | ⭐⭐ 中 |
| 内存效率 | ⭐⭐⭐⭐⭐ 优秀 | ⭐⭐ 差 |
| 安装包大小 | ⭐⭐⭐⭐⭐ 优秀 | ⭐⭐ 差 |
| 代码复用 | ⭐⭐⭐⭐ 高 | ⭐⭐⭐ 中 |

## 六、决策

采用 **分阶段验证** 策略：

1. **Phase 1**: 验证 MITM 代理方案 (1-2周)
   - 分支: `feature/mitm-proxy`
   - 工作目录: `../anychat-mitm/`

2. **Phase 2**: 如失败，迁移到 Electron
   - 分支: `feature/electron-migration`
   - 工作目录: `../anychat-electron/`

## 七、参考资料

- [Tauri Issue #11934 - Remote API Access](https://github.com/tauri-apps/tauri/issues/11934)
- [Tauri Issue #5088 - Inject __TAURI__ in remote URLs](https://github.com/tauri-apps/tauri/issues/5088)
- [hudsucker MITM 库](https://github.com/omame/hudsucker)
- [rcgen 证书生成](https://github.com/rustls/rcgen)
- [Ferdium (Electron 聚合器)](https://github.com/ferdium/ferdium-app)
- [Electron webRequest API](https://www.electronjs.org/docs/latest/api/web-request)

## 八、关键文件

| 文件 | 内容 |
|------|------|
| `src-tauri/src/lib.rs` | AUTH_SCRIPT 注入脚本、Fetch 拦截、HTTP 服务器 |
| `src-tauri/capabilities/remote-access.json` | 远程 IPC 配置 (当前不生效) |
| `docs/data-capture-implementation-report.md` | 之前的实现报告 |
| `docs/2026-01-20研究分析报告.md` | 外部研究报告 |
| `docs/2026-01-20 研究报告gemini.md` | Gemini 深度分析报告 |
