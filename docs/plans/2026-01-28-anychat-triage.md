# AnyChat 问题排查与优化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 记录用户需求与证据，按任务逐一排查并修复 AnyChat 的运行异常与构建体积问题。

**Architecture:** 以问题为单元逐一处理：先确认现状与根因，再提出验证性方案。每个任务独立记录证据、假设、结论与改动。

**Tech Stack:** Tauri 2.x, React 19, Vite 7, TypeScript, SQLite (tauri-plugin-sql), Rust

---

## 用户描述与需求（原文摘录）
1) 对当前分支的代码改动进行 commit，按功能模块拆分，message 规范且 20 字以内
2) 切换到 grok 时白屏，控制台报错：SSL error，无法建立安全连接
3) build 构建包体积较大，需分析与优化
4) 设置页打开后出现模糊蒙版且一直显示 “Initializing...”
5) 需要记录以上需求与后续处理过程；每完成一个任务更新本文件，并在 AGENTS.md 记录路径

## 现状快照（初始）
- 分支：dev（领先远端 1 个提交）
- 未提交修改：大量 icons + `src-tauri/src/lib.rs`、`src/components/AppLayout.tsx`、`src/services/database.ts`
- build 提示：主 chunk 约 503 KB（gzip 163 KB）
- 控制台日志：切换 grok 时报 SSL 错误；Webview 已创建/显示

## 任务清单（建议顺序）
0) 任务记录文件与 AGENTS.md 路径登记
1) 提交已有改动（按模块拆分提交）
2) 排查 grok 白屏（SSL 错误）根因与修复方案
3) 分析 build 体积并提出优化方案
4) 排查设置页蒙版 “Initializing...” 常驻问题

## 任务 0：任务记录与入口登记
**执行步骤**
1. 创建任务记录文件 `docs/plans/2026-01-28-anychat-triage.md`
2. 在 `AGENTS.md` 中加入该文件路径
3. `git status -sb` 确认变更

**验证**
- 文档与路径在仓库中可见

**当前进度**
- 已完成

## 任务 1：提交已有改动（按模块拆分）
**待处理要点**
- 图标资源压缩/替换（多平台图标）
- Tauri 后端窗口/webview 管理变更（`src-tauri/src/lib.rs`）
- 前端初始化遮罩层区域调整（`src/components/AppLayout.tsx`）
- 数据库初始化并发防护（`src/services/database.ts`）

**执行步骤**
1. 在主工作区（dev 分支）按模块拆分提交现有改动
   - icons：`chore: 更新应用图标`
   - tauri 窗口/webview：`fix: 改进窗口管理`
   - DB 初始化：`fix: 防止重复初始化DB`
   - 初始化遮罩：`fix: 调整初始化遮罩`
2. 提交完成后，将 dev 的新提交同步到当前工作树
3. 每次提交后 `git status -sb` 确认工作区干净

**验证**
- `git log --oneline -n 5` 可看到多条拆分提交
- 变更文件分布符合模块边界

**当前进度**
- 已完成（共 5 笔模块提交）

## 任务 2：grok 白屏（SSL 错误）
**证据**
- 控制台：`Failed to load resource: An SSL error has occurred and a secure connection to the server cannot be made. (grok.com, line 0)`
- 日志：webview 已创建并显示
- 本机 DNS：`dig grok.com` → `198.18.1.235`（非常规保留网段）
- `curl -Iv https://grok.com` → `SSL_ERROR_SYSCALL`

**假设**
- grok.com 的 TLS/证书策略与 Tauri WebView 兼容性问题
- WebView 使用的 TLS 版本或证书信任链导致握手失败
- 平台相关（macOS WebKit）
 
**初步结论**
- 更可能是本机/网络层 DNS 或代理拦截导致域名解析异常，从而 SSL 握手失败；非应用侧逻辑问题

**执行步骤**
1. 收集配置：检查 `src-tauri/tauri.conf.json` 与安全策略相关配置
2. 复核 webview 创建参数与允许的 URL 列表
3. 使用命令行验证 TLS 连通性（`curl -Iv https://grok.com`）
4. 形成单一根因假设并记录验证结果
5. 若需要修复：先补充最小化测试（如可行）再修改

**验证**
- 明确根因与可复现步骤（或明确外部限制）

**当前进度**
- 已完成（根因指向 DNS/网络层拦截）

## 任务 3：build 体积
**证据**
- `index-*.js` 503.56 kB（gzip 163.94 kB）
- `pnpm build` 仅产出单一 JS chunk（无拆包）
- `SettingsPage.tsx` 引入 `@dnd-kit/*` + `framer-motion` 等重依赖

**假设**
- 单包打包导致未拆分
- 包含了重依赖（如 framer-motion、@dnd-kit、radix）

**执行步骤**
1. 运行 `pnpm build` 复现体积输出
2. 统计 `dist/assets/index-*.js` 的主要依赖来源
3. 给出 2-3 个拆包/按需加载方案（含影响与成本）
4. 若需要修复：先补充最小化验证，再实现拆包

**验证**
- 输出清晰的体积分析与优化建议

**当前进度**
- 已完成（输出分析与优化建议）

## 任务 4：设置页蒙版 “Initializing...” 常驻
**证据**
- UI 截图显示设置页被模糊蒙版覆盖，提示 “Initializing...”

**假设**
- `dbReady` 未正确置 true 或初始化未完成/未回写
- 前端遮罩层定位覆盖了设置页区域
 
**初步结论**
- 遮罩层显示完全由 `dbReady` 控制；一旦 `initDatabase()` 失败，`dbReady` 永远为 false，导致“Initializing...” 常驻
- 目前遮罩层对所有设置页生效，但 DB 只影响“数据”页，服务/关于无需阻塞

**执行步骤**
1. 追踪 `dbReady` 来源与写入逻辑（`src/services/database.ts` / `src/stores`）
2. 确认初始化 promise 是否存在并发/失败未上报
3. 复核遮罩层布局与层级区域（`src/components/AppLayout.tsx`）
4. 形成单一根因假设并记录验证结果
5. 若需要修复：先补充最小化测试再修改

**验证**
- 明确根因与修复策略（如需代码修改）

**当前进度**
- 已完成（仅在数据页显示遮罩，并增加错误提示与日志）

---

## 进度记录
- 2026-01-28：创建任务记录文件；建立 worktree（`.worktrees/triage-2026-01-28`）；安装依赖。
- 2026-01-28：完成模块化提交（gitignore、icons、tauri 窗口、DB 初始化、初始化遮罩）。
- 2026-01-28：复现 build 体积并定位主包依赖来源（SettingsPage 引入重依赖）。
- 2026-01-28：增加 DB 初始化失败可视化提示与日志，便于收集根因。
- 2026-01-28：遮罩层仅在“数据”页显示，避免服务/关于页面被阻塞。
- 2026-01-28：修复旧库迁移顺序，避免 external_id 缺失导致初始化失败。
- 2026-01-28：阻止 OAuth 新窗口在主 WebView 打开，避免登录界面覆盖侧栏。
- 2026-01-28：将 .sisyphus/.vscode 从版本控制移除并忽略。
