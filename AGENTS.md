# AnyChat (Electron Exploration)

本分支用于管理和维护基于 **Electron** 的多 AI Chat 聚合方案。

## 分支定位

- **状态**: ⏸️ 待命 (Standby)
- **目标**: 作为 Tauri 方案的备选方案。若 Tauri 的 MITM 代理方案无法解决 CSP 限制，将切换至此分支进行开发。

## 方案原理 (Plan B)

使用 Electron 的成熟架构解决外部站点数据捕获问题：

- **核心组件**: 使用 `<webview>` 标签承载 AI 站点。
- **数据注入**: 通过 `preload` 脚本注入拦截逻辑。
- **CSP 绕过**: 利用 `session.webRequest.onHeadersReceived` 动态剥离 `Content-Security-Policy` 响应头。
- **数据传输**: 使用 `ipcRenderer.sendToHost()` 将捕获的聊天数据传回主进程或宿主页面。

## 主要参考资料

- [Ferdium](https://github.com/ferdium/ferdium-app) - 成熟的 Electron 多服务聚合器实现参考
- [Electron webview tag](https://www.electronjs.org/docs/latest/api/webview-tag) - 官方文档
- [Electron session API](https://www.electronjs.org/docs/latest/api/session) - 网络请求控制

## 关键文档索引

- 技术调研: `docs/research/003-plan-b-electron.md` (或同类路径)
- 历史研究报告: `docs/research/data-capture-implementation-report.md`

---

_详细信息请参阅文档索引中的具体文档_
