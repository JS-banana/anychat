# AnyChat 数据自动捕获功能实现计划 (001-data-capture-implementation)

## 1. 项目背景与目标

AnyChat 作为一个多服务聚合的 AI 聊天客户端，其核心价值在于“本地可控的聊天数据沉淀”。目前项目已实现基础的 DOM 捕获方案，但存在稳定性差（受网页结构变化影响）、数据不完整（缺少消息 ID、模型名称等元数据）以及跨域通信限制等问题。

本计划旨在实现一个更加稳定、高效且具备元数据感知的**自动数据捕获系统**。

### 核心目标

- **稳定性**：不依赖网页 DOM 结构，通过 API 劫持获取原始数据。
- **完整性**：捕获完整的对话上下文，包括消息 ID、引用的模型、时间戳等。
- **实时性**：支持流式传输（SSE）数据的实时解析与保存。
- **安全性**：利用 Tauri 2.0 的安全特性进行跨进程通信。

---

## 2. 当前实现分析

### 现状总结

- **注入机制**：通过 `initialization_script` 注入 `AUTH_SCRIPT`。
- **捕获逻辑**：使用 `MutationObserver` 监听 DOM 变化，并根据硬编码的 `CHAT_SELECTORS` 解析内容。
- **通信方式**：主要通过 `fetch` 发送到本地 HTTP Server (127.0.0.1:33445)，备选使用 `window.__TAURI__.core.invoke`（在外部域名下通常不可用）。
- **存储**：前端监听 `chat-captured` 事件并写入 SQLite，后端同时写入 JSONL 备份文件。

### 存在的问题

1. **维护成本高**：每个 AI 服务（ChatGPT, Claude, Gemini 等）的 DOM 结构经常变化，需要频繁更新 CSS 选择器。
2. **数据丢失**：DOM 只能捕获渲染后的文本，无法获取 API 响应中的结构化元数据（如会话 ID）。
3. **通信限制**：本地 HTTP Server 可能受网页 CSP (Content Security Policy) 限制而导致发送失败。
4. **路径不一致**：`lib.rs` 中使用的路径（`com.sunss.chat-box-app`）与项目标识符（`com.anychat.app`）不符。

---

## 3. 技术方案对比

| 维度         | DOM 捕获方案 (当前)      | Fetch/XHR 劫持方案 (推荐)   |
| :----------- | :----------------------- | :-------------------------- |
| **数据源**   | 页面渲染后的 HTML 元素   | API 原始 JSON/SSE 响应      |
| **稳定性**   | 极低（网页改版即失效）   | 高（API 相对稳定）          |
| **开发难度** | 简单                     | 中等（需解析不同 API 格式） |
| **元数据**   | 仅限文本内容             | 包含 ID、模型、Token 数等   |
| **流式支持** | 困难（需处理打字机效果） | 原生支持（解析 SSE 流）     |
| **性能**     | 触发频繁，DOM 解析开销大 | 仅在请求发生时处理          |

---

## 4. 推荐方案详解：API 劫持 (Fetch/XHR Hijacking)

### 4.1 核心机制

在页面脚本运行前，劫持 `window.fetch` 和 `XMLHttpRequest`。通过克隆响应流（Response Clone），在不影响网页正常功能的前提下，读取并解析 AI 服务的通讯数据。

### 4.2 关键技术点

1. **Tauri 2.0 安全配置**：
   - 配置 `dangerousRemoteUrlIpcAccess`，允许特定 AI 域名访问 `capture_chat_message` 命令。
   - 移除不稳定的本地 HTTP Server。

2. **流式数据 (SSE) 解析**：
   - 针对 ChatGPT/Claude 的 `text/event-stream` 响应，实现 `ReadableStream` 拦截器。
   - 实现增量解析逻辑，提取流式输出的最终完整内容。

3. **各服务适配器**：
   - **ChatGPT**: 拦截 `/backend-api/conversation`。
   - **Claude**: 拦截 `/api/organizations/.../chat_conversations/.../completion`。
   - **Gemini**: 解析特殊的 `BatchExecute` RPC 响应格式（嵌套数组）。

---

## 5. 分步执行计划

### 第一阶段：基础设施升级

- [ ] **Tauri 配置更新**：
  - 在 `tauri.conf.json` 中配置 `dangerousRemoteUrlIpcAccess`，添加 `https://chatgpt.com`, `https://claude.ai`, `https://gemini.google.com` 等。
  - 统一项目路径标识符，修正 `lib.rs` 中的路径逻辑。
- [ ] **后端命令优化**：
  - 增强 `capture_chat_message` 命令，支持接收更多元数据（session_id, model, message_id）。

### 第二阶段：注入脚本重构

- [ ] **实现劫持框架**：编写通用的 `fetch` 和 `XHR` 拦截逻辑。
- [ ] **开发服务适配器**：
  - [ ] ChatGPT 适配器：支持 SSE 解析。
  - [ ] Claude 适配器：支持其特定的流格式。
  - [ ] Gemini 适配器：实现复杂的数组解析逻辑。
- [ ] **DOM 方案降级**：保留现有的 DOM 捕获逻辑作为黑盒（未适配）站点的兜底方案。

### 第三阶段：存储与 UI 优化

- [ ] **数据库架构微调**：在 `chat_messages` 表中增加 `external_id` (用于去重) 和 `meta` (存储原始 JSON)。
- [ ] **去重逻辑优化**：利用消息 ID 或内容 Hash 确保不重复记录。
- [ ] **UI 反馈**：在侧边栏或状态栏显示“数据捕获中”的实时状态。

---

## 6. 风险与应对措施

| 风险         | 描述                                | 应对                                                                     |
| :----------- | :---------------------------------- | :----------------------------------------------------------------------- |
| **CSP 限制** | 网页安全策略阻止脚本执行或 IPC 访问 | 使用 Tauri 2.0 官方推荐的 `dangerousRemoteUrlIpcAccess` 替代 HTTP Server |
| **站点改版** | 即使是 API 也会发生非兼容性变更     | 实现版本化适配器，增加错误监控上报                                       |
| **内存泄漏** | 长期拦截流式响应可能导致内存增长    | 确保响应流被正确克隆并及时释放，避免在内存中积压大量流数据               |
| **性能干扰** | 拦截逻辑导致网页加载变慢或卡顿      | 将复杂解析逻辑放入 `requestIdleCallback` 或异步任务中                    |

---

## 7. 测试策略

1. **功能测试**：
   - 验证 ChatGPT 完整对话捕获，确保流式输出结束后能获取完整文本。
   - 验证 Claude 附件/图片消息的捕获情况（至少记录占位信息）。
   - 验证 Gemini 复杂交互（如重新生成、多轮对话）的捕获准确性。

2. **边界测试**：
   - 网络中断后的重试行为。
   - 大量历史消息加载时的系统压力。
   - 登录/未登录状态下的脚本兼容性。

3. **回归测试**：
   - 确保劫持逻辑不会导致 AI 服务无法正常使用（如点击发送无反应）。
