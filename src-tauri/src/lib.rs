use std::collections::HashSet;
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    webview::WebviewBuilder,
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
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

    // Chat capture functionality
    window.__chatBoxCapturedMessages = new Set();
    
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
    
    function extractTextContent(element) {
        if (!element) return '';
        return element.innerText || element.textContent || '';
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
    
    function captureMessages() {
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
                content = extractTextContent(contentEl);
            } else if (config.assistantMessage && container.querySelector(config.assistantMessage)) {
                role = 'assistant';
                const contentEl = container.querySelector(config.content) || container.querySelector(config.assistantMessage);
                content = extractTextContent(contentEl);
            } else if (container.matches && container.matches(config.userMessage)) {
                role = 'user';
                content = extractTextContent(container.querySelector(config.content) || container);
            } else if (container.matches && container.matches(config.assistantMessage)) {
                role = 'assistant';
                content = extractTextContent(container.querySelector(config.content) || container);
            }
            
            if (content && content.trim().length > 0 && role !== 'unknown') {
                const hash = hashString(content.trim());
                if (!window.__chatBoxCapturedMessages.has(hash)) {
                    window.__chatBoxCapturedMessages.add(hash);
                    messages.push({
                        role: role,
                        content: content.trim(),
                        index: index,
                        timestamp: Date.now()
                    });
                }
            }
        });
        
        if (messages.length > 0) {
            console.log('[AnyChat] Captured', messages.length, 'new messages');
            // Store in window for polling
            window.__chatBoxPendingMessages = window.__chatBoxPendingMessages || [];
            window.__chatBoxPendingMessages.push(...messages.map(m => ({
                ...m,
                serviceId: window.location.hostname
            })));
            
            // Also try Tauri IPC if available
            if (window.__TAURI__ && window.__TAURI__.core) {
                window.__TAURI__.core.invoke('capture_chat_message', {
                    serviceId: window.location.hostname,
                    messages: messages
                }).catch(err => {
                    console.log('[AnyChat] IPC failed (expected in child webview):', err);
                });
            }
        }
    }
    
    function setupChatObserver() {
        const config = getHostConfig();
        if (!config) {
            console.log('[AnyChat] No chat config for this site');
            return;
        }
        
        console.log('[AnyChat] Setting up chat observer for', window.location.hostname);
        
        const observer = new MutationObserver((mutations) => {
            let shouldCapture = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0 || mutation.type === 'characterData') {
                    shouldCapture = true;
                    break;
                }
            }
            if (shouldCapture) {
                setTimeout(captureMessages, 500);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
        
        setTimeout(captureMessages, 2000);
        
        console.log('[AnyChat] Chat observer started');
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupChatObserver);
    } else {
        setTimeout(setupChatObserver, 1000);
    }
    
    function flushPendingMessages() {
        if (!window.__chatBoxPendingMessages || window.__chatBoxPendingMessages.length === 0) return;
        
        const messages = window.__chatBoxPendingMessages.splice(0);
        const payload = JSON.stringify({
            type: 'chatbox_capture',
            serviceId: window.location.hostname,
            url: window.location.href,
            messages: messages
        });
        
        fetch('http://127.0.0.1:33445/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        }).then(response => {
            if (response.ok) {
                console.log('[AnyChat] Sent', messages.length, 'messages via HTTP');
            } else {
                window.__chatBoxPendingMessages.unshift(...messages);
                console.log('[AnyChat] Failed to send, messages re-queued');
            }
        }).catch(err => {
            window.__chatBoxPendingMessages.unshift(...messages);
            console.log('[AnyChat] Fetch error, messages re-queued:', err);
        });
    }
    
    setInterval(flushPendingMessages, 3000);
    
    console.log('[AnyChat] Auth script initialized');
})();
"#;

struct AppState {
    created_webviews: Mutex<HashSet<String>>,
    setup_complete: Mutex<bool>,
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

fn create_webview_for_service(
    app: &tauri::AppHandle,
    label: &str,
    url: &str,
    state: &AppState,
    // Use Window here because the main window hosts multiple webviews (add_child).
    window: &tauri::Window,
) -> Result<(), String> {
    println!("[AnyChat] create_webview_for_service: creating {} -> {}", label, url);

    let win_size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let content_width = (win_size.width as f64 / scale) - SIDEBAR_WIDTH;
    let content_height = win_size.height as f64 / scale;

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

            tauri::webview::NewWindowResponse::Allow
        })
        .auto_resize();

    println!("[AnyChat] create_webview_for_service: calling add_child");

    window
        .add_child(
            webview_builder,
            LogicalPosition::new(SIDEBAR_WIDTH, 0.0),
            LogicalSize::new(content_width, content_height),
        )
        .map_err(|e| {
            println!("[AnyChat] add_child failed: {}", e);
            e.to_string()
        })?;

    let mut created = state.created_webviews.lock().unwrap();
    created.insert(label.to_string());

    println!("[AnyChat] Created webview: {} -> {}", label, url);

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
    #[allow(dead_code)]
    index: i32,
    #[allow(dead_code)]
    timestamp: i64,
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
            "{}/Library/Application Support/com.sunss.chat-box-app/captured_chats.jsonl",
            app_data_dir
        );
        
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
                        .allow_methods(vec!["POST", "OPTIONS"])
                        .allow_headers(vec!["Content-Type"]);
                    
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
                                let log_path = format!(
                                    "{}/Library/Application Support/com.sunss.chat-box-app/captured_chats.jsonl",
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
                                            "captured_at": chrono::Utc::now().to_rfc3339()
                                        });
                                        let _ = writeln!(file, "{}", entry.to_string());
                                    }
                                }
                            }
                            
                            warp::reply::json(&serde_json::json!({"status": "ok"}))
                        })
                        .with(cors);
                    
                    println!("[AnyChat] Starting HTTP server on 127.0.0.1:33445");
                    warp::serve(capture_route)
                        .run(([127, 0, 0, 1], 33445))
                        .await;
                });
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

            let win_size = window.inner_size().map_err(|e| e.to_string())?;
            let scale = window.scale_factor().unwrap_or(1.0);
            let content_width = (win_size.width as f64 / scale) - SIDEBAR_WIDTH;
            let content_height = win_size.height as f64 / scale;

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
                .auto_resize();

                let webview = window
                    .add_child(
                        webview_builder,
                        LogicalPosition::new(SIDEBAR_WIDTH, 0.0),
                        LogicalSize::new(content_width, content_height),
                    )
                    .map_err(|e| e.to_string())?;

                {
                    let mut created = state.created_webviews.lock().unwrap();
                    created.insert(label.to_string());
                }

                if index != 0 {
                    let _ = webview.hide();
                }
            }

            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let WindowEvent::Resized(size) = event {
                    if let Some(webview_window) = app_handle.get_webview_window("main") {
                        let scale = webview_window.scale_factor().unwrap_or(1.0);
                        let new_content_width = (size.width as f64 / scale) - SIDEBAR_WIDTH;
                        let new_content_height = size.height as f64 / scale;

                        let state = app_handle.state::<AppState>();
                        let created = state.created_webviews.lock().unwrap();
                        for label in created.iter() {
                            if let Some(webview) = app_handle.get_webview(label) {
                                let _ = webview
                                    .set_position(LogicalPosition::new(SIDEBAR_WIDTH, 0.0));
                                let _ = webview.set_size(LogicalSize::new(
                                    new_content_width,
                                    new_content_height,
                                ));
                            }
                        }
                    }
                }
            });

            {
                let mut setup_complete = state.setup_complete.lock().unwrap();
                *setup_complete = true;
            }

            let show_item = MenuItemBuilder::with_id("show", "Show Window").build(app)?;
            let hide_item = MenuItemBuilder::with_id("hide", "Hide Window").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .items(&[&show_item, &hide_item, &quit_item])
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .on_menu_event(|app_handle, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "quit" => {
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
