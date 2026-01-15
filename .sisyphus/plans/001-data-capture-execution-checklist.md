# AnyChat 数据捕获功能实现执行清单 (Data Capture Execution Checklist)

本文档定义了 AnyChat 自动数据捕获功能的重构与增强执行步骤。目标是从基于 DOM 的不可靠捕获转向基于 **Fetch Hijacking (Fetch 拦截)** 的健壮方案，以支持 SSE (Server-Sent Events) 流式数据解析。

## 1. 前置准备

- [ ] **确认当前代码状态**
  - 检查 `src-tauri/src/lib.rs` 中的 `AUTH_SCRIPT`（当前包含旧的 DOM 捕获逻辑）。
  - 检查 `src/services/database.ts` 中的 `chat_messages` 表定义。
  - 确认 `src-tauri/tauri.conf.json` 是否包含安全配置。
- [ ] **理解现有实现**
  - 当前通过 `MutationObserver` 监控 DOM 变化并调用 `captureMessages`。
  - 存在一个 HTTP 备用端口 `33445` 用于接收捕获的数据。

## 2. Phase 1: Tauri 配置更新 (dangerousRemoteUrlIpcAccess)

为了让远程站点（如 chatgpt.com）能够安全地调用 `capture_chat_message` 命令，需要配置 `dangerousRemoteUrlIpcAccess`。

- [ ] **更新 `src-tauri/tauri.conf.json`**
  - 在 `app.security` 下添加 `dangerousRemoteUrlIpcAccess`。
  - 包含所有预置服务的域名。
  - 仅暴露 `capture_chat_message` 命令。

```json
{
  "app": {
    "security": {
      "csp": null,
      "dangerousRemoteUrlIpcAccess": [
        {
          "domain": "chatgpt.com",
          "cmd": ["capture_chat_message"]
        },
        {
          "domain": "claude.ai",
          "cmd": ["capture_chat_message"]
        },
        {
          "domain": "gemini.google.com",
          "cmd": ["capture_chat_message"]
        },
        {
          "domain": "chat.deepseek.com",
          "cmd": ["capture_chat_message"]
        },
        {
          "domain": "poe.com",
          "cmd": ["capture_chat_message"]
        },
        {
          "domain": "perplexity.ai",
          "cmd": ["capture_chat_message"]
        },
        {
          "domain": "kimi.moonshot.cn",
          "cmd": ["capture_chat_message"]
        },
        {
          "domain": "chat.qwen.ai",
          "cmd": ["capture_chat_message"]
        },
        {
          "domain": "www.doubao.com",
          "cmd": ["capture_chat_message"]
        },
        {
          "domain": "chatglm.cn",
          "cmd": ["capture_chat_message"]
        },
        {
          "domain": "grok.com",
          "cmd": ["capture_chat_message"]
        },
        {
          "domain": "copilot.microsoft.com",
          "cmd": ["capture_chat_message"]
        }
      ]
    }
  }
}
```

## 3. Phase 2: 注入脚本重构 (Fetch Hijacking)

在 `src-tauri/src/lib.rs` 的 `AUTH_SCRIPT` 中实现 Fetch 拦截器。

### 3.1 Fetch 拦截器框架

- [ ] **重写 `window.fetch`**
  - 保存原始 `fetch` 引用。
  - 拦截特定 API 路径。
  - 对响应进行克隆（`.clone()`）以防影响原页面功能。

### 3.2 SSE 解析器

- [ ] **实现 `ReadableStream` 处理**
  - 如果响应类型是 `text/event-stream`，读取其流。
  - 解析 `data:` 前缀的行。
  - 累加流式内容，直到检测到结束标记（如 `[DONE]`）。

### 3.3 服务适配器

- [ ] **ChatGPT 适配器**
  - 路径：`/backend-api/conversation`
  - 处理流式消息，提取 `message.content.parts`。
- [ ] **Claude 适配器**
  - 路径：`/api/organizations/.*/chat_conversations/.*/completion`
  - 解析 SSE 格式，提取 `completion` 字段。
- [ ] **Gemini 适配器**
  - 路径：`/_/BardChatUi/data/batchexecute`
  - 处理其特殊的嵌套数组格式（通常不是标准 SSE）。
- [ ] **DeepSeek/Kimi 适配器**
  - 匹配相应的 API 路径并解析返回的 JSON/SSE。

### 3.4 IPC 通信

- [ ] **实现数据发送逻辑**
  - 优先尝试 `window.__TAURI__.core.invoke('capture_chat_message', payload)`。
  - 失败时回退到 `fetch('http://localhost:33445/capture', ...)`。

```javascript
// 注入脚本示例片段
(function () {
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = args[0] instanceof URL ? args[0].href : args[0];

    if (isTargetApi(url)) {
      const clone = response.clone();
      handleInterceptedResponse(url, clone);
    }
    return response;
  };

  async function handleInterceptedResponse(url, response) {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/event-stream')) {
      parseSSE(response.body);
    } else {
      const data = await response.json();
      processJsonData(url, data);
    }
  }
})();
```

## 4. Phase 3: 后端增强

更新 Rust 后端以处理更丰富的元数据。

- [ ] **增强 `capture_chat_message` 命令**
  - [ ] 修改 `CapturedMessage` 结构体，增加 `external_id` (String) 和 `meta` (Option<Value>) 字段。
  - [ ] 实现 `external_id` 的幂等校验（防止重复存储）。
  - [ ] 将原始响应的某些关键信息存储在 `meta` 字段。

## 5. Phase 4: 数据库更新

- [ ] **执行 SQL 迁移**
  - [ ] `ALTER TABLE chat_messages ADD COLUMN external_id TEXT;`
  - [ ] `ALTER TABLE chat_messages ADD COLUMN meta TEXT;`
  - [ ] 更新 `idx_messages_external` 索引。
- [ ] **更新 `src/services/database.ts`**
  - [ ] 更新 `ChatMessage` 接口定义。
  - [ ] 更新 `createMessage` 函数以接受并存储新字段。

## 6. Phase 5: 测试验证

- [ ] **ChatGPT 验证**
  - [ ] 发送单条消息，检查是否成功捕获。
  - [ ] 检查流式响应是否被完整拼接。
- [ ] **Claude 验证**
  - [ ] 验证 SSE 解析器在 Claude 页面上的工作情况。
- [ ] **错误处理验证**
  - [ ] 故意禁用 `dangerousRemoteUrlIpcAccess`，验证是否能成功回退到 HTTP 33445 端口。
- [ ] **去重验证**
  - [ ] 多次发送同一消息片段，检查 `external_id` 是否生效防止重复记录。

## 7. 回滚计划

- [ ] **保留旧逻辑**
  - 在注入脚本中保留 DOM 捕获作为 `Fallback`。
  - 如果 Fetch 拦截失败（如站点 CSP 限制），自动启用 DOM 轮询。
- [ ] **配置开关**
  - 可以在前端设置中添加一个“实验性 Fetch 捕获”开关，默认关闭，验证稳定后再开启。
