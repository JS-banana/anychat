use regex::Regex;
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    webview::WebviewBuilder,
    Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

const SIDEBAR_WIDTH: f64 = 64.0;

#[cfg(target_os = "macos")]
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15";

#[cfg(target_os = "windows")]
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

#[cfg(target_os = "linux")]
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const WEBVIEW_COMPAT_SCRIPT: &str = r#"
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
    console.log('[AnyChat] Webview compatibility script initialized');
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

fn compute_webview_bounds(
    window: &tauri::Window,
) -> Result<(PhysicalPosition<i32>, PhysicalSize<u32>), String> {
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

    let auth_paths = [
        "/oauth/",
        "/auth/",
        "/authorize",
        "/login",
        "/signin",
        "/o/oauth2",
    ];

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

fn handle_external_new_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    url: &tauri::Url,
) -> tauri::webview::NewWindowResponse<R> {
    if !is_auth_url(url.as_str()) {
        if let Err(err) = app.opener().open_url(url.as_str(), None::<String>) {
            println!("[AnyChat] Failed to open external url: {}", err);
        }
    }

    tauri::webview::NewWindowResponse::Deny
}

#[derive(Debug, PartialEq, Eq)]
enum ShowAction {
    FocusOnly,
    ShowAndUnminimize,
}

fn decide_show_action(is_visible: bool, is_minimized: bool) -> ShowAction {
    if is_visible && !is_minimized {
        ShowAction::FocusOnly
    } else {
        ShowAction::ShowAndUnminimize
    }
}

#[cfg(test)]
mod tests {
    use super::{decide_show_action, ShowAction};

    #[test]
    fn show_action_focus_only_when_visible_and_not_minimized() {
        assert_eq!(decide_show_action(true, false), ShowAction::FocusOnly);
    }

    #[test]
    fn show_action_show_when_hidden() {
        assert_eq!(
            decide_show_action(false, false),
            ShowAction::ShowAndUnminimize
        );
    }

    #[test]
    fn show_action_show_when_minimized() {
        assert_eq!(
            decide_show_action(true, true),
            ShowAction::ShowAndUnminimize
        );
    }
}

fn show_main_window(app_handle: &tauri::AppHandle) {
    match app_handle.get_webview_window("main") {
        Some(w) => {
            println!("[AnyChat] show_main_window: restoring main window");
            let is_visible = w.is_visible().unwrap_or(false);
            let is_minimized = w.is_minimized().unwrap_or(false);
            if decide_show_action(is_visible, is_minimized) == ShowAction::ShowAndUnminimize {
                if let Err(e) = w.show() {
                    println!("[AnyChat] show_main_window: show failed: {}", e);
                }
                let _ = w.unminimize();
            }
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
                let is_visible = w.is_visible().unwrap_or(false);
                let is_minimized = w.is_minimized().unwrap_or(false);
                if decide_show_action(is_visible, is_minimized) == ShowAction::ShowAndUnminimize {
                    let _ = w.show();
                    let _ = w.unminimize();
                }
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
                            let is_visible = orphan_window.is_visible().unwrap_or(false);
                            let is_minimized = orphan_window.is_minimized().unwrap_or(false);
                            if decide_show_action(is_visible, is_minimized)
                                == ShowAction::ShowAndUnminimize
                            {
                                let _ = orphan_window.show();
                                let _ = orphan_window.unminimize();
                            }
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
    println!(
        "[AnyChat] create_webview_for_service: creating {} -> {}",
        label, url
    );

    let (pos, size) = compute_webview_bounds(window)?;

    let app_handle_clone = app.clone();
    let parsed_url: tauri::Url = url.parse().map_err(|e| format!("{}", e))?;

    let webview_builder = WebviewBuilder::new(label, WebviewUrl::External(parsed_url))
        .user_agent(USER_AGENT)
        .initialization_script(WEBVIEW_COMPAT_SCRIPT)
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
                .initialization_script(WEBVIEW_COMPAT_SCRIPT)
                .build();
            }

            handle_external_new_window(&app_handle_clone, &url)
        });

    println!("[AnyChat] create_webview_for_service: calling add_child");

    let webview = window.add_child(webview_builder, pos, size).map_err(|e| {
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
    println!(
        "[AnyChat] switch_webview called: label={}, url={}, parent={}",
        label,
        url,
        parent.label()
    );

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
        println!(
            "[AnyChat] ERROR: Failed to get webview after creation: {}",
            label
        );
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

#[tauri::command]
async fn discover_site_icon(url: String) -> Result<Option<String>, String> {
    let parsed_url = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(parsed_url.clone())
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let html = response.text().await.map_err(|e| e.to_string())?;
    Ok(extract_site_icon_url(&parsed_url, &html))
}

fn extract_site_icon_url(base_url: &reqwest::Url, html: &str) -> Option<String> {
    let link_tag_regex = Regex::new(r"(?is)<link\b[^>]*>").ok()?;
    let rel_regex = Regex::new(r#"(?i)rel\s*=\s*["']([^"']+)["']"#).ok()?;
    let href_regex = Regex::new(r#"(?i)href\s*=\s*["']([^"']+)["']"#).ok()?;

    for tag_match in link_tag_regex.find_iter(html) {
        let tag = tag_match.as_str();
        let Some(rel_value) = rel_regex
            .captures(tag)
            .and_then(|captures| captures.get(1))
            .map(|value| value.as_str().to_ascii_lowercase())
        else {
            continue;
        };

        if !rel_value.contains("icon") {
            continue;
        }

        let Some(href) = href_regex
            .captures(tag)
            .and_then(|captures| captures.get(1))
            .map(|value| value.as_str().trim())
        else {
            continue;
        };

        if href.is_empty() || href.starts_with("data:") {
            continue;
        }

        if let Ok(resolved_url) = base_url.join(href) {
            return Some(resolved_url.to_string());
        }
    }

    None
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            created_webviews: Mutex::new(HashSet::new()),
            setup_complete: Mutex::new(false),
        })
        .setup(|app| {
            println!("[AnyChat] Setup starting...");

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
                .initialization_script(WEBVIEW_COMPAT_SCRIPT)
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
                        .initialization_script(WEBVIEW_COMPAT_SCRIPT)
                        .build();
                    }

                    handle_external_new_window(&app_handle_clone, &url)
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
            discover_site_icon,
            switch_webview,
            refresh_webview,
            hide_all_webviews
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
