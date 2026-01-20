# AnyChat 数据捕获功能实现报告

> 文档创建日期: 2026-01-16
> 状态: 进行中 - 核心问题待解决

## 目录

1. [项目背景](#项目背景)
2. [技术挑战](#技术挑战)
3. [已尝试的方案](#已尝试的方案)
4. [当前代码实现](#当前代码实现)
5. [下一步研究方向](#下一步研究方向)
6. [关键代码位置](#关键代码位置)
7. [测试验证方法](#测试验证方法)

---

## 项目背景

### 目标

在 Tauri 2.0 桌面应用中，自动捕获用户在外部 AI 站点（ChatGPT、Claude、Gemini 等）Webview 中的聊天数据，并保存到本地数据库。

### 架构

```
┌─────────────────────────────────────────────────────────┐
│                    AnyChat 主窗口                        │
│  ┌──────────┐  ┌──────────────────────────────────────┐ │
│  │ Sidebar  │  │     外部站点 Webview (chatgpt.com)   │ │
│  │ (React)  │  │                                      │ │
│  │          │  │  ┌─────────────────────────────────┐ │ │
│  │          │  │  │ 注入脚本 (AUTH_SCRIPT)          │ │ │
│  │          │  │  │ - Fetch 拦截器                  │ │ │
│  │          │  │  │ - SSE 解析器                    │ │ │
│  │          │  │  │ - 消息提取器                    │ │ │
│  │          │  │  └─────────────────────────────────┘ │ │
│  └──────────┘  └──────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                            │
                            │ 数据如何传输到 Rust 后端？
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    Rust 后端                             │
│  - capture_chat_message 命令                             │
│  - JSONL 文件写入                                        │
│  - SQLite 数据库                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 技术挑战

### 核心问题

**外部站点 Webview 中的 JavaScript 如何将数据发送到 Tauri Rust 后端？**

### 限制因素

1. **CSP (Content Security Policy)**: ChatGPT 等站点有严格的 CSP 策略，限制了：
   - `connect-src`: 阻止 fetch/XHR 到非白名单域名
   - `img-src`: 可能阻止 Image beacon
   - `script-src`: 阻止加载外部脚本

2. **Tauri 2.0 Bug #11934**: `window.__TAURI__` 不会被注入到外部 URL 的 Webview 中
   - 即使配置了 `remote-access.json` capabilities
   - 即使设置了 `withGlobalTauri: true`
   - 这是 Tauri 2.0 的已知问题，目前状态为 "needs triage"

3. **跨域限制**: 外部站点和主窗口是不同的 origin，无法直接通过 postMessage 通信

---

## 已尝试的方案

### 方案 1: Tauri IPC (`window.__TAURI__`)

**实现思路**:

```javascript
// 在注入脚本中
if (window.__TAURI__ && window.__TAURI__.core) {
  await window.__TAURI__.core.invoke('capture_chat_message', payload);
}
```

**配置文件**: `src-tauri/capabilities/remote-access.json`

```json
{
  "identifier": "remote-access",
  "windows": ["main"],
  "webviews": ["*"],
  "remote": {
    "urls": [
      "https://chatgpt.com/*",
      "https://claude.ai/*"
      // ... 12 个 AI 服务域名
    ]
  },
  "permissions": ["core:default", "core:window:default", "core:webview:default"]
}
```

**结果**: ❌ 失败

**失败原因**:

- `window.__TAURI__` 在外部 URL Webview 中为 `undefined`
- 这是 Tauri 2.0 Bug #11934
- GitHub Issue: https://github.com/tauri-apps/tauri/issues/11934

**控制台日志**:

```
[AnyChat] sendToBackend called, __TAURI__: false, core: false
[AnyChat] Tauri IPC not available, __TAURI__: undefined
```

---

### 方案 2: HTTP 服务器回调 (127.0.0.1)

**实现思路**:

```javascript
// 在注入脚本中
await fetch('http://127.0.0.1:33445/capture', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
```

**Rust 端实现**: 使用 `warp` 框架启动 HTTP 服务器

```rust
let capture_route = warp::post()
    .and(warp::path("capture"))
    .and(warp::body::json::<CapturePayload>())
    .map(move |payload: CapturePayload| {
        // 保存到文件
        warp::reply::json(&serde_json::json!({"status": "ok"}))
    });

warp::serve(capture_route)
    .run(([127, 0, 0, 1], 33445))
    .await;
```

**结果**: ❌ 失败

**失败原因**: 被 ChatGPT 的 CSP 阻止

**控制台错误**:

```
[Error] Refused to connect to http://127.0.0.1:33445/capture
because it does not appear in the connect-src directive of the Content Security Policy.
```

---

### 方案 3: 自定义协议 (`anychat://`)

**实现思路**:

```javascript
// 在注入脚本中
await fetch('anychat://localhost/capture', {
  method: 'POST',
  body: JSON.stringify(payload),
});
```

**Rust 端实现**: 使用 `register_uri_scheme_protocol`

```rust
.register_uri_scheme_protocol("anychat", |_ctx, request| {
    let body = request.body();
    match serde_json::from_slice::<CapturePayload>(body) {
        Ok(payload) => {
            // 保存到文件
            http::Response::builder()
                .status(200)
                .body(r#"{"status":"ok"}"#.as_bytes().to_vec())
                .unwrap()
        }
        Err(e) => { /* 错误处理 */ }
    }
})
```

**结果**: ❌ 失败

**失败原因**: 自定义协议也被 CSP 的 `connect-src` 指令阻止

**控制台错误**:

```
[Error] Refused to connect to anychat://localhost/capture
because it does not appear in the connect-src directive of the Content Security Policy.
```

---

### 方案 4: Image Beacon (GET 请求)

**实现思路**: 使用 `new Image()` 发送 GET 请求，因为 `img-src` 通常比 `connect-src` 宽松

```javascript
// Rust 轮询执行此代码
entries.forEach((entry) => {
  entry.messages.forEach((msg) => {
    const payload = {
      s: entry.serviceId,
      r: msg.role,
      c: msg.content.substring(0, 1500),
      t: Date.now(),
    };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    const img = new Image();
    img.src = 'http://127.0.0.1:33445/beacon?d=' + encoded;
  });
});
```

**Rust 端实现**: 添加 beacon GET 路由

```rust
let beacon_route = warp::get()
    .and(warp::path("beacon"))
    .and(warp::query::<HashMap<String, String>>())
    .map(|params: HashMap<String, String>| {
        if let Some(data) = params.get("d") {
            // 解码并保存数据
        }
        // 返回 1x1 透明 GIF
        warp::reply::with_header(
            warp::reply::with_status(gif_1x1, StatusCode::OK),
            "Content-Type", "image/gif"
        )
    });
```

**结果**: ⚠️ 待验证

**潜在问题**:

- `img-src` 可能也被 CSP 限制
- GET 请求 URL 长度限制（约 2KB）
- 需要用户在 ChatGPT 中实际操作才能触发

---

### 方案 5: 数据队列 + Rust 轮询

**实现思路**: 既然无法从 JS 主动发送数据到后端，那就让数据存在 JS 中，由 Rust 定期读取

```javascript
// 注入脚本中
window.__anychatQueue = [];

function sendToBackend(payload) {
  window.__anychatQueue.push({
    serviceId: payload.serviceId,
    messages: payload.messages,
    url: window.location.href,
    timestamp: Date.now(),
  });
  console.log('[AnyChat] Queued', payload.messages?.length, 'messages');
  return true;
}
```

```rust
// Rust 轮询线程
std::thread::spawn(move || {
    loop {
        std::thread::sleep(Duration::from_secs(3));

        for label in created_webviews.iter() {
            if let Some(webview) = app_handle.get_webview(label) {
                let js_code = r#"
                    (function() {
                        if (!window.__anychatQueue || window.__anychatQueue.length === 0) {
                            return;
                        }
                        const entries = window.__anychatQueue;
                        window.__anychatQueue = [];
                        // 尝试通过 Image beacon 发送
                        // ...
                    })();
                "#;
                let _ = webview.eval(js_code);
            }
        }
    }
});
```

**结果**: ✅ 部分成功

**成功部分**:

- Fetch 拦截器正常工作
- API 响应被成功捕获和解析
- 消息存入 `window.__anychatQueue`

**待解决**:

- 队列中的数据如何传输到 Rust？
- `webview.eval()` 是单向的，无法获取返回值
- Image beacon 可能也被 CSP 阻止

---

## 当前代码实现

### Fetch 拦截器 (已验证工作)

位置: `src-tauri/src/lib.rs` (AUTH_SCRIPT 常量)

```javascript
const originalFetch = window.fetch;
window.fetch = async function (...args) {
  let requestBodyText = null;
  // 捕获请求体...

  const response = await originalFetch.apply(this, args);

  const url = args[0] instanceof Request ? args[0].url : String(args[0]);
  const apiConfig = getApiConfig();

  if (apiConfig && apiConfig.pattern.test(url)) {
    console.log('[AnyChat] Intercepted API call:', url);

    const clone = response.clone();
    const contentType = clone.headers.get('content-type') || '';
    const isSSE = contentType.includes('text/event-stream');
    const isJSON = contentType.includes('application/json');

    if (isSSE) {
      // 解析 SSE 流
    } else if (isJSON) {
      // 解析 JSON 响应
      const jsonText = await clone.text();
      messages = extractChatGPTHistoryMessages(jsonText);
    }

    if (messages.length > 0) {
      sendToBackend({ serviceId: hostname, messages });
    }
  }

  return response;
};
```

### API 模式匹配

```javascript
const API_PATTERNS = {
  'chatgpt.com': {
    pattern: /\/backend-api\/conversation(\/[a-f0-9-]{36})?$/,
    type: 'auto',
    extractMessages: extractChatGPTMessages,
  },
  'claude.ai': {
    pattern: /\/api\/organizations\/.*\/chat_conversations\/.*\/completion/,
    type: 'sse',
    extractMessages: extractClaudeMessages,
  },
  'gemini.google.com': {
    pattern: /\/_\/BardChatUi\/data\/.*batchexecute/,
    type: 'json',
    extractMessages: extractGeminiMessages,
  },
};
```

### ChatGPT 历史消息提取器

```javascript
function extractChatGPTHistoryMessages(jsonText) {
  const messages = [];
  const data = JSON.parse(jsonText);

  if (data?.mapping) {
    const conversationId = data.conversation_id;

    for (const [nodeId, node] of Object.entries(data.mapping)) {
      const msg = node?.message;
      if (!msg || !msg.content?.parts) continue;

      const role = msg.author?.role;
      if (role !== 'user' && role !== 'assistant') continue;

      const content = msg.content.parts.join('').trim();
      if (!content) continue;

      messages.push({
        role: role,
        content: content,
        externalId: msg.id,
        conversationId: conversationId,
        timestamp: msg.create_time ? msg.create_time * 1000 : Date.now(),
        source: 'history',
      });
    }

    messages.sort((a, b) => a.timestamp - b.timestamp);
  }
  return messages;
}
```

---

## 下一步研究方向

### 方向 1: WebSocket 桥接

**思路**: 在主窗口（本地 origin）中建立 WebSocket 连接到本地服务器，然后通过某种方式让外部 Webview 与主窗口通信。

**挑战**: 跨 origin 通信

### 方向 2: 修改 Webview CSP

**思路**: 使用 `on_web_resource_request` 修改响应头中的 CSP

```rust
.on_web_resource_request(|request, response| {
    if let Some(csp) = response.headers_mut().get_mut("Content-Security-Policy") {
        // 修改 CSP 添加 connect-src 127.0.0.1
    }
})
```

**挑战**:

- CSP 可能通过 meta 标签设置，不在响应头中
- 外部站点可能检测 CSP 被篡改

### 方向 3: 使用 SharedArrayBuffer 或 BroadcastChannel

**思路**: 利用浏览器的跨标签通信 API

**挑战**:

- 需要特定的安全头
- 不同 origin 可能无法使用

### 方向 4: 主窗口轮询读取

**思路**: 主窗口（有 `__TAURI__`）定期读取外部 Webview 的 DOM 或 localStorage

**挑战**:

- 跨 origin 无法直接访问
- 需要找到共享存储机制

### 方向 5: 使用 Tauri 深层链接

**思路**: 注册 `anychat://` 深层链接，通过 `window.location.href` 触发

**挑战**:

- 会打断用户页面
- 不适合频繁通信

### 方向 6: 等待 Tauri Bug 修复

**思路**: 监控 Tauri Issue #11934 进展，等待官方修复

**链接**: https://github.com/tauri-apps/tauri/issues/11934

### 方向 7: 使用 tauri-plugin-localhost

**思路**: 使用 localhost 插件提供 HTTPS 本地服务器

**文档**: https://github.com/nicholasio/tauri-plugin-localhost

---

## 关键代码位置

| 文件                                        | 内容                 | 行号 (大约) |
| ------------------------------------------- | -------------------- | ----------- |
| `src-tauri/src/lib.rs`                      | AUTH_SCRIPT 注入脚本 | 22-700      |
| `src-tauri/src/lib.rs`                      | Fetch 拦截器         | 475-542     |
| `src-tauri/src/lib.rs`                      | sendToBackend 函数   | 131-155     |
| `src-tauri/src/lib.rs`                      | ChatGPT 消息提取器   | 248-351     |
| `src-tauri/src/lib.rs`                      | HTTP 服务器          | 1065-1190   |
| `src-tauri/src/lib.rs`                      | 轮询线程             | 1191-1230   |
| `src-tauri/src/lib.rs`                      | 自定义协议处理器     | 1022-1057   |
| `src-tauri/capabilities/remote-access.json` | 远程 IPC 配置        | 全文件      |

---

## 测试验证方法

### 1. 启动应用

```bash
cd /Users/sunss/my-code/myAPP/chat-box-app
pnpm tauri dev
```

### 2. 查看 Rust 日志

终端会显示：

- `[AnyChat] Script injected at: chatgpt.com`
- `[AnyChat] Intercepted API call: ...`
- `[AnyChat] Captured messages: N`
- `[AnyChat] Queue polling started`

### 3. 查看浏览器控制台

在 ChatGPT Webview 的 DevTools Console 中查看：

- `[AnyChat] Queued N messages`
- CSP 错误信息

### 4. 检查捕获的数据

```bash
cat ~/Library/Application\ Support/com.anychat.app/captured_chats.jsonl
```

### 5. 验证 Tauri IPC 状态

在 DevTools Console 中输入：

```javascript
window.__TAURI__; // 应该返回 undefined（这是问题所在）
window.__anychatQueue; // 应该返回数组（队列中的数据）
```

---

## 总结

### 已完成

1. ✅ Fetch 拦截器框架
2. ✅ SSE 流解析器
3. ✅ ChatGPT/Claude/Gemini 消息提取器
4. ✅ HTTP 服务器后端
5. ✅ 自定义协议处理器
6. ✅ 数据队列机制
7. ✅ 轮询线程

### 核心阻塞

**外部站点 CSP 阻止所有形式的网络通信到本地服务器**

- ❌ HTTP fetch 到 127.0.0.1
- ❌ 自定义协议 anychat://
- ❌ Image beacon (待验证，可能也被阻止)
- ❌ Tauri IPC (Bug #11934)

### 需要突破

找到一种绕过 CSP 或不依赖网络请求的数据传输方式。

---

## 参考资料

1. [Tauri 2.0 Security - Capabilities](https://v2.tauri.app/security/capabilities/)
2. [Tauri Issue #11934 - Remote API Access](https://github.com/tauri-apps/tauri/issues/11934)
3. [Tauri Issue #5088 - Inject **TAURI** in remote URLs](https://github.com/tauri-apps/tauri/issues/5088)
4. [MDN - Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
5. [Wry (Tauri WebView) Documentation](https://docs.rs/wry/latest/wry/)
