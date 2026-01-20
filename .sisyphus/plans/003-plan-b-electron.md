# 方案 B: Electron 迁移计划

> 状态: ⏸️ 待命 (如方案 A 失败则启动)
> 分支: `feature/electron-migration`
> 工作目录: `../anychat-electron/`
> 预估时间: 1-2 周

## 一、迁移策略

**渐进式迁移**: 先让 Electron 版本跑通数据捕获，再逐步迁移 UI。

```
Phase 1: 核心验证 (3天)
├── 新建 Electron 项目
├── 实现 <webview> + preload 数据捕获
└── 验证 ChatGPT/Claude/Gemini 数据获取

Phase 2: UI 迁移 (4天)
├── 迁移 React 组件
├── 适配 Electron IPC
└── 迁移 SQLite 数据层

Phase 3: 完善 (3天)
├── 系统托盘
├── 自动更新
└── 打包发布
```

## 二、项目结构

```
anychat-electron/
├── src/
│   ├── main/                      # 主进程
│   │   ├── index.ts               # 入口
│   │   ├── csp-bypass.ts          # CSP 绕过
│   │   ├── database.ts            # SQLite (better-sqlite3)
│   │   └── ipc-handlers.ts        # IPC 处理
│   ├── preload/                   # 预加载脚本
│   │   ├── index.ts               # 主窗口 preload
│   │   ├── webview-chatgpt.ts     # ChatGPT preload
│   │   ├── webview-claude.ts      # Claude preload
│   │   ├── webview-gemini.ts      # Gemini preload
│   │   └── common/                # 共享逻辑
│   │       ├── fetch-interceptor.ts
│   │       ├── sse-parser.ts
│   │       └── message-extractors.ts
│   └── renderer/                  # 渲染进程 (复用现有 React)
│       ├── components/            # 从 Tauri 版迁移
│       ├── stores/                # Zustand stores
│       └── ...
├── package.json
├── electron-builder.yml
└── tsconfig.json
```

## 三、核心实现

### 3.1 CSP 绕过 (主进程)

**文件**: `src/main/csp-bypass.ts`

```typescript
import { session } from 'electron';

/**
 * 设置 CSP 绕过
 * 拦截所有响应头，移除限制性安全头
 */
export function setupCSPBypass(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    
    // 删除 CSP 相关头
    const headersToRemove = [
      'content-security-policy',
      'content-security-policy-report-only',
      'x-frame-options',
      'x-webkit-csp',
      'x-content-security-policy',
    ];
    
    for (const header of headersToRemove) {
      delete headers[header];
      delete headers[header.toUpperCase()];
      // 处理大小写变体
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === header) {
          delete headers[key];
        }
      }
    }
    
    callback({ responseHeaders: headers });
  });
  
  console.log('[AnyChat] CSP bypass configured');
}
```

### 3.2 Preload 脚本 - Fetch 拦截

**文件**: `src/preload/common/fetch-interceptor.ts`

```typescript
import { ipcRenderer } from 'electron';

// API 配置 (复用 Tauri 版)
const API_PATTERNS = {
  'chatgpt.com': {
    pattern: /\/backend-api\/conversation(\/[a-f0-9-]{36})?$/,
    type: 'auto',
  },
  'claude.ai': {
    pattern: /\/api\/organizations\/.*\/chat_conversations\/.*\/completion/,
    type: 'sse',
  },
  'gemini.google.com': {
    pattern: /\/_\/BardChatUi\/data\/.*batchexecute/,
    type: 'json',
  },
};

function getApiConfig(): typeof API_PATTERNS[keyof typeof API_PATTERNS] | null {
  const hostname = window.location.hostname;
  for (const [domain, config] of Object.entries(API_PATTERNS)) {
    if (hostname.includes(domain.replace('www.', ''))) {
      return config;
    }
  }
  return null;
}

/**
 * 安装 Fetch 拦截器
 */
export function installFetchInterceptor(extractMessages: (events: any[], requestBody?: string) => any[]): void {
  const originalFetch = window.fetch;
  
  window.fetch = async function(...args: Parameters<typeof fetch>) {
    let requestBodyText: string | null = null;
    
    try {
      const request = args[0];
      const options = args[1] || {};
      
      if (options.body && typeof options.body === 'string') {
        requestBodyText = options.body;
      } else if (request instanceof Request && request.body) {
        const clonedReq = request.clone();
        requestBodyText = await clonedReq.text();
      }
    } catch (e) {
      // ignore
    }
    
    const response = await originalFetch.apply(this, args);
    
    try {
      const url = args[0] instanceof Request ? args[0].url : String(args[0]);
      const apiConfig = getApiConfig();
      
      if (apiConfig && apiConfig.pattern.test(url)) {
        console.log('[AnyChat] Intercepted API call:', url);
        
        const clone = response.clone();
        const contentType = clone.headers.get('content-type') || '';
        const isSSE = contentType.includes('text/event-stream');
        const isJSON = contentType.includes('application/json');
        
        if (isSSE || isJSON) {
          processResponse(clone, isSSE, requestBodyText, extractMessages);
        }
      }
    } catch (err) {
      console.log('[AnyChat] Fetch interception error:', err);
    }
    
    return response;
  };
  
  console.log('[AnyChat] Fetch interceptor installed');
}

async function processResponse(
  response: Response, 
  isSSE: boolean, 
  requestBody: string | null,
  extractMessages: (events: any[], requestBody?: string) => any[]
): Promise<void> {
  try {
    let messages: any[] = [];
    
    if (isSSE) {
      const events = await parseSSE(response);
      messages = extractMessages(events, requestBody || undefined);
    } else {
      const jsonText = await response.text();
      messages = extractMessages([{ data: JSON.parse(jsonText) }], requestBody || undefined);
    }
    
    if (messages.length > 0) {
      console.log('[AnyChat] Captured messages:', messages.length);
      
      // 通过 IPC 发送到宿主
      ipcRenderer.sendToHost('chat-captured', {
        serviceId: window.location.hostname,
        messages: messages,
        url: window.location.href,
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    console.log('[AnyChat] Response processing error:', err);
  }
}

async function parseSSE(response: Response): Promise<any[]> {
  const events: any[] = [];
  const reader = response.body?.getReader();
  if (!reader) return events;
  
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          events.push({ done: true });
          continue;
        }
        try {
          events.push({ data: JSON.parse(data) });
        } catch (e) {
          // ignore non-JSON
        }
      }
    }
  }
  
  return events;
}
```

### 3.3 Preload 入口 - ChatGPT

**文件**: `src/preload/webview-chatgpt.ts`

```typescript
import { installFetchInterceptor } from './common/fetch-interceptor';

// ChatGPT 消息提取器 (复用 Tauri 版逻辑)
function extractChatGPTMessages(events: any[], requestBody?: string): any[] {
  const messages: any[] = [];
  let conversationId: string | null = null;
  let finalAssistantMessage: any = null;
  
  for (const event of events) {
    if (event.done) continue;
    const data = event.data;
    
    if (data?.message) {
      const msg = data.message;
      conversationId = data.conversation_id || conversationId;
      
      if (msg.author?.role === 'assistant' && msg.content?.parts) {
        finalAssistantMessage = {
          id: msg.id,
          role: 'assistant',
          content: msg.content.parts.join(''),
          model: msg.metadata?.model_slug,
          status: msg.status,
        };
      }
    }
  }
  
  if (finalAssistantMessage?.content?.trim()) {
    messages.push({
      role: finalAssistantMessage.role,
      content: finalAssistantMessage.content.trim(),
      externalId: finalAssistantMessage.id,
      conversationId,
      model: finalAssistantMessage.model,
      timestamp: Date.now(),
      source: 'api',
    });
  }
  
  // 提取用户消息
  if (requestBody) {
    try {
      const reqData = JSON.parse(requestBody);
      if (reqData.messages?.[0]) {
        const userMsg = reqData.messages[0];
        const userContent = userMsg.content?.parts?.join('') || '';
        
        if (userContent.trim()) {
          messages.unshift({
            role: 'user',
            content: userContent.trim(),
            externalId: userMsg.id,
            conversationId: conversationId || reqData.conversation_id,
            timestamp: Date.now() - 1,
            source: 'api',
          });
        }
      }
    } catch (e) {
      // ignore
    }
  }
  
  return messages;
}

// 安装拦截器
installFetchInterceptor(extractChatGPTMessages);

console.log('[AnyChat] ChatGPT preload initialized');
```

### 3.4 主窗口 - Webview 容器

**文件**: `src/renderer/components/WebViewContainer.tsx`

```tsx
import React, { useRef, useEffect, useCallback } from 'react';

interface WebViewContainerProps {
  service: {
    id: string;
    url: string;
    name: string;
  };
  isActive: boolean;
  onDataCaptured: (data: any) => void;
}

export function WebViewContainer({ service, isActive, onDataCaptured }: WebViewContainerProps) {
  const webviewRef = useRef<Electron.WebviewTag>(null);
  
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    
    const handleIpcMessage = (event: Electron.IpcMessageEvent) => {
      if (event.channel === 'chat-captured') {
        onDataCaptured(event.args[0]);
      }
    };
    
    const handleDomReady = () => {
      console.log(`[AnyChat] Webview ready: ${service.id}`);
    };
    
    webview.addEventListener('ipc-message', handleIpcMessage);
    webview.addEventListener('dom-ready', handleDomReady);
    
    return () => {
      webview.removeEventListener('ipc-message', handleIpcMessage);
      webview.removeEventListener('dom-ready', handleDomReady);
    };
  }, [service.id, onDataCaptured]);
  
  // 获取 preload 路径
  const preloadPath = `file://${__dirname}/../preload/webview-${service.id}.js`;
  
  return (
    <webview
      ref={webviewRef}
      src={service.url}
      preload={preloadPath}
      style={{
        width: '100%',
        height: '100%',
        display: isActive ? 'flex' : 'none',
      }}
      allowpopups
      webpreferences="contextIsolation=yes"
    />
  );
}
```

### 3.5 主进程入口

**文件**: `src/main/index.ts`

```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { setupCSPBypass } from './csp-bypass';
import { initDatabase, saveMessages } from './database';

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  // 设置 CSP 绕过
  setupCSPBypass();
  
  // 初始化数据库
  await initDatabase();
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,  // 启用 webview
    },
  });
  
  // 加载前端
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

// IPC 处理
ipcMain.on('save-chat-messages', async (event, data) => {
  try {
    await saveMessages(data.serviceId, data.messages);
    event.reply('save-chat-messages-result', { success: true });
  } catch (error) {
    event.reply('save-chat-messages-result', { success: false, error: String(error) });
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

## 四、代码复用清单

| 模块 | 来源文件 | 复用程度 | 说明 |
|------|----------|----------|------|
| Fetch 拦截器 | `lib.rs` AUTH_SCRIPT | 100% | 直接复用逻辑 |
| SSE 解析器 | `lib.rs` parseSSEStream | 100% | 直接复用 |
| ChatGPT 提取器 | `lib.rs` extractChatGPTMessages | 100% | 直接复用 |
| Claude 提取器 | `lib.rs` extractClaudeMessages | 100% | 直接复用 |
| Gemini 提取器 | `lib.rs` extractGeminiMessages | 100% | 直接复用 |
| React 组件 | `src/components/` | 90% | 少量适配 |
| Zustand Store | `src/stores/app-store.ts` | 80% | 移除 Tauri 依赖 |
| 数据库操作 | `src/services/database.ts` | 60% | 改用 better-sqlite3 |

## 五、依赖清单

**package.json**:

```json
{
  "name": "anychat-electron",
  "version": "0.1.0",
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.0",
    "electron-store": "^8.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0",
    "lucide-react": "^0.300.0"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.9.0",
    "electron-vite": "^2.0.0",
    "@electron/rebuild": "^3.6.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.2.0"
  }
}
```

## 六、注意事项

1. **Webview 标签**: Electron 官方虽不推荐，但对于此用例是最佳选择
2. **Context Isolation**: 确保 `contextIsolation: true`
3. **安全性**: Preload 中不暴露过多 Node.js API
4. **内存管理**: 及时销毁不使用的 webview
5. **打包**: 使用 electron-builder，配置 ASAR

## 七、验证清单

| 验证项 | 状态 | 备注 |
|--------|------|------|
| CSP 绕过生效 | ⏸️ | 检查 Network 面板 |
| ChatGPT 数据捕获 | ⏸️ | Console 日志 |
| Claude 数据捕获 | ⏸️ | Console 日志 |
| Gemini 数据捕获 | ⏸️ | Console 日志 |
| 数据写入 SQLite | ⏸️ | 检查数据库文件 |
| macOS 打包 | ⏸️ | DMG 安装测试 |
| Windows 打包 | ⏸️ | NSIS 安装测试 |

## 八、启动条件

当以下任一情况发生时，启动此方案：

1. 方案 A (MITM) 的 `proxy_url` 完全不工作
2. 方案 A 的证书信任流程导致严重用户体验问题
3. 方案 A 2 周内无法完成验证
4. 用户明确要求使用 Electron
