use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
#[cfg(not(target_os = "windows"))]
use tauri::webview::WebviewBuilder;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
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

#[derive(Debug, Clone, serde::Deserialize)]
struct ServiceHostPayload {
    id: String,
    name: String,
    url: String,
    enabled: bool,
}

#[derive(Debug, Clone)]
struct WindowsServiceHost {
    service_id: String,
    window_label: String,
    name: String,
    url: String,
}

impl WindowsServiceHost {
    fn from_service(service: &ServiceHostPayload) -> Self {
        Self {
            service_id: service.id.clone(),
            window_label: service_window_label(&service.id),
            name: service.name.clone(),
            url: service.url.clone(),
        }
    }
}

struct AppState {
    created_webviews: Mutex<HashSet<String>>,
    setup_complete: Mutex<bool>,
    windows_service_hosts: Mutex<HashMap<String, WindowsServiceHost>>,
    active_windows_service_id: Mutex<Option<String>>,
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

fn should_use_custom_user_agent(url: &str) -> bool {
    let Ok(parsed_url) = tauri::Url::parse(url) else {
        return true;
    };

    let host = parsed_url
        .host_str()
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_ascii_lowercase();

    host != "grok.com"
}

fn should_inject_webview_compatibility_script(url: &str) -> bool {
    let Ok(parsed_url) = tauri::Url::parse(url) else {
        return true;
    };

    let host = parsed_url
        .host_str()
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_ascii_lowercase();

    !(host == "grok.com"
        || host.ends_with(".grok.com")
        || host == "x.com"
        || host.ends_with(".x.com")
        || host == "x.ai"
        || host.ends_with(".x.ai"))
}

fn service_window_label(service_id: &str) -> String {
    format!("svc_{}", service_id)
}

fn compute_docked_window_bounds_from_metrics(
    inner_pos: PhysicalPosition<i32>,
    inner_size: PhysicalSize<u32>,
    scale: f64,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let sidebar_width_physical = (SIDEBAR_WIDTH * scale).round().max(0.0) as u32;
    let x = inner_pos.x + sidebar_width_physical.min(inner_size.width) as i32;
    let width = inner_size.width.saturating_sub(sidebar_width_physical);

    (
        PhysicalPosition::new(x, inner_pos.y),
        PhysicalSize::new(width, inner_size.height),
    )
}

fn compute_docked_window_bounds(
    window: &tauri::WebviewWindow,
) -> Result<(PhysicalPosition<i32>, PhysicalSize<u32>), String> {
    let inner_pos = window.inner_position().map_err(|e| e.to_string())?;
    let inner_size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;

    Ok(compute_docked_window_bounds_from_metrics(
        inner_pos, inner_size, scale,
    ))
}

fn should_show_windows_service_hosts(is_visible: bool, is_minimized: bool) -> bool {
    is_visible && !is_minimized
}

fn should_navigate_existing_windows_service_host(
    tracked_host: Option<&WindowsServiceHost>,
    service: &ServiceHostPayload,
) -> bool {
    tracked_host
        .map(|host| host.url != service.url)
        .unwrap_or(false)
}

fn stale_windows_service_ids(
    tracked_hosts: &HashMap<String, WindowsServiceHost>,
    services: &[ServiceHostPayload],
) -> Vec<String> {
    let enabled_ids: HashSet<&str> = services
        .iter()
        .filter(|service| service.enabled)
        .map(|service| service.id.as_str())
        .collect();

    let mut stale_ids = tracked_hosts
        .keys()
        .filter(|service_id| !enabled_ids.contains(service_id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    stale_ids.sort();
    stale_ids
}

fn open_oauth_popup<R: tauri::Runtime>(app: &tauri::AppHandle<R>, url: &tauri::Url) {
    let popup_label = format!(
        "oauth-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    let mut builder = WebviewWindowBuilder::new(app, &popup_label, WebviewUrl::External(url.clone()))
        .title("Sign In")
        .inner_size(500.0, 700.0)
        .center()
        .user_agent(USER_AGENT);

    if should_inject_webview_compatibility_script(url.as_str()) {
        builder = builder.initialization_script(WEBVIEW_COMPAT_SCRIPT);
    }

    let _ = builder.build();
}

fn sync_windows_service_host_record(
    state: &AppState,
    service: &ServiceHostPayload,
) -> WindowsServiceHost {
    let host = WindowsServiceHost::from_service(service);
    let mut tracked_hosts = state.windows_service_hosts.lock().unwrap();
    tracked_hosts.insert(service.id.clone(), host.clone());
    host
}

fn tracked_windows_service_hosts(state: &AppState) -> Vec<WindowsServiceHost> {
    state
        .windows_service_hosts
        .lock()
        .unwrap()
        .values()
        .cloned()
        .collect()
}

#[allow(dead_code)]
fn resolve_windows_refresh_url(
    current_url: Option<String>,
    service: &ServiceHostPayload,
) -> String {
    current_url.unwrap_or_else(|| service.url.clone())
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn tracked_services_or_current(
    services: Option<Vec<ServiceHostPayload>>,
    service: &ServiceHostPayload,
) -> Vec<ServiceHostPayload> {
    services.unwrap_or_else(|| vec![service.clone()])
}

fn set_active_windows_service_id(state: &AppState, service_id: Option<String>) {
    let mut active_service_id = state.active_windows_service_id.lock().unwrap();
    *active_service_id = service_id;
}

fn hide_windows_service_hosts(app: &tauri::AppHandle, state: &AppState) {
    for host in tracked_windows_service_hosts(state) {
        if let Some(window) = app.get_webview_window(&host.window_label) {
            let _ = window.hide();
        }
    }
}

fn sync_windows_service_host_layout_with_main(
    app: &tauri::AppHandle,
    state: &AppState,
    main_window: &tauri::WebviewWindow,
) -> Result<(), String> {
    let (pos, size) = compute_docked_window_bounds(main_window)?;

    for host in tracked_windows_service_hosts(state) {
        if let Some(window) = app.get_webview_window(&host.window_label) {
            let _ = window.set_position(pos);
            let _ = window.set_size(size);
        }
    }

    Ok(())
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn sync_windows_service_host_layout(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<(), String> {
    let Some(main_window) = app.get_webview_window("main") else {
        return Ok(());
    };

    sync_windows_service_host_layout_with_main(app, state, &main_window)
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn sync_windows_service_host_state(
    app: &tauri::AppHandle,
    state: &AppState,
    services: &[ServiceHostPayload],
    active_service_id: Option<String>,
) -> Result<(), String> {
    prune_disabled_windows_service_hosts(app, state, services);
    set_active_windows_service_id(state, active_service_id);

    if state
        .active_windows_service_id
        .lock()
        .unwrap()
        .as_ref()
        .is_none()
    {
        hide_windows_service_hosts(app, state);
        return Ok(());
    }

    show_active_windows_service_host(app, state)
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn prune_disabled_windows_service_hosts(
    app: &tauri::AppHandle,
    state: &AppState,
    services: &[ServiceHostPayload],
) {
    let stale_hosts = {
        let tracked_hosts = state.windows_service_hosts.lock().unwrap();
        stale_windows_service_ids(&tracked_hosts, services)
            .into_iter()
            .filter_map(|service_id| {
                tracked_hosts
                    .get(&service_id)
                    .cloned()
                    .map(|host| (service_id, host.window_label))
            })
            .collect::<Vec<_>>()
    };

    for (_, window_label) in &stale_hosts {
        if let Some(window) = app.get_webview_window(window_label) {
            let _ = window.close();
        }
    }

    if stale_hosts.is_empty() {
        return;
    }

    let stale_ids = stale_hosts
        .iter()
        .map(|(service_id, _)| service_id.clone())
        .collect::<HashSet<_>>();

    {
        let mut tracked_hosts = state.windows_service_hosts.lock().unwrap();
        for service_id in &stale_ids {
            tracked_hosts.remove(service_id);
        }
    }

    let active_service_id = state.active_windows_service_id.lock().unwrap().clone();
    if active_service_id
        .as_ref()
        .is_some_and(|service_id| stale_ids.contains(service_id))
    {
        set_active_windows_service_id(state, None);
    }
}

fn ensure_windows_service_host(
    app: &tauri::AppHandle,
    state: &AppState,
    main_window: &tauri::WebviewWindow,
    service: &ServiceHostPayload,
) -> Result<WindowsServiceHost, String> {
    let tracked_host = state
        .windows_service_hosts
        .lock()
        .unwrap()
        .get(&service.id)
        .cloned();
    let host = sync_windows_service_host_record(state, service);
    let parsed_url: tauri::Url = service.url.parse().map_err(|e| format!("{}", e))?;

    if let Some(window) = app.get_webview_window(&host.window_label) {
        let _ = window.set_title(&service.name);
        if should_navigate_existing_windows_service_host(tracked_host.as_ref(), service) {
            let _ = window.navigate(parsed_url.clone());
        }
        sync_windows_service_host_layout_with_main(app, state, main_window)?;
        return Ok(host);
    }

    let app_handle_clone = app.clone();
    let mut builder =
        WebviewWindowBuilder::new(app, &host.window_label, WebviewUrl::External(parsed_url))
            .title(&service.name)
            .inner_size(900.0, 700.0)
            .visible(false)
            .resizable(false)
            .decorations(false)
            .shadow(false)
            .skip_taskbar(true)
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
                    open_oauth_popup(&app_handle_clone, &url);
                }

                handle_external_new_window(&app_handle_clone, &url)
            });

    if should_use_custom_user_agent(&service.url) {
        builder = builder.user_agent(USER_AGENT);
    }

    if should_inject_webview_compatibility_script(&service.url) {
        builder = builder.initialization_script(WEBVIEW_COMPAT_SCRIPT);
    }

    let builder = builder.parent(main_window).map_err(|e| e.to_string())?;

    let window = builder.build().map_err(|e| e.to_string())?;
    sync_windows_service_host_layout_with_main(app, state, main_window)?;
    let _ = window.hide();

    Ok(host)
}

fn show_active_windows_service_host(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<(), String> {
    let Some(main_window) = app.get_webview_window("main") else {
        return Ok(());
    };

    let is_visible = main_window.is_visible().map_err(|e| e.to_string())?;
    let is_minimized = main_window.is_minimized().map_err(|e| e.to_string())?;

    if !should_show_windows_service_hosts(is_visible, is_minimized) {
        hide_windows_service_hosts(app, state);
        return Ok(());
    }

    let Some(active_host) = ({
        let active_service_id = state.active_windows_service_id.lock().unwrap().clone();
        let tracked_hosts = state.windows_service_hosts.lock().unwrap();
        active_service_id.and_then(|service_id| tracked_hosts.get(&service_id).cloned())
    }) else {
        hide_windows_service_hosts(app, state);
        return Ok(());
    };

    let restore_service = ServiceHostPayload {
        id: active_host.service_id.clone(),
        name: active_host.name.clone(),
        url: active_host.url.clone(),
        enabled: true,
    };

    let _ = ensure_windows_service_host(app, state, &main_window, &restore_service)?;
    sync_windows_service_host_layout_with_main(app, state, &main_window)?;

    for host in tracked_windows_service_hosts(state) {
        if let Some(window) = app.get_webview_window(&host.window_label) {
            if host.service_id == active_host.service_id {
                let _ = window.show();
                let _ = window.set_focus();
            } else {
                let _ = window.hide();
            }
        }
    }

    Ok(())
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
    use super::{
        compute_docked_window_bounds_from_metrics, decide_show_action, resolve_windows_refresh_url,
        should_inject_webview_compatibility_script,
        should_navigate_existing_windows_service_host, should_show_windows_service_hosts,
        should_use_custom_user_agent, stale_windows_service_ids, ServiceHostPayload, ShowAction,
        WindowsServiceHost,
    };
    use regex::Regex;
    use std::collections::HashMap;
    use tauri::{PhysicalPosition, PhysicalSize};

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

    #[test]
    fn docked_window_bounds_respect_sidebar_width_and_window_origin() {
        let (pos, size) = compute_docked_window_bounds_from_metrics(
            PhysicalPosition::new(120, 40),
            PhysicalSize::new(1000, 700),
            1.5,
        );

        assert_eq!(pos, PhysicalPosition::new(216, 40));
        assert_eq!(size, PhysicalSize::new(904, 700));
    }

    #[test]
    fn windows_service_hosts_show_only_when_shell_is_visible_and_not_minimized() {
        assert!(should_show_windows_service_hosts(true, false));
        assert!(!should_show_windows_service_hosts(false, false));
        assert!(!should_show_windows_service_hosts(true, true));
    }

    #[test]
    fn stale_windows_service_ids_ignore_enabled_hosts_and_flag_disabled_or_removed_hosts() {
        let mut tracked_hosts = HashMap::new();
        tracked_hosts.insert(
            "chatgpt".to_string(),
            WindowsServiceHost {
                service_id: "chatgpt".to_string(),
                window_label: "svc_chatgpt".to_string(),
                name: "ChatGPT".to_string(),
                url: "https://chatgpt.com".to_string(),
            },
        );
        tracked_hosts.insert(
            "gemini".to_string(),
            WindowsServiceHost {
                service_id: "gemini".to_string(),
                window_label: "svc_gemini".to_string(),
                name: "Gemini".to_string(),
                url: "https://gemini.google.com".to_string(),
            },
        );

        let stale_ids = stale_windows_service_ids(
            &tracked_hosts,
            &[
                ServiceHostPayload {
                    id: "chatgpt".to_string(),
                    name: "ChatGPT".to_string(),
                    url: "https://chatgpt.com".to_string(),
                    enabled: true,
                },
                ServiceHostPayload {
                    id: "gemini".to_string(),
                    name: "Gemini".to_string(),
                    url: "https://gemini.google.com".to_string(),
                    enabled: false,
                },
            ],
        );

        assert_eq!(stale_ids, vec!["gemini".to_string()]);
    }

    #[test]
    fn existing_windows_host_preserves_current_page_when_service_definition_is_unchanged() {
        let tracked_host = WindowsServiceHost {
            service_id: "chatgpt".to_string(),
            window_label: "svc_chatgpt".to_string(),
            name: "ChatGPT".to_string(),
            url: "https://chatgpt.com".to_string(),
        };
        let service = ServiceHostPayload {
            id: "chatgpt".to_string(),
            name: "ChatGPT".to_string(),
            url: "https://chatgpt.com".to_string(),
            enabled: true,
        };

        assert!(!should_navigate_existing_windows_service_host(
            Some(&tracked_host),
            &service
        ));
    }

    #[test]
    fn existing_windows_host_reloads_when_service_definition_changes() {
        let tracked_host = WindowsServiceHost {
            service_id: "chatgpt".to_string(),
            window_label: "svc_chatgpt".to_string(),
            name: "ChatGPT".to_string(),
            url: "https://chatgpt.com".to_string(),
        };
        let service = ServiceHostPayload {
            id: "chatgpt".to_string(),
            name: "ChatGPT".to_string(),
            url: "https://chatgpt.com/new".to_string(),
            enabled: true,
        };

        assert!(should_navigate_existing_windows_service_host(
            Some(&tracked_host),
            &service
        ));
    }

    #[test]
    fn windows_refresh_prefers_current_page_url_over_service_home() {
        let service = ServiceHostPayload {
            id: "chatgpt".to_string(),
            name: "ChatGPT".to_string(),
            url: "https://chatgpt.com".to_string(),
            enabled: true,
        };

        assert_eq!(
            resolve_windows_refresh_url(Some("https://chatgpt.com/c/abc123".to_string()), &service,),
            "https://chatgpt.com/c/abc123".to_string()
        );
        assert_eq!(
            resolve_windows_refresh_url(None, &service),
            "https://chatgpt.com".to_string()
        );
    }

    #[test]
    fn grok_uses_default_webview_user_agent() {
        assert!(!should_use_custom_user_agent("https://grok.com"));
        assert!(!should_use_custom_user_agent("https://www.grok.com/chat"));
    }

    #[test]
    fn non_grok_services_keep_custom_user_agent() {
        assert!(should_use_custom_user_agent("https://chatgpt.com"));
        assert!(should_use_custom_user_agent("https://gemini.google.com"));
        assert!(should_use_custom_user_agent("not-a-valid-url"));
    }

    #[test]
    fn x_ecosystem_skips_webview_compatibility_script() {
        assert!(!should_inject_webview_compatibility_script("https://grok.com"));
        assert!(!should_inject_webview_compatibility_script("https://x.com/i/grok"));
        assert!(!should_inject_webview_compatibility_script("https://accounts.x.ai/account"));
    }

    #[test]
    fn other_services_keep_webview_compatibility_script() {
        assert!(should_inject_webview_compatibility_script("https://chatgpt.com"));
        assert!(should_inject_webview_compatibility_script("https://gemini.google.com"));
        assert!(should_inject_webview_compatibility_script("not-a-valid-url"));
    }

    #[test]
    fn windows_service_host_builder_applies_custom_user_agent_conditionally() {
        let source = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/lib.rs"));
        let conditional_pattern = Regex::new(
            r#"(?s)let mut builder\s*=\s*WebviewWindowBuilder::new\(app,\s*&host\.window_label,\s*WebviewUrl::External\(parsed_url\)\).*?if should_use_custom_user_agent\(&service\.url\)\s*\{\s*builder = builder\.user_agent\(USER_AGENT\);\s*\}"#,
        )
        .unwrap();

        assert!(
            conditional_pattern.is_match(source),
            "Windows service host builder should only apply the custom user agent for sites that opt in"
        );
    }

    #[test]
    fn windows_service_host_builder_applies_compatibility_script_conditionally() {
        let source = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/lib.rs"));
        let conditional_pattern = Regex::new(
            r#"(?s)let mut builder\s*=\s*WebviewWindowBuilder::new\(app,\s*&host\.window_label,\s*WebviewUrl::External\(parsed_url\)\).*?if should_inject_webview_compatibility_script\(&service\.url\)\s*\{\s*builder = builder\.initialization_script\(WEBVIEW_COMPAT_SCRIPT\);\s*\}"#,
        )
        .unwrap();

        assert!(
            conditional_pattern.is_match(source),
            "Windows service host builder should only inject the compatibility script for sites that opt in"
        );
    }

    #[test]
    fn windows_service_host_builder_disables_shadow() {
        let source = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/lib.rs"));
        let builder_pattern = Regex::new(
            r#"(?s)let mut builder\s*=\s*WebviewWindowBuilder::new\(app,\s*&host\.window_label,\s*WebviewUrl::External\(parsed_url\)\).*?\.decorations\(false\).*?\.shadow\(false\)"#,
        )
        .unwrap();

        assert!(
            builder_pattern.is_match(source),
            "Windows service host windows should explicitly disable shadow to avoid white border/overlay artifacts"
        );
    }

    #[test]
    fn windows_close_requests_exit_instead_of_hiding_to_tray() {
        let source = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/lib.rs"));
        let close_request_pattern = Regex::new(
            r#"(?s)WindowEvent::CloseRequested\s*\{[^}]*\}\s*=>\s*\{.*?#\[cfg\(target_os = "windows"\)\].*?app_handle\.exit\(0\);.*?#\[cfg\(not\(target_os = "windows"\)\)\].*?api\.prevent_close\(\);"#,
        )
        .unwrap();

        assert!(
            close_request_pattern.is_match(source),
            "main window close handling should exit on Windows and only preserve hide-to-tray behavior on non-Windows"
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

#[cfg(not(target_os = "windows"))]
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

    let mut webview_builder = WebviewBuilder::new(label, WebviewUrl::External(parsed_url))
        .user_agent(USER_AGENT)
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
                open_oauth_popup(&app_handle_clone, &url);
            }

            handle_external_new_window(&app_handle_clone, &url)
        });

    if should_inject_webview_compatibility_script(url) {
        webview_builder = webview_builder.initialization_script(WEBVIEW_COMPAT_SCRIPT);
    }

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

#[cfg(not(target_os = "windows"))]
fn activate_child_webview_content(
    // Use Window instead of WebviewWindow to avoid IPC failure in multi-webview windows.
    parent: &tauri::Window,
    app: &tauri::AppHandle,
    label: &str,
    url: &str,
) -> Result<(), String> {
    println!(
        "[AnyChat] activate_child_webview_content called: label={}, url={}, parent={}",
        label,
        url,
        parent.label()
    );

    let state = app.state::<AppState>();

    {
        let setup_complete = state.setup_complete.lock().unwrap();
        if !*setup_complete {
            println!("[AnyChat] Setup not complete yet, skipping activate_child_webview_content");
            return Ok(());
        }
    }

    if app.get_webview(label).is_none() {
        println!("[AnyChat] Webview {} not found, creating...", label);
        match create_webview_for_service(app, label, url, &state, parent) {
            Ok(_) => println!("[AnyChat] Successfully created webview: {}", label),
            Err(e) => {
                println!("[AnyChat] ERROR creating webview {}: {}", label, e);
                return Err(e);
            }
        }
    } else {
        println!("[AnyChat] Webview {} already exists", label);
    }

    if let Some(webview) = app.get_webview(label) {
        {
            let created = state.created_webviews.lock().unwrap();
            for existing_label in created.iter() {
                if existing_label == label {
                    continue;
                }

                if let Some(existing_webview) = app.get_webview(existing_label) {
                    let _ = existing_webview.hide();
                }
            }
        }

        if let Ok((pos, size)) = compute_webview_bounds(&parent) {
            let _ = webview.set_position(pos);
            let _ = webview.set_size(size);
        }
        let _ = webview.show();
        let _ = webview.set_focus();
        println!(
            "[AnyChat] activate_child_webview_content: showing webview {}",
            label
        );
    } else {
        println!(
            "[AnyChat] activate_child_webview_content: failed to get webview after creation: {}",
            label
        );
    }

    Ok(())
}

#[tauri::command]
async fn activate_service_content(
    parent: tauri::Window,
    app: tauri::AppHandle,
    service: ServiceHostPayload,
    _services: Option<Vec<ServiceHostPayload>>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let state = app.state::<AppState>();
        let tracked_services = tracked_services_or_current(_services, &service);
        let main_window = app
            .get_webview_window(parent.label())
            .ok_or_else(|| format!("Main window {} not found", parent.label()))?;

        {
            let setup_complete = state.setup_complete.lock().unwrap();
            if !*setup_complete {
                println!("[AnyChat] Setup not complete yet, skipping activate_service_content");
                return Ok(());
            }
        }

        prune_disabled_windows_service_hosts(&app, &state, &tracked_services);
        set_active_windows_service_id(&state, Some(service.id.clone()));
        let _ = ensure_windows_service_host(&app, &state, &main_window, &service)?;
        return show_active_windows_service_host(&app, &state);
    }

    #[cfg(not(target_os = "windows"))]
    {
        activate_child_webview_content(&parent, &app, &service.id, &service.url)
    }
}

#[tauri::command]
fn refresh_service_content(
    app: tauri::AppHandle,
    service: ServiceHostPayload,
    _services: Option<Vec<ServiceHostPayload>>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let state = app.state::<AppState>();
        let tracked_services = tracked_services_or_current(_services, &service);

        prune_disabled_windows_service_hosts(&app, &state, &tracked_services);
        set_active_windows_service_id(&state, Some(service.id.clone()));

        let main_window = app
            .get_webview_window("main")
            .ok_or_else(|| "Main window not found".to_string())?;
        let host = ensure_windows_service_host(&app, &state, &main_window, &service)?;
        let window = app
            .get_webview_window(&host.window_label)
            .ok_or_else(|| format!("Service window {} not found", host.window_label))?;
        let refresh_url = resolve_windows_refresh_url(
            window.url().ok().map(|current_url| current_url.to_string()),
            &service,
        );
        let url: tauri::Url = refresh_url.parse().map_err(|e| format!("{}", e))?;
        window.navigate(url).map_err(|e| e.to_string())?;
        return show_active_windows_service_host(&app, &state);
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(webview) = app.get_webview(&service.id) {
            if let Ok(url) = webview.url() {
                let _ = webview.navigate(url);
            }
        }
        Ok(())
    }
}

#[tauri::command]
fn hide_all_service_content(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let state = app.state::<AppState>();
        hide_windows_service_hosts(&app, &state);
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let state = app.state::<AppState>();
        let created = state.created_webviews.lock().unwrap();

        for label in created.iter() {
            if let Some(webview) = app.get_webview(label) {
                let _ = webview.hide();
            }
        }

        Ok(())
    }
}

#[tauri::command]
fn sync_service_host_state(
    app: tauri::AppHandle,
    services: Vec<ServiceHostPayload>,
    active_service_id: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let state = app.state::<AppState>();
        return sync_windows_service_host_state(&app, &state, &services, active_service_id);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, services, active_service_id);
        Ok(())
    }
}

#[tauri::command]
fn sync_docked_content_layout(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let state = app.state::<AppState>();
        return sync_windows_service_host_layout(&app, &state);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(())
    }
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

#[tauri::command]
fn host_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }

    #[cfg(target_os = "macos")]
    {
        "macos"
    }

    #[cfg(target_os = "linux")]
    {
        "linux"
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            created_webviews: Mutex::new(HashSet::new()),
            setup_complete: Mutex::new(false),
            windows_service_hosts: Mutex::new(HashMap::new()),
            active_windows_service_id: Mutex::new(None),
        })
        .setup(|app| {
            println!("[AnyChat] Setup starting...");

            let main_webview_window =
                match WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("")
                    .inner_size(1200.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .build()
                {
                    Ok(w) => {
                        println!("[AnyChat] Main window created successfully");
                        w
                    }
                    Err(e) => {
                        println!("[AnyChat] ERROR: Failed to create main window: {}", e);
                        return Err(e.into());
                    }
                };

            let state = app.state::<AppState>();
            #[cfg(debug_assertions)]
            if should_open_devtools() {
                let _ = main_webview_window.open_devtools();
                println!("[AnyChat] DevTools opened for main webview window");
            }

            #[cfg(not(target_os = "windows"))]
            {
                let window = main_webview_window.as_ref().window();
                let (pos, size) = compute_webview_bounds(&window)?;

                let default_services = [
                    ("chatgpt", "https://chatgpt.com"),
                    ("gemini", "https://gemini.google.com"),
                ];

                for (index, (label, url)) in default_services.iter().enumerate() {
                    let app_handle_clone = app.handle().clone();

                    let mut webview_builder =
                        WebviewBuilder::new(*label, WebviewUrl::External(url.parse().unwrap()))
                            .user_agent(USER_AGENT)
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
                                    open_oauth_popup(&app_handle_clone, &url);
                                }

                                handle_external_new_window(&app_handle_clone, &url)
                            });

                    if should_inject_webview_compatibility_script(url) {
                        webview_builder =
                            webview_builder.initialization_script(WEBVIEW_COMPAT_SCRIPT);
                    }

                    let webview = window
                        .add_child(webview_builder, pos, size)
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
            }

            #[cfg(not(target_os = "windows"))]
            {
                let window = main_webview_window.as_ref().window();
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Resized(size) = event {
                        if let Some(webview_window) = app_handle.get_webview_window("main") {
                            let _ = size; // keep pattern explicit: we recompute bounds from window state

                            let window = webview_window.as_ref().window();
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
            }

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
                        let state = app_handle.state::<AppState>();
                        let _ = show_active_windows_service_host(app_handle, &state);
                    }
                    "hide" => {
                        println!("[AnyChat] Tray menu: hide");
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                        let state = app_handle.state::<AppState>();
                        hide_windows_service_hosts(app_handle, &state);
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
            if window.label() != "main" {
                return;
            }

            match event {
                WindowEvent::CloseRequested { api: _api, .. } => {
                    let app_handle = window.app_handle();
                    let state = app_handle.state::<AppState>();
                    hide_windows_service_hosts(&app_handle, &state);

                    #[cfg(target_os = "windows")]
                    {
                        app_handle.exit(0);
                    }

                    #[cfg(not(target_os = "windows"))]
                    {
                        let _ = window.hide();
                        _api.prevent_close();
                    }
                }
                #[cfg(target_os = "windows")]
                WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::ScaleFactorChanged { .. } => {
                    let app_handle = window.app_handle();
                    let state = app_handle.state::<AppState>();
                    let _ = show_active_windows_service_host(&app_handle, &state);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            discover_site_icon,
            host_platform,
            activate_service_content,
            refresh_service_content,
            hide_all_service_content,
            sync_service_host_state,
            sync_docked_content_layout
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                println!("[AnyChat] RunEvent::Reopen");
                show_main_window(_app_handle);
                let state = _app_handle.state::<AppState>();
                let _ = show_active_windows_service_host(_app_handle, &state);
            }
        });
}
