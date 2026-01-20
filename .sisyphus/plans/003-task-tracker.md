# 数据捕获功能 - 任务跟踪

> 创建日期: 2026-01-20
> 最后更新: 2026-01-20
> 当前方案: A (MITM 代理)
> 状态: 🔄 进行中

## 当前进度

### Phase 1: MITM 代理方案验证

| # | 任务 | 状态 | 完成日期 | 备注 |
|---|------|------|----------|------|
| 1.1 | 创建 feature/mitm-proxy 分支 | ⬜ 待开始 | - | - |
| 1.2 | 设置 git worktree | ⬜ 待开始 | - | ../anychat-mitm/ |
| 1.3 | 添加 hudsucker/rcgen 依赖 | ⬜ 待开始 | - | - |
| 1.4 | 实现证书管理模块 cert.rs | ⬜ 待开始 | - | - |
| 1.5 | 实现 MITM 代理服务 proxy.rs | ⬜ 待开始 | - | - |
| 1.6 | 集成代理到 Tauri 启动流程 | ⬜ 待开始 | - | - |
| 1.7 | 配置 Webview proxy_url | ⬜ 待开始 | - | - |
| 1.8 | 更新注入脚本 sendToBackend | ⬜ 待开始 | - | - |
| 1.9 | Windows 平台测试 | ⬜ 待开始 | - | - |
| 1.10 | macOS 平台测试 | ⬜ 待开始 | - | 含证书信任 |
| 1.11 | 方案评估与决策 | ⬜ 待开始 | - | - |

### Phase 2: Electron 迁移 (备用)

| # | 任务 | 状态 | 完成日期 | 备注 |
|---|------|------|----------|------|
| 2.1 | 创建 feature/electron-migration 分支 | ⏸️ 待命 | - | - |
| 2.2 | 初始化 Electron 项目 | ⏸️ 待命 | - | - |
| 2.3 | 实现 CSP 绕过 | ⏸️ 待命 | - | - |
| 2.4 | 迁移 preload 脚本 | ⏸️ 待命 | - | - |
| 2.5 | 验证数据捕获 | ⏸️ 待命 | - | - |
| 2.6 | 迁移 UI 组件 | ⏸️ 待命 | - | - |
| 2.7 | 完善功能 | ⏸️ 待命 | - | - |

## 状态说明

- ⬜ 待开始
- 🔄 进行中
- ✅ 已完成
- ❌ 失败/阻塞
- ⏸️ 待命/暂停

## 阻塞与问题记录

| 日期 | 问题描述 | 影响 | 解决方案 | 状态 |
|------|----------|------|----------|------|
| 2026-01-16 | window.__TAURI__ 在远程 URL 不可用 | 无法使用 Tauri IPC | 采用 MITM 代理方案 | 🔄 进行中 |
| 2026-01-16 | CSP 阻止 fetch 到 localhost | 数据无法传输 | 采用 MITM 代理方案 | 🔄 进行中 |

## 方案验证记录

### 方案 A (MITM 代理)

| 验证项 | 结果 | 日期 | 备注 |
|--------|------|------|------|
| 代理服务启动 | ⬜ 待验证 | - | - |
| CSP 剥离生效 | ⬜ 待验证 | - | - |
| fetch 到 /_bridge/capture | ⬜ 待验证 | - | - |
| Windows 兼容性 | ⬜ 待验证 | - | - |
| macOS 兼容性 | ⬜ 待验证 | - | - |
| 整体可行性 | ⬜ 待验证 | - | - |

### 方案 B (Electron) - 如需要

| 验证项 | 结果 | 日期 | 备注 |
|--------|------|------|------|
| CSP 绕过 | ⏸️ 待命 | - | - |
| webview preload | ⏸️ 待命 | - | - |
| ipcRenderer.sendToHost | ⏸️ 待命 | - | - |
| 整体可行性 | ⏸️ 待命 | - | - |

## 最终决策

- 日期: 待定
- 决策: 待定
- 原因: 待定

## 下一步行动

1. [x] 创建计划文档
2. [ ] 设置 git worktree
3. [ ] 开始 MITM 代理实现
4. [ ] 验证核心功能

## 相关文档

- 研究总结: `003-data-capture-research.md`
- 方案 A 计划: `003-plan-a-mitm-proxy.md`
- 方案 B 计划: `003-plan-b-electron.md`
- 之前的报告: `docs/data-capture-implementation-report.md`

## Git Worktree 管理

```bash
# 查看当前 worktree
git worktree list

# 方案 A 工作目录
cd ../anychat-mitm/

# 方案 B 工作目录 (如需要)
cd ../anychat-electron/

# 删除 worktree
git worktree remove ../anychat-mitm
```
