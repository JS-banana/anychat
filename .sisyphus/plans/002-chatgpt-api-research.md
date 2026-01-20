# ChatGPT Web API 技术研究报告

> 研究日期：2026-01-15
> 目的：为 AnyChat 数据捕获功能提供 ChatGPT **官网 (chatgpt.com)** 接口的详细技术规格
> 注意：这是官网 backend-api，不是 OpenAI 开发者 API (api.openai.com)

## 1. API 端点

### 1.1 核心接口

| 接口         | 方法 | URL                                                          | 用途                       |
| :----------- | :--- | :----------------------------------------------------------- | :------------------------- |
| 发送消息     | POST | `/backend-api/conversation`                                  | 发送用户消息，接收流式响应 |
| 获取会话详情 | GET  | `/backend-api/conversation/{id}`                             | 获取完整消息树             |
| 会话列表     | GET  | `/backend-api/conversations?offset=0&limit=28&order=updated` | 获取历史会话列表           |
| 身份鉴权     | GET  | `/api/auth/session`                                          | 获取 accessToken           |

### 1.2 我们需要拦截的接口

**主要拦截**：`POST /backend-api/conversation`

这是唯一需要拦截的接口，它同时包含：

- 用户发送的消息（在请求体中）
- AI 的流式响应（在响应体中）

## 2. 发送消息 - POST /backend-api/conversation

### 2.1 请求头

```http
Authorization: Bearer <accessToken>
X-Authorization: Bearer <accessToken>
Content-Type: application/json
Accept: text/event-stream
Chatgpt-Account-Id: <id>  (Team/Enterprise 账号需要)
```

### 2.2 请求体结构

```json
{
  "action": "next",
  "messages": [
    {
      "id": "aaa111bbb-2222-3333-4444-555555555555",
      "author": { "role": "user" },
      "content": {
        "content_type": "text",
        "parts": ["Hello, how are you?"]
      },
      "metadata": {}
    }
  ],
  "parent_message_id": "ccc111ddd-2222-3333-4444-666666666666",
  "model": "gpt-4o",
  "timezone_offset_min": -480,
  "history_and_training_disabled": false,
  "conversation_id": "eee111fff-2222-3333-4444-777777777777",
  "conversation_mode": { "kind": "primary_assistant" },
  "force_paragen": false,
  "force_rate_limit": false
}
```

**关键字段**：

- `messages[0].content.parts[0]` - 用户输入的文本
- `messages[0].id` - 用户消息的 UUID
- `parent_message_id` - 上一条消息的 ID（新对话时为新生成的 UUID）
- `conversation_id` - 会话 ID（新对话时可能为 null）

## 3. AI 响应 - SSE 流式格式

### 3.1 响应类型

- Content-Type: `text/event-stream`
- 每行以 `data: ` 开头
- 最后一行是 `data: [DONE]`

### 3.2 SSE 事件结构

**重要发现**：官网接口发送的是**累积内容**（full text so far），不是增量 delta！

```json
data: {
  "message": {
    "id": "assistant-uuid-12345",
    "author": {
      "role": "assistant",
      "name": null,
      "metadata": {}
    },
    "create_time": 1736932168.123,
    "update_time": null,
    "content": {
      "content_type": "text",
      "parts": ["I am doing well, thank you for asking!"]
    },
    "status": "in_progress",
    "end_turn": null,
    "weight": 1.0,
    "metadata": {
      "message_type": "next",
      "model_slug": "gpt-4o",
      "finish_details": {
        "type": "stop",
        "stop": "<|endoftext|>"
      }
    },
    "recipient": "all"
  },
  "conversation_id": "conv-uuid-12345",
  "error": null
}
```

### 3.3 关键字段说明

| 字段                          | 说明                                    |
| :---------------------------- | :-------------------------------------- |
| `message.id`                  | 消息 UUID                               |
| `message.author.role`         | `user` / `assistant`                    |
| `message.content.parts[0]`    | 消息文本内容（累积的完整内容）          |
| `message.status`              | `in_progress` / `finished_successfully` |
| `message.metadata.model_slug` | 使用的模型 (gpt-4o, gpt-4, etc.)        |
| `conversation_id`             | 会话 UUID                               |

### 3.4 流结束检测

两种方式：

1. 收到 `data: [DONE]`
2. `message.status === "finished_successfully"`

## 4. 获取会话详情 - GET /backend-api/conversation/{id}

### 4.1 响应结构

使用**树状 Mapping 结构**（邻接表），支持消息分支和重新生成。

```json
{
  "title": "My Travel Plans",
  "create_time": 1736930000.0,
  "update_time": 1736932000.0,
  "mapping": {
    "uuid-root": {
      "id": "uuid-root",
      "message": null,
      "parent": null,
      "children": ["uuid-user-msg-1"]
    },
    "uuid-user-msg-1": {
      "id": "uuid-user-msg-1",
      "message": {
        "id": "uuid-user-msg-1",
        "author": { "role": "user" },
        "content": { "content_type": "text", "parts": ["Hi"] },
        "metadata": { "timestamp_": "absolute" }
      },
      "parent": "uuid-root",
      "children": ["uuid-assistant-msg-1"]
    },
    "uuid-assistant-msg-1": {
      "id": "uuid-assistant-msg-1",
      "message": {
        "id": "uuid-assistant-msg-1",
        "author": { "role": "assistant" },
        "content": { "content_type": "text", "parts": ["Hello! How can I help?"] },
        "metadata": {}
      },
      "parent": "uuid-user-msg-1",
      "children": []
    }
  },
  "current_node": "uuid-assistant-msg-1",
  "conversation_id": "conv-uuid-12345",
  "is_archived": false
}
```

### 4.2 Mapping 遍历算法

从 `current_node` 向上遍历 `parent`，收集所有消息：

```javascript
function extractMessages(mapping, currentNode) {
  const messages = [];
  let nodeId = currentNode;

  while (nodeId && mapping[nodeId]) {
    const node = mapping[nodeId];
    if (node.message && node.message.content) {
      messages.unshift({
        id: node.message.id,
        role: node.message.author.role,
        content: node.message.content.parts.join(''),
      });
    }
    nodeId = node.parent;
  }

  return messages;
}
```

## 5. 会话列表 - GET /backend-api/conversations

### 5.1 请求参数

```
offset=0&limit=28&order=updated&is_archived=false&is_starred=false
```

### 5.2 响应结构

```json
{
  "items": [
    {
      "id": "conv-uuid-1",
      "title": "How to bake a cake",
      "create_time": "2025-01-15T08:00:00.000000Z",
      "update_time": "2025-01-15T08:05:00.000000Z"
    },
    {
      "id": "conv-uuid-2",
      "title": "Python script help",
      "create_time": "2025-01-14T12:00:00.000000Z",
      "update_time": "2025-01-14T12:10:00.000000Z"
    }
  ],
  "total": 150,
  "limit": 20,
  "offset": 0,
  "has_missing_conversations": false
}
```

## 6. 数据捕获实现策略

### 6.1 实时捕获（聊天时）

拦截 `POST /backend-api/conversation`：

1. 从请求体提取用户消息
2. 解析 SSE 响应获取 AI 回复
3. 等待 `status === "finished_successfully"` 或 `[DONE]`
4. 发送到后端存储

### 6.2 历史同步（可选功能）

1. 调用 `/backend-api/conversations` 获取会话列表
2. 对每个会话调用 `/backend-api/conversation/{id}`
3. 解析 mapping 结构提取消息
4. 存储到本地数据库

## 7. 参考资源

- [ninja](https://github.com/0x676e67/ninja) - ChatGPT 逆向代理
- [chatgpt-exporter](https://github.com/pionxzh/chatgpt-exporter) - 导出工具
