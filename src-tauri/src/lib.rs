use std::collections::HashSet;
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    webview::WebviewBuilder,
    Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use warp::Filter;

const SIDEBAR_WIDTH: f64 = 64.0;

#[cfg(target_os = "macos")]
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15";

#[cfg(target_os = "windows")]
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

#[cfg(target_os = "linux")]
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const AUTH_SCRIPT: &str = r#"
(function() {
    // Mark script injection success
    window.__anychatInjected = true;
    window.__anychatTimestamp = Date.now();
    console.log('[AnyChat] Script injected at:', window.location.hostname, 'time:', new Date().toISOString());

    // ============================================================
    // 1. WebAuthn/Passkeys 禁用（保留原有逻辑）
    // ============================================================
    if (navigator.credentials) {
        const disabledCredentials = {
            create: function() { 
                console.log('[AnyChat] WebAuthn create blocked - use password login');
                return Promise.reject(new DOMException('NotSupportedError', 'NotSupportedError'));
            },
            get: function() { 
                console.log('[AnyChat] WebAuthn get blocked - use password login');
                return Promise.reject(new DOMException('NotSupportedError', 'NotSupportedError'));
            },
            store: function() { 
                return Promise.reject(new DOMException('NotSupportedError', 'NotSupportedError'));
            },
            preventSilentAccess: function() { 
                return Promise.resolve();
            }
        };
        
        try {
            Object.defineProperty(navigator, 'credentials', {
                get: function() { return disabledCredentials; },
                configurable: true
            });
            console.log('[AnyChat] WebAuthn/Passkeys disabled');
        } catch (e) {
            console.log('[AnyChat] Could not disable WebAuthn:', e);
        }
    }
    
    if (window.PublicKeyCredential) {
        try {
            Object.defineProperty(window, 'PublicKeyCredential', {
                get: function() { return undefined; },
                configurable: true
            });
            console.log('[AnyChat] PublicKeyCredential disabled');
        } catch (e) {}
    }

    // ============================================================
    // 2. OAuth 弹窗支持（保留原有逻辑）
    // ============================================================
    const AUTH_DOMAINS = [
        'accounts.google.com',
        'login.microsoftonline.com',
        'github.com',
        'appleid.apple.com',
        'facebook.com',
        'twitter.com',
        'auth0.com'
    ];
    
    const AUTH_PATHS = ['/oauth/', '/auth/', '/authorize', '/login', '/signin', '/o/oauth2'];
    
    window.__isAuthUrl = function(url) {
        try {
            const urlObj = new URL(url, window.location.href);
            const hostname = urlObj.hostname.toLowerCase();
            const pathname = urlObj.pathname.toLowerCase();
            
            for (const domain of AUTH_DOMAINS) {
                if (hostname.includes(domain)) return true;
            }
            
            for (const path of AUTH_PATHS) {
                if (pathname.includes(path)) return true;
            }
            
            return false;
        } catch (e) {
            return false;
        }
    };
    
    window.__isAuthPopup = function(url, name) {
        const authWindowNames = ['oauth2', 'oauth', 'google-auth', 'auth-popup', 'signin', 'login', 'AppleAuthentication'];
        if (name && authWindowNames.includes(name)) return true;
        return window.__isAuthUrl(url);
    };
    
    const originalWindowOpen = window.open;
    window.open = function(url, name, specs) {
        if (window.__isAuthPopup(url, name)) {
            console.log('[AnyChat] Allowing OAuth popup:', url);
            return originalWindowOpen.call(window, url, name, specs);
        }
        return originalWindowOpen.call(window, url, name, specs);
    };

    // ============================================================
    // 3. 数据捕获核心状态
    // ============================================================
    window.__anychat = {
        capturedHashes: new Set(),
        pendingMessages: [],
        conversationId: null,
        ipcAvailable: false
    };

    // ============================================================
    // 4. 数据队列（CSP-safe：无网络请求，Rust 轮询读取）
    // ============================================================
    window.__anychatQueue = [];
    
    function sendToBackend(payload) {
        const entry = {
            serviceId: payload.serviceId,
            messages: payload.messages,
            url: window.location.href,
            timestamp: Date.now()
        };
        window.__anychatQueue.push(entry);
        console.log('[AnyChat] Queued', payload.messages?.length || 0, 'messages (total queue:', window.__anychatQueue.length + ')');
        return true;
    }
    }

    // ============================================================
    // 5. API 端点匹配配置
    // ============================================================
    const API_PATTERNS = {
        'chatgpt.com': {
            // POST /backend-api/conversation (发送消息, SSE)
            // GET /backend-api/conversation/{uuid} (获取历史, JSON)
            pattern: /\/backend-api\/conversation(\/[a-f0-9-]{36})?$/,
            type: 'auto',
            extractMessages: extractChatGPTMessages
        },
        'claude.ai': {
            pattern: /\/api\/organizations\/.*\/chat_conversations\/.*\/completion/,
            type: 'sse',
            extractMessages: extractClaudeMessages
        },
        'gemini.google.com': {
            pattern: /\/_\/BardChatUi\/data\/.*batchexecute/,
            type: 'json',
            extractMessages: extractGeminiMessages
        },
        'chat.deepseek.com': {
            pattern: /\/api\/.*chat/i,
            type: 'sse',
            extractMessages: extractGenericSSEMessages
        }
    };

    function getApiConfig() {
        const hostname = window.location.hostname;
        for (const [domain, config] of Object.entries(API_PATTERNS)) {
            if (hostname.includes(domain.replace('www.', ''))) {
                return config;
            }
        }
        return null;
    }

    // ============================================================
    // 6. SSE 流解析器
    // ============================================================
    async function parseSSEStream(reader, onEvent) {
        const decoder = new TextDecoder();
        let buffer = '';
        
        try {
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
                            onEvent({ done: true });
                            continue;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            onEvent({ data: parsed });
                        } catch (e) {
                            // 非 JSON 数据，忽略
                        }
                    }
                }
            }
        } catch (err) {
            console.log('[AnyChat] SSE parsing error:', err);
        }
    }

    // ChatGPT SSE: message.content.parts contains accumulated full text
    // Stream ends with message.status === "finished_successfully" or data: [DONE]
    function extractChatGPTMessages(events, requestBody) {
        const messages = [];
        let conversationId = null;
        let finalAssistantMessage = null;
        
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
                        status: msg.status
                    };
                }
            }
        }
        
        if (finalAssistantMessage && finalAssistantMessage.content?.trim()) {
            messages.push({
                role: finalAssistantMessage.role,
                content: finalAssistantMessage.content.trim(),
                externalId: finalAssistantMessage.id,
                conversationId: conversationId,
                model: finalAssistantMessage.model,
                timestamp: Date.now(),
                source: 'api'
            });
        }
        
        if (requestBody) {
            try {
                const reqData = typeof requestBody === 'string' 
                    ? JSON.parse(requestBody) 
                    : requestBody;
                    
                if (reqData.messages && reqData.messages[0]) {
                    const userMsg = reqData.messages[0];
                    const userContent = userMsg.content?.parts?.join('') || '';
                    
                    if (userContent?.trim()) {
                        messages.unshift({
                            role: 'user',
                            content: userContent.trim(),
                            externalId: userMsg.id,
                            conversationId: conversationId || reqData.conversation_id,
                            timestamp: Date.now() - 1,
                            source: 'api'
                        });
                    }
                }
            } catch (e) {
                console.log('[AnyChat] Failed to parse request body:', e);
            }
        }
        
        return messages;
    }

    // ============================================================
    // 7b. ChatGPT 历史对话 JSON 提取器
    // ============================================================
    function extractChatGPTHistoryMessages(jsonText) {
        const messages = [];
        try {
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
                        source: 'history'
                    });
                }
                
                messages.sort((a, b) => a.timestamp - b.timestamp);
            }
        } catch (e) {
            console.log('[AnyChat] Failed to parse ChatGPT history:', e);
        }
        return messages;
    }

    // ============================================================
    // 8. Claude 消息提取器
    // ============================================================
    function extractClaudeMessages(events, requestBodyText) {
        const messages = [];
        let content = '';
        let conversationId = null;
        
        if (requestBodyText) {
            try {
                const reqData = JSON.parse(requestBodyText);
                if (reqData.prompt) {
                    messages.push({
                        role: 'user',
                        content: reqData.prompt.trim(),
                        timestamp: Date.now() - 1,
                        source: 'api'
                    });
                }
                conversationId = reqData.conversation_uuid;
            } catch (e) {}
        }
        
        for (const event of events) {
            if (event.done) continue;
            const data = event.data;
            
            if (data?.completion) {
                content += data.completion;
            } else if (data?.delta?.text) {
                content += data.delta.text;
            } else if (data?.content_block?.text) {
                content += data.content_block.text;
            }
        }
        
        if (content && content.trim()) {
            messages.push({
                role: 'assistant',
                content: content.trim(),
                conversationId: conversationId,
                timestamp: Date.now(),
                source: 'api'
            });
        }
        
        return messages;
    }

    // ============================================================
    // 9. Gemini 消息提取器（BatchExecute 格式）
    // ============================================================
    function extractGeminiMessages(jsonData) {
        const messages = [];
        try {
            // Gemini 使用复杂的嵌套数组格式
            // 通常响应结构为: )]}\n[[["wrb.fr",...,[[text]],...]]
            let text = '';
            
            if (typeof jsonData === 'string') {
                // 移除安全前缀
                const cleaned = jsonData.replace(/^\)\]\}'\n?/, '');
                const parsed = JSON.parse(cleaned);
                // 尝试提取文本（位置可能变化）
                if (Array.isArray(parsed) && parsed[0] && parsed[0][2]) {
                    const innerData = JSON.parse(parsed[0][2]);
                    if (innerData && innerData[4]) {
                        text = innerData[4][0]?.[1]?.[0] || '';
                    }
                }
            }
            
            if (text && text.trim()) {
                messages.push({
                    role: 'assistant',
                    content: text.trim(),
                    timestamp: Date.now()
                });
            }
        } catch (e) {
            console.log('[AnyChat] Gemini parsing error:', e);
        }
        return messages;
    }

    // ============================================================
    // 10. 通用 SSE 消息提取器
    // ============================================================
    function extractGenericSSEMessages(events) {
        const messages = [];
        let content = '';
        
        for (const event of events) {
            if (event.done) continue;
            const data = event.data;
            
            // 尝试多种常见格式
            if (data?.choices?.[0]?.delta?.content) {
                content += data.choices[0].delta.content;
            } else if (data?.message?.content) {
                content += data.message.content;
            } else if (data?.text) {
                content += data.text;
            } else if (data?.content) {
                content += data.content;
            }
        }
        
        if (content && content.trim()) {
            messages.push({
                role: 'assistant',
                content: content.trim(),
                timestamp: Date.now()
            });
        }
        
        return messages;
    }

    // ============================================================
    // 11. Fetch 拦截器（核心）
    // ============================================================
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        let requestBodyText = null;
        
        try {
            const request = args[0];
            const options = args[1] || {};
            
            if (options.body && typeof options.body === 'string') {
                requestBodyText = options.body;
            } else if (request instanceof Request && request.body) {
                const clonedReq = request.clone();
                requestBodyText = await clonedReq.text();
            }
        } catch (e) {}
        
        const response = await originalFetch.apply(this, args);
        
        try {
            const url = args[0] instanceof Request ? args[0].url : String(args[0]);
            const apiConfig = getApiConfig();
            
            if (apiConfig && apiConfig.pattern.test(url)) {
                console.log('[AnyChat] Intercepted API call:', url);
                
                const clone = response.clone();
                
                (async () => {
                    try {
                        const contentType = clone.headers.get('content-type') || '';
                        const isSSE = contentType.includes('text/event-stream');
                        const isJSON = contentType.includes('application/json');
                        
                        console.log('[AnyChat] Response type:', contentType, 'isSSE:', isSSE, 'isJSON:', isJSON);
                        
                        let messages = [];
                        
                        if (isSSE) {
                            const events = [];
                            await parseSSEStream(clone.body.getReader(), (event) => {
                                events.push(event);
                            });
                            console.log('[AnyChat] SSE events collected:', events.length);
                            messages = apiConfig.extractMessages(events, requestBodyText);
                        } else if (isJSON) {
                            const jsonText = await clone.text();
                            console.log('[AnyChat] JSON response length:', jsonText.length);
                            messages = extractChatGPTHistoryMessages(jsonText);
                        }
                        
                        if (messages.length > 0) {
                            console.log('[AnyChat] Captured messages:', messages.length);
                            await sendToBackend({
                                serviceId: window.location.hostname,
                                messages: messages
                            });
                        }
                    } catch (err) {
                        console.log('[AnyChat] Response processing error:', err);
                    }
                })();
            }
        } catch (err) {
            console.log('[AnyChat] Fetch interception error:', err);
        }
        
        return response;
    };

    // ============================================================
    // 12. DOM 捕获（兜底方案）
    // ============================================================
    const CHAT_SELECTORS = {
        'chatgpt.com': {
            container: '[data-testid="conversation-turn"]',
            userMessage: '[data-message-author-role="user"]',
            assistantMessage: '[data-message-author-role="assistant"]',
            content: '.markdown'
        },
        'gemini.google.com': {
            container: '.conversation-container',
            userMessage: '.query-content',
            assistantMessage: '.response-container',
            content: '.markdown'
        },
        'chat.deepseek.com': {
            container: '.message-item',
            userMessage: '.user-message',
            assistantMessage: '.assistant-message', 
            content: '.message-content'
        },
        'claude.ai': {
            container: '[data-testid="conversation-turn"]',
            userMessage: '.human-message',
            assistantMessage: '.assistant-message',
            content: '.prose'
        },
        'chat.qwen.ai': {
            container: '[class*="chat-message"]',
            userMessage: '[class*="user"]',
            assistantMessage: '[class*="assistant"]',
            content: '[class*="content"]'
        },
        'kimi.moonshot.cn': {
            container: '[class*="message-item"]',
            userMessage: '[class*="user"]',
            assistantMessage: '[class*="assistant"]',
            content: '[class*="content"]'
        },
        'poe.com': {
            container: '[class*="Message_"]',
            userMessage: '[class*="human"]',
            assistantMessage: '[class*="bot"]',
            content: '[class*="Markdown"]'
        },
        'perplexity.ai': {
            container: '[class*="prose"]',
            userMessage: '[class*="user"]',
            assistantMessage: '[class*="prose"]',
            content: '[class*="prose"]'
        }
    };

    function getHostConfig() {
        const hostname = window.location.hostname;
        for (const [domain, config] of Object.entries(CHAT_SELECTORS)) {
            if (hostname.includes(domain.replace('www.', ''))) {
                return config;
            }
        }
        return null;
    }

    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(16);
    }

    function captureMessagesFromDOM() {
        const config = getHostConfig();
        if (!config) return;
        
        const messages = [];
        const containers = document.querySelectorAll(config.container);
        
        containers.forEach((container, index) => {
            let role = 'unknown';
            let content = '';
            
            if (config.userMessage && container.querySelector(config.userMessage)) {
                role = 'user';
                const contentEl = container.querySelector(config.content) || container.querySelector(config.userMessage);
                content = contentEl?.innerText || contentEl?.textContent || '';
            } else if (config.assistantMessage && container.querySelector(config.assistantMessage)) {
                role = 'assistant';
                const contentEl = container.querySelector(config.content) || container.querySelector(config.assistantMessage);
                content = contentEl?.innerText || contentEl?.textContent || '';
            }
            
            if (content && content.trim().length > 0 && role !== 'unknown') {
                const hash = hashString(content.trim());
                if (!window.__anychat.capturedHashes.has(hash)) {
                    window.__anychat.capturedHashes.add(hash);
                    messages.push({
                        role: role,
                        content: content.trim(),
                        index: index,
                        timestamp: Date.now(),
                        source: 'dom'
                    });
                }
            }
        });
        
        if (messages.length > 0) {
            console.log('[AnyChat] DOM captured', messages.length, 'messages (fallback)');
            sendToBackend({
                serviceId: window.location.hostname,
                messages: messages
            });
        }
    }

    // DOM Observer 作为兜底
    function setupDOMFallback() {
        const config = getHostConfig();
        if (!config) {
            console.log('[AnyChat] No DOM config for this site');
            return;
        }
        
        // 如果 API 拦截工作正常，减少 DOM 捕获频率
        let domCaptureInterval = 10000; // 默认 10 秒检查一次
        
        const observer = new MutationObserver(() => {
            // 仅在没有 API 捕获时触发 DOM 捕获
            if (!window.__anychat.ipcAvailable) {
                setTimeout(captureMessagesFromDOM, 1000);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        // 初始捕获
        setTimeout(captureMessagesFromDOM, 3000);
        
        console.log('[AnyChat] DOM fallback observer started');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupDOMFallback);
    } else {
        setTimeout(setupDOMFallback, 1000);
    }

    console.log('[AnyChat] Data capture script initialized (Fetch interception + DOM fallback)');
})();
"#;

struct AppState {
    created_webviews: Mutex<HashSet<String>>,
    setup_complete: Mutex<bool>,
}

#[cfg(debug_assertions)]
fn should_open_devtools() -> bool {
    match std::env::var("ANYCHAT_OPEN_DEVTOOLS") {
        Ok(v) => v == "1" || v.eq_ignore_ascii_case("true"),
        Err(_) => false,
    }
}

fn compute_webview_bounds(window: &tauri::Window) -> Result<(PhysicalPosition<i32>, PhysicalSize<u32>), String> {
    let win_size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().unwrap_or(1.0);

    let sidebar_width_physical = (SIDEBAR_WIDTH * scale).round().max(0.0) as u32;
    let x = sidebar_width_physical.min(win_size.width) as i32;
    let width = win_size.width.saturating_sub(sidebar_width_physical);

    Ok((
        PhysicalPosition::new(x, 0),
        PhysicalSize::new(width, win_size.height),
    ))
}

fn is_auth_url(url: &str) -> bool {
    let auth_domains = [
        "accounts.google.com",
        "login.microsoftonline.com",
        "github.com/login",
        "appleid.apple.com",
        "facebook.com",
        "twitter.com",
        "auth0.com",
    ];

    let auth_paths = ["/oauth/", "/auth/", "/authorize", "/login", "/signin", "/o/oauth2"];

    for domain in &auth_domains {
        if url.contains(domain) {
            return true;
        }
    }

    for path in &auth_paths {
        if url.contains(path) {
            return true;
        }
    }

    false
}

fn should_allow_new_window(url: &str) -> bool {
    !is_auth_url(url)
}

#[cfg(test)]
mod tests {
    use super::should_allow_new_window;

    #[test]
    fn denies_new_window_for_auth_domains() {
        assert!(!should_allow_new_window("https://accounts.google.com/o/oauth2/v2/auth"));
    }

    #[test]
    fn allows_new_window_for_non_auth_domains() {
        assert!(should_allow_new_window("https://example.com"));
    }
}

fn show_main_window(app_handle: &tauri::AppHandle) {
    match app_handle.get_webview_window("main") {
        Some(w) => {
            println!("[AnyChat] show_main_window: restoring main window");
            if let Err(e) = w.show() {
                println!("[AnyChat] show_main_window: show failed: {}", e);
            }
            let _ = w.unminimize();
            let _ = w.center();
            if let Err(e) = w.set_focus() {
                println!("[AnyChat] show_main_window: set_focus failed: {}", e);
            }

            // On macOS, occasionally the window can be "shown" but still not brought to front.
            // Toggling always-on-top is a pragmatic nudge.
            #[cfg(target_os = "macos")]
            {
                let _ = w.set_always_on_top(true);
                let _ = w.set_always_on_top(false);
            }
        }
        None => {
            // In some edge cases, Tauri can have a window label reserved while the webview window handle
            // is not available. Prefer restoring via Window handle if present.
            if let Some(w) = app_handle.get_window("main") {
                println!("[AnyChat] show_main_window: restoring via Window handle");
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.center();
                let _ = w.set_focus();
                #[cfg(target_os = "macos")]
                {
                    let _ = w.set_always_on_top(true);
                    let _ = w.set_always_on_top(false);
                }
                return;
            }

            let existing_webview_windows: Vec<String> =
                app_handle.webview_windows().keys().cloned().collect();
            let existing_windows: Vec<String> = app_handle.windows().keys().cloned().collect();
            println!(
                "[AnyChat] show_main_window: main window not found, windows={:?}, webview_windows={:?}",
                existing_windows, existing_webview_windows
            );

            // The window may have been closed/destroyed by the OS. Re-create it on demand.
            let recreate = || {
                WebviewWindowBuilder::new(app_handle, "main", WebviewUrl::App("index.html".into()))
                .title("")
                .inner_size(1200.0, 800.0)
                .min_inner_size(800.0, 600.0)
                .build()
            };

            match recreate() {
                Ok(w) => {
                    println!("[AnyChat] show_main_window: main window re-created");

                    // Re-attach resize handler for child webviews (since this is a new window).
                    let app_handle_clone = app_handle.clone();
                    let window = w.as_ref().window();
                    window.on_window_event(move |event| {
                        if let WindowEvent::Resized(_) = event {
                            if let Some(main_w) = app_handle_clone.get_webview_window("main") {
                                let window = main_w.as_ref().window();
                                let (pos, size) = match compute_webview_bounds(&window) {
                                    Ok(v) => v,
                                    Err(e) => {
                                        println!(
                                            "[AnyChat] Failed to compute webview bounds on resize: {}",
                                            e
                                        );
                                        return;
                                    }
                                };

                                let state = app_handle_clone.state::<AppState>();
                                let created = state.created_webviews.lock().unwrap();
                                for label in created.iter() {
                                    if let Some(webview) = app_handle_clone.get_webview(label) {
                                        let _ = webview.set_position(pos);
                                        let _ = webview.set_size(size);
                                    }
                                }
                            }
                        }
                    });

                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
                Err(e) => {
                    println!(
                        "[AnyChat] show_main_window: failed to re-create main window: {}",
                        e
                    );

                    // Sometimes Tauri reports the label as already taken while the window handle is missing.
                    // Try to close the orphaned webview and recreate once more.
                    let err = e.to_string();
                    if err.contains("label `main` already exists")
                        || err.contains("window with label `main` already exists")
                    {
                        if let Some(orphan_window) = app_handle.get_window("main") {
                            println!(
                                "[AnyChat] show_main_window: found orphan window `main`, trying to show"
                            );
                            let _ = orphan_window.show();
                            let _ = orphan_window.unminimize();
                            let _ = orphan_window.center();
                            let _ = orphan_window.set_focus();
                            return;
                        }

                        if let Some(orphan) = app_handle.get_webview("main") {
                            println!(
                                "[AnyChat] show_main_window: found orphan webview `main`, closing..."
                            );
                            let _ = orphan.close();
                        } else {
                            println!(
                                "[AnyChat] show_main_window: no webview `main` found despite label conflict"
                            );
                        }

                        match recreate() {
                            Ok(w) => {
                                println!(
                                    "[AnyChat] show_main_window: main window re-created after closing orphan"
                                );
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.center();
                                let _ = w.set_focus();
                            }
                            Err(e2) => {
                                println!(
                                    "[AnyChat] show_main_window: still failed to re-create main window: {}",
                                    e2
                                );
                            }
                        }
                    }
                }
            }
        }
    }
}

fn create_webview_for_service(
    app: &tauri::AppHandle,
    label: &str,
    url: &str,
    state: &AppState,
    // Use Window here because the main window hosts multiple webviews (add_child).
    window: &tauri::Window,
) -> Result<(), String> {
    println!("[AnyChat] create_webview_for_service: creating {} -> {}", label, url);

    let (pos, size) = compute_webview_bounds(window)?;

    let app_handle_clone = app.clone();
    let parsed_url: tauri::Url = url.parse().map_err(|e| format!("{}", e))?;

    let webview_builder = WebviewBuilder::new(label, WebviewUrl::External(parsed_url))
        .user_agent(USER_AGENT)
        .initialization_script(AUTH_SCRIPT)
        .on_navigation(|url| {
            let url_str = url.as_str();
            if is_auth_url(url_str) {
                #[cfg(debug_assertions)]
                println!("[AnyChat] Allowing OAuth navigation to: {}", url_str);
            }
            true
        })
        .on_new_window(move |url, _features| {
            #[cfg(debug_assertions)]
            println!("[AnyChat] New window requested: {}", url);

            if is_auth_url(url.as_str()) {
                #[cfg(debug_assertions)]
                println!("[AnyChat] Creating OAuth popup window");

                let popup_label = format!(
                    "oauth-{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis()
                );

                let _ = WebviewWindowBuilder::new(
                    &app_handle_clone,
                    &popup_label,
                    WebviewUrl::External(url.clone()),
                )
                .title("Sign In")
                .inner_size(500.0, 700.0)
                .center()
                .user_agent(USER_AGENT)
                .initialization_script(AUTH_SCRIPT)
                .build();
            }

            if should_allow_new_window(url.as_str()) {
                tauri::webview::NewWindowResponse::Allow
            } else {
                tauri::webview::NewWindowResponse::Deny
            }
        });

    println!("[AnyChat] create_webview_for_service: calling add_child");

    let webview = window
        .add_child(
            webview_builder,
            pos,
            size,
        )
        .map_err(|e| {
            println!("[AnyChat] add_child failed: {}", e);
            e.to_string()
        })?;

    // Some platforms/versions may not apply the initial bounds reliably. Enforce once right away.
    let _ = webview.set_position(pos);
    let _ = webview.set_size(size);

    let mut created = state.created_webviews.lock().unwrap();
    created.insert(label.to_string());

    println!("[AnyChat] Created webview: {} -> {}", label, url);

    #[cfg(debug_assertions)]
    if should_open_devtools() {
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.open_devtools();
            println!("[AnyChat] DevTools opened for webview: {}", label);
        }
    }

    Ok(())
}

#[tauri::command]
fn switch_webview(
    // Use Window instead of WebviewWindow to avoid IPC failure in multi-webview windows.
    parent: tauri::Window,
    app: tauri::AppHandle,
    label: String,
    url: String,
) -> Result<(), String> {
    println!("[AnyChat] switch_webview called: label={}, url={}, parent={}", label, url, parent.label());
    
    let state = app.state::<AppState>();
    
    {
        let setup_complete = state.setup_complete.lock().unwrap();
        if !*setup_complete {
            println!("[AnyChat] Setup not complete yet, skipping switch_webview");
            return Ok(());
        }
    }

    {
        let created = state.created_webviews.lock().unwrap();
        for existing_label in created.iter() {
            if let Some(webview) = app.get_webview(existing_label) {
                let _ = webview.hide();
            }
        }
    }

    if app.get_webview(&label).is_none() {
        println!("[AnyChat] Webview {} not found, creating...", label);
        match create_webview_for_service(&app, &label, &url, &state, &parent) {
            Ok(_) => println!("[AnyChat] Successfully created webview: {}", label),
            Err(e) => {
                println!("[AnyChat] ERROR creating webview {}: {}", label, e);
                return Err(e);
            }
        }
    } else {
        println!("[AnyChat] Webview {} already exists", label);
    }

    if let Some(webview) = app.get_webview(&label) {
        if let Ok((pos, size)) = compute_webview_bounds(&parent) {
            let _ = webview.set_position(pos);
            let _ = webview.set_size(size);
        }
        let _ = webview.show();
        let _ = webview.set_focus();
        println!("[AnyChat] Showing webview: {}", label);
    } else {
        println!("[AnyChat] ERROR: Failed to get webview after creation: {}", label);
    }

    Ok(())
}

#[tauri::command]
fn refresh_webview(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        if let Ok(url) = webview.url() {
            let _ = webview.navigate(url);
        }
    }
    Ok(())
}

#[tauri::command]
fn hide_all_webviews(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let created = state.created_webviews.lock().unwrap();

    for label in created.iter() {
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.hide();
        }
    }
    Ok(())
}

#[derive(serde::Deserialize, serde::Serialize, Clone)]
struct CapturedMessage {
    role: String,
    content: String,
    #[serde(default)]
    #[allow(dead_code)]
    index: Option<i32>,
    #[serde(default)]
    #[allow(dead_code)]
    timestamp: Option<i64>,
    #[serde(rename = "externalId")]
    #[serde(default)]
    external_id: Option<String>,
    #[serde(default)]
    source: Option<String>,
}

#[derive(serde::Serialize, Clone)]
struct ChatCaptureEvent {
    service_id: String,
    messages: Vec<CapturedMessage>,
}

#[tauri::command]
async fn capture_chat_message(
    app: tauri::AppHandle,
    service_id: String,
    messages: Vec<CapturedMessage>,
) -> Result<(), String> {
    println!(
        "[AnyChat] capture_chat_message called: service={}, count={}",
        service_id,
        messages.len()
    );
    
    for msg in &messages {
        println!(
            "[AnyChat] Captured: [{}] {}...",
            msg.role,
            msg.content.chars().take(50).collect::<String>()
        );
    }
    
    app.emit("chat-captured", ChatCaptureEvent {
        service_id: service_id.clone(),
        messages: messages.clone(),
    }).map_err(|e| e.to_string())?;
    
    if let Ok(app_data_dir) = std::env::var("HOME") {
        let log_path = format!(
            "{}/Library/Application Support/com.anychat.app/captured_chats.jsonl",
            app_data_dir
        );
        
        let dir_path = format!(
            "{}/Library/Application Support/com.anychat.app",
            app_data_dir
        );
        let _ = std::fs::create_dir_all(&dir_path);
        
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            use std::io::Write;
            for msg in messages {
                let entry = serde_json::json!({
                    "service_id": service_id,
                    "role": msg.role,
                    "content": msg.content,
                    "external_id": msg.external_id,
                    "source": msg.source.unwrap_or_else(|| "api".to_string()),
                    "captured_at": chrono::Utc::now().to_rfc3339()
                });
                let _ = writeln!(file, "{}", entry.to_string());
            }
        }
    }
    
    Ok(())
}

#[derive(serde::Deserialize, Clone)]
struct CapturePayload {
    #[serde(rename = "type")]
    _type: Option<String>,
    #[serde(rename = "serviceId")]
    service_id: String,
    url: Option<String>,
    messages: Vec<CapturedMessage>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("anychat", |_ctx, request| {
            let path = request.uri().path();
            
            if path == "/capture" {
                let body = request.body();
                
                match serde_json::from_slice::<CapturePayload>(body) {
                    Ok(payload) => {
                        println!(
                            "[AnyChat] Protocol received: service={}, messages={}",
                            payload.service_id,
                            payload.messages.len()
                        );
                        
                        for msg in &payload.messages {
                            println!(
                                "[AnyChat] Message: [{}] {}...",
                                msg.role,
                                msg.content.chars().take(50).collect::<String>()
                            );
                        }
                        
                        if let Ok(home_dir) = std::env::var("HOME") {
                            let dir_path = format!(
                                "{}/Library/Application Support/com.anychat.app",
                                home_dir
                            );
                            let _ = std::fs::create_dir_all(&dir_path);
                            
                            let log_path = format!(
                                "{}/Library/Application Support/com.anychat.app/captured_chats.jsonl",
                                home_dir
                            );
                            
                            if let Ok(mut file) = std::fs::OpenOptions::new()
                                .create(true)
                                .append(true)
                                .open(&log_path)
                            {
                                use std::io::Write;
                                for msg in &payload.messages {
                                    let entry = serde_json::json!({
                                        "service_id": payload.service_id,
                                        "url": payload.url,
                                        "role": msg.role,
                                        "content": msg.content,
                                        "external_id": msg.external_id,
                                        "source": msg.source.clone().unwrap_or_else(|| "protocol".to_string()),
                                        "captured_at": chrono::Utc::now().to_rfc3339()
                                    });
                                    let _ = writeln!(file, "{}", entry.to_string());
                                }
                                println!("[AnyChat] Saved {} messages to JSONL", payload.messages.len());
                            }
                        }
                        
                        http::Response::builder()
                            .status(200)
                            .header("Content-Type", "application/json")
                            .header("Access-Control-Allow-Origin", "*")
                            .body(r#"{"status":"ok"}"#.as_bytes().to_vec())
                            .unwrap()
                    }
                    Err(e) => {
                        println!("[AnyChat] Protocol parse error: {}", e);
                        http::Response::builder()
                            .status(400)
                            .header("Content-Type", "application/json")
                            .body(format!(r#"{{"error":"{}"}}"#, e).into_bytes())
                            .unwrap()
                    }
                }
            } else {
                http::Response::builder()
                    .status(404)
                    .body("Not Found".as_bytes().to_vec())
                    .unwrap()
            }
        })
        .manage(AppState {
            created_webviews: Mutex::new(HashSet::new()),
            setup_complete: Mutex::new(false),
        })
        .setup(|app| {
            println!("[AnyChat] Setup starting...");
            
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    let app_handle_for_route = app_handle.clone();
                    
                    let cors = warp::cors()
                        .allow_any_origin()
                        .allow_methods(vec!["GET", "POST", "OPTIONS"])
                        .allow_headers(vec!["Content-Type"]);
                    
                    let beacon_route = warp::get()
                        .and(warp::path("beacon"))
                        .and(warp::query::<std::collections::HashMap<String, String>>())
                        .map(|params: std::collections::HashMap<String, String>| {
                            if let Some(data) = params.get("d") {
                                if let Ok(decoded) = urlencoding::decode(data) {
                                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&decoded) {
                                        let service_id = payload.get("s").and_then(|v| v.as_str()).unwrap_or("unknown");
                                        let role = payload.get("r").and_then(|v| v.as_str()).unwrap_or("unknown");
                                        let content = payload.get("c").and_then(|v| v.as_str()).unwrap_or("");
                                        
                                        println!("[AnyChat] Beacon: [{}] {}...", role, content.chars().take(50).collect::<String>());
                                        
                                        if let Ok(home_dir) = std::env::var("HOME") {
                                            let dir_path = format!("{}/Library/Application Support/com.anychat.app", home_dir);
                                            let _ = std::fs::create_dir_all(&dir_path);
                                            let log_path = format!("{}/captured_chats.jsonl", dir_path);
                                            
                                            if let Ok(mut file) = std::fs::OpenOptions::new()
                                                .create(true)
                                                .append(true)
                                                .open(&log_path)
                                            {
                                                use std::io::Write;
                                                let entry = serde_json::json!({
                                                    "service_id": service_id,
                                                    "role": role,
                                                    "content": content,
                                                    "source": "beacon",
                                                    "captured_at": chrono::Utc::now().to_rfc3339()
                                                });
                                                let _ = writeln!(file, "{}", entry.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                            
                            let gif_1x1: Vec<u8> = vec![0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b];
                            warp::reply::with_header(
                                warp::reply::with_status(gif_1x1, warp::http::StatusCode::OK),
                                "Content-Type",
                                "image/gif"
                            )
                        });
                    
                    let capture_route = warp::post()
                        .and(warp::path("capture"))
                        .and(warp::body::json::<CapturePayload>())
                        .map(move |payload: CapturePayload| {
                            println!(
                                "[AnyChat] HTTP received: service={}, messages={}",
                                payload.service_id,
                                payload.messages.len()
                            );
                            
                            for msg in &payload.messages {
                                println!(
                                    "[AnyChat] Message: [{}] {}...",
                                    msg.role,
                                    msg.content.chars().take(50).collect::<String>()
                                );
                            }
                            
                            let _ = app_handle_for_route.emit(
                                "chat-captured",
                                ChatCaptureEvent {
                                    service_id: payload.service_id.clone(),
                                    messages: payload.messages.clone(),
                                },
                            );
                            
                            if let Ok(home_dir) = std::env::var("HOME") {
                                let dir_path = format!(
                                    "{}/Library/Application Support/com.anychat.app",
                                    home_dir
                                );
                                let _ = std::fs::create_dir_all(&dir_path);
                                
                                let log_path = format!(
                                    "{}/Library/Application Support/com.anychat.app/captured_chats.jsonl",
                                    home_dir
                                );
                                
                                if let Ok(mut file) = std::fs::OpenOptions::new()
                                    .create(true)
                                    .append(true)
                                    .open(&log_path)
                                {
                                    use std::io::Write;
                                    for msg in &payload.messages {
                                        let entry = serde_json::json!({
                                            "service_id": payload.service_id,
                                            "url": payload.url,
                                            "role": msg.role,
                                            "content": msg.content,
                                            "external_id": msg.external_id,
                                            "source": msg.source.clone().unwrap_or_else(|| "http".to_string()),
                                            "captured_at": chrono::Utc::now().to_rfc3339()
                                        });
                                        let _ = writeln!(file, "{}", entry.to_string());
                                    }
                                }
                            }
                            
                            warp::reply::json(&serde_json::json!({"status": "ok"}))
                        })
                        .with(cors.clone());
                    
                    let routes = beacon_route.or(capture_route);
                    
                    println!("[AnyChat] Starting HTTP server on 127.0.0.1:33445");
                    warp::serve(routes)
                        .run(([127, 0, 0, 1], 33445))
                        .await;
                });
            });
            
            let app_handle_for_polling = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(5));
                println!("[AnyChat] Queue polling started");
                
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    
                    let state = app_handle_for_polling.state::<AppState>();
                    let created = state.created_webviews.lock().unwrap().clone();
                    drop(state);
                    
                    for label in created.iter() {
                        if let Some(webview) = app_handle_for_polling.get_webview(label) {
                            let js_code = r#"
                                (function() {
                                    if (!window.__anychatQueue || window.__anychatQueue.length === 0) {
                                        return;
                                    }
                                    const entries = window.__anychatQueue;
                                    window.__anychatQueue = [];
                                    
                                    entries.forEach(entry => {
                                        entry.messages.forEach(msg => {
                                            const payload = {
                                                s: entry.serviceId,
                                                r: msg.role,
                                                c: msg.content.substring(0, 1500),
                                                t: Date.now()
                                            };
                                            const encoded = encodeURIComponent(JSON.stringify(payload));
                                            const img = new Image();
                                            img.src = 'http://127.0.0.1:33445/beacon?d=' + encoded;
                                        });
                                    });
                                    console.log('[AnyChat] Sent', entries.length, 'entries via beacon');
                                })();
                            "#;
                            let _ = webview.eval(js_code);
                        }
                    }
                }
            });
            
            let main_webview_window = match WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("")
            .inner_size(1200.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .build() {
                Ok(w) => {
                    println!("[AnyChat] Main window created successfully");
                    w
                }
                Err(e) => {
                    println!("[AnyChat] ERROR: Failed to create main window: {}", e);
                    return Err(e.into());
                }
            };

            let window = main_webview_window.as_ref().window();

            let state = app.state::<AppState>();
            let (pos, size) = compute_webview_bounds(&window)?;

            #[cfg(debug_assertions)]
            if should_open_devtools() {
                let _ = main_webview_window.open_devtools();
                println!("[AnyChat] DevTools opened for main webview window");
            }

            let default_services = [
                ("chatgpt", "https://chatgpt.com"),
                ("gemini", "https://gemini.google.com"),
            ];

            for (index, (label, url)) in default_services.iter().enumerate() {
                let app_handle_clone = app.handle().clone();

                let webview_builder = WebviewBuilder::new(
                    *label,
                    WebviewUrl::External(url.parse().unwrap()),
                )
                .user_agent(USER_AGENT)
                .initialization_script(AUTH_SCRIPT)
                .on_navigation(|url| {
                    let url_str = url.as_str();
                    if is_auth_url(url_str) {
                        #[cfg(debug_assertions)]
                        println!("[AnyChat] Allowing OAuth navigation to: {}", url_str);
                    }
                    true
                })
                .on_new_window(move |url, _features| {
                    #[cfg(debug_assertions)]
                    println!("[AnyChat] New window requested: {}", url);

                    if is_auth_url(url.as_str()) {
                        let popup_label = format!(
                            "oauth-{}",
                            std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_millis()
                        );

                        let _ = WebviewWindowBuilder::new(
                            &app_handle_clone,
                            &popup_label,
                            WebviewUrl::External(url.clone()),
                        )
                        .title("Sign In")
                        .inner_size(500.0, 700.0)
                        .center()
                        .user_agent(USER_AGENT)
                        .initialization_script(AUTH_SCRIPT)
                        .build();
                    }

                    tauri::webview::NewWindowResponse::Allow
                })
                ;

                let webview = window
                    .add_child(
                        webview_builder,
                        pos,
                        size,
                    )
                    .map_err(|e| e.to_string())?;

                // Some platforms/versions may not apply the initial bounds reliably. Enforce once right away.
                let _ = webview.set_position(pos);
                let _ = webview.set_size(size);

                {
                    let mut created = state.created_webviews.lock().unwrap();
                    created.insert(label.to_string());
                }

                #[cfg(debug_assertions)]
                if index == 0 && should_open_devtools() {
                    let _ = webview.open_devtools();
                    println!("[AnyChat] DevTools opened for initial webview: {}", label);
                }

                if index != 0 {
                    let _ = webview.hide();
                }
            }

            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let WindowEvent::Resized(size) = event {
                    if let Some(webview_window) = app_handle.get_webview_window("main") {
                        let _ = size; // keep pattern explicit: we recompute bounds from window state

                        let window = webview_window.as_ref().window();
                        let (pos, size) = match compute_webview_bounds(&window) {
                            Ok(v) => v,
                            Err(e) => {
                                println!("[AnyChat] Failed to compute webview bounds on resize: {}", e);
                                return;
                            }
                        };

                        let state = app_handle.state::<AppState>();
                        let created = state.created_webviews.lock().unwrap();
                        for label in created.iter() {
                            if let Some(webview) = app_handle.get_webview(label) {
                                let _ = webview.set_position(pos);
                                let _ = webview.set_size(size);
                            }
                        }
                    }
                }
            });

            {
                let mut setup_complete = state.setup_complete.lock().unwrap();
                *setup_complete = true;
            }

            let show_item = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let hide_item = MenuItemBuilder::with_id("hide", "隐藏窗口").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .items(&[&show_item, &hide_item, &quit_item])
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .on_menu_event(|app_handle, event| match event.id().as_ref() {
                    "show" => {
                        println!("[AnyChat] Tray menu: show");
                        show_main_window(app_handle);
                    }
                    "hide" => {
                        println!("[AnyChat] Tray menu: hide");
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "quit" => {
                        println!("[AnyChat] Tray menu: quit");
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            println!("[AnyChat] System tray initialized");
            println!("[AnyChat] Setup complete");

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            switch_webview,
            refresh_webview,
            hide_all_webviews,
            capture_chat_message
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                println!("[AnyChat] RunEvent::Reopen");
                show_main_window(app_handle);
            }
        });
}
