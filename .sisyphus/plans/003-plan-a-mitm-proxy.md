# 方案 A: MITM 代理实现计划

> 状态: 🔄 进行中
> 分支: `feature/mitm-proxy`
> 工作目录: `../anychat-mitm/`
> 预估时间: 1-2 周

## 一、架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                       AnyChat 应用                           │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Rust 后端                                             │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │ MITM Proxy Server (127.0.0.1:8888)              │  │  │
│  │  │ ├── TLS 终结 (rcgen + rustls)                   │  │  │
│  │  │ ├── 请求转发 (reqwest)                          │  │  │
│  │  │ ├── 响应头处理:                                 │  │  │
│  │  │ │   └── 删除 Content-Security-Policy            │  │  │
│  │  │ │   └── 删除 X-Frame-Options                    │  │  │
│  │  │ │   └── 删除 X-WebKit-CSP                       │  │  │
│  │  │ └── 桥接路由 /_bridge/capture                   │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                              ▲                               │
│                              │ proxy_url                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Webview (chatgpt.com)                                 │  │
│  │ └── CSP 已被剥离，注入脚本可以:                       │  │
│  │     fetch('http://127.0.0.1:8888/_bridge/capture')   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 二、实施步骤

### Step 1: 添加依赖

**文件**: `src-tauri/Cargo.toml`

```toml
[dependencies]
# 现有依赖...

# MITM 代理
hudsucker = "0.21"
rcgen = { version = "0.12", features = ["pem"] }
rustls = "0.21"
rustls-pemfile = "1"
tokio-rustls = "0.24"
```

### Step 2: 证书管理模块

**文件**: `src-tauri/src/cert.rs`

```rust
use rcgen::{
    Certificate, CertificateParams, DistinguishedName, 
    DnType, IsCa, KeyPair, BasicConstraints
};
use std::path::PathBuf;
use std::fs;

pub struct CertManager {
    pub ca_cert: Certificate,
    cert_dir: PathBuf,
}

impl CertManager {
    /// 初始化证书管理器，生成或加载 Root CA
    pub fn init(app_data_dir: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        let cert_dir = app_data_dir.join("certs");
        fs::create_dir_all(&cert_dir)?;
        
        let ca_cert_path = cert_dir.join("anychat-ca.pem");
        let ca_key_path = cert_dir.join("anychat-ca-key.pem");
        
        let ca_cert = if ca_cert_path.exists() && ca_key_path.exists() {
            // 加载现有 CA
            Self::load_ca(&ca_cert_path, &ca_key_path)?
        } else {
            // 生成新 CA
            let ca = Self::generate_ca()?;
            
            // 保存 CA 证书和私钥
            fs::write(&ca_cert_path, ca.serialize_pem()?)?;
            fs::write(&ca_key_path, ca.serialize_private_key_pem())?;
            
            println!("[AnyChat] Generated new CA certificate: {:?}", ca_cert_path);
            ca
        };
        
        Ok(Self { ca_cert, cert_dir })
    }
    
    /// 生成 Root CA 证书
    fn generate_ca() -> Result<Certificate, Box<dyn std::error::Error>> {
        let mut params = CertificateParams::default();
        
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.distinguished_name = DistinguishedName::new();
        params.distinguished_name.push(DnType::CommonName, "AnyChat Proxy CA");
        params.distinguished_name.push(DnType::OrganizationName, "AnyChat");
        
        // CA 有效期 10 年
        params.not_before = time::OffsetDateTime::now_utc();
        params.not_after = params.not_before + time::Duration::days(3650);
        
        Ok(Certificate::from_params(params)?)
    }
    
    /// 加载现有 CA
    fn load_ca(cert_path: &PathBuf, key_path: &PathBuf) -> Result<Certificate, Box<dyn std::error::Error>> {
        let cert_pem = fs::read_to_string(cert_path)?;
        let key_pem = fs::read_to_string(key_path)?;
        
        let params = CertificateParams::from_ca_cert_pem(&cert_pem, KeyPair::from_pem(&key_pem)?)?;
        Ok(Certificate::from_params(params)?)
    }
    
    /// 为指定域名签发证书
    pub fn sign_for_domain(&self, domain: &str) -> Result<(String, String), Box<dyn std::error::Error>> {
        let mut params = CertificateParams::new(vec![domain.to_string()])?;
        
        // 站点证书有效期 1 年
        params.not_before = time::OffsetDateTime::now_utc();
        params.not_after = params.not_before + time::Duration::days(365);
        
        let cert = Certificate::from_params(params)?;
        let cert_pem = cert.serialize_pem_with_signer(&self.ca_cert)?;
        let key_pem = cert.serialize_private_key_pem();
        
        Ok((cert_pem, key_pem))
    }
    
    /// 获取 CA 证书路径 (用于引导用户安装)
    pub fn ca_cert_path(&self) -> PathBuf {
        self.cert_dir.join("anychat-ca.pem")
    }
}
```

### Step 3: MITM 代理服务

**文件**: `src-tauri/src/proxy.rs`

```rust
use hudsucker::{
    async_trait::async_trait,
    certificate_authority::RcgenAuthority,
    hyper::{Body, Request, Response, StatusCode},
    HttpContext, HttpHandler, ProxyBuilder, RequestOrResponse,
};
use std::sync::Arc;
use tauri::AppHandle;

pub struct AnyChatHandler {
    app_handle: AppHandle,
}

impl AnyChatHandler {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl HttpHandler for AnyChatHandler {
    async fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        req: Request<Body>,
    ) -> RequestOrResponse {
        let path = req.uri().path();
        
        // 处理桥接请求
        if path == "/_bridge/capture" {
            return self.handle_capture(req).await.into();
        }
        
        // 其他请求正常转发
        req.into()
    }

    async fn handle_response(
        &mut self,
        _ctx: &HttpContext,
        mut res: Response<Body>,
    ) -> Response<Body> {
        // 剥离 CSP 相关响应头
        let headers = res.headers_mut();
        
        headers.remove("content-security-policy");
        headers.remove("content-security-policy-report-only");
        headers.remove("x-frame-options");
        headers.remove("x-webkit-csp");
        headers.remove("x-content-security-policy");
        
        // 可选：添加宽松的 CSP
        // headers.insert(
        //     "content-security-policy",
        //     "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:".parse().unwrap()
        // );
        
        res
    }
}

impl AnyChatHandler {
    async fn handle_capture(&self, req: Request<Body>) -> Response<Body> {
        // 处理 CORS preflight
        if req.method() == hyper::Method::OPTIONS {
            return Response::builder()
                .status(StatusCode::OK)
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Methods", "POST, OPTIONS")
                .header("Access-Control-Allow-Headers", "Content-Type")
                .body(Body::empty())
                .unwrap();
        }
        
        // 解析请求体
        let body_bytes = match hyper::body::to_bytes(req.into_body()).await {
            Ok(bytes) => bytes,
            Err(e) => {
                return Response::builder()
                    .status(StatusCode::BAD_REQUEST)
                    .body(Body::from(format!(r#"{{"error":"{}"}}"#, e)))
                    .unwrap();
            }
        };
        
        // 解析 JSON
        match serde_json::from_slice::<serde_json::Value>(&body_bytes) {
            Ok(payload) => {
                println!("[AnyChat] Proxy captured: {:?}", payload);
                
                // TODO: 保存到数据库/文件
                // 发送事件到前端
                let _ = self.app_handle.emit_all("chat-captured", &payload);
                
                Response::builder()
                    .status(StatusCode::OK)
                    .header("Content-Type", "application/json")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(Body::from(r#"{"status":"ok"}"#))
                    .unwrap()
            }
            Err(e) => {
                Response::builder()
                    .status(StatusCode::BAD_REQUEST)
                    .header("Content-Type", "application/json")
                    .body(Body::from(format!(r#"{{"error":"{}"}}"#, e)))
                    .unwrap()
            }
        }
    }
}

/// 启动 MITM 代理服务器
pub async fn start_proxy_server(
    app_handle: AppHandle,
    port: u16,
    ca_cert: rcgen::Certificate,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let private_key = ca_cert.serialize_private_key_der();
    let ca_cert_der = ca_cert.serialize_der()?;
    
    let ca = RcgenAuthority::new(
        rustls::PrivateKey(private_key),
        rustls::Certificate(ca_cert_der),
        1000, // 证书缓存大小
    )?;
    
    let proxy = ProxyBuilder::new()
        .with_addr(([127, 0, 0, 1], port).into())
        .with_rustls_client()
        .with_ca(ca)
        .with_http_handler(AnyChatHandler::new(app_handle))
        .build();
    
    println!("[AnyChat] MITM Proxy started on 127.0.0.1:{}", port);
    
    proxy.start(tokio::signal::ctrl_c()).await?;
    
    Ok(())
}
```

### Step 4: 集成到 Tauri 启动流程

**文件**: `src-tauri/src/lib.rs` (修改)

```rust
mod cert;
mod proxy;

const PROXY_PORT: u16 = 8888;

pub fn run() {
    tauri::Builder::default()
        // ... 现有配置 ...
        .setup(|app| {
            // 初始化证书管理器
            let app_data_dir = app.path_resolver()
                .app_data_dir()
                .expect("Failed to get app data dir");
            
            let cert_manager = cert::CertManager::init(app_data_dir.clone())
                .expect("Failed to init cert manager");
            
            // 启动 MITM 代理 (在后台线程)
            let app_handle = app.handle().clone();
            let ca_cert = cert_manager.ca_cert.clone();
            
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    if let Err(e) = proxy::start_proxy_server(
                        app_handle, 
                        PROXY_PORT, 
                        ca_cert
                    ).await {
                        eprintln!("[AnyChat] Proxy error: {}", e);
                    }
                });
            });
            
            // ... 其余 setup 代码 ...
            
            Ok(())
        })
        // ...
}
```

### Step 5: 配置 Webview 使用代理

**文件**: `src-tauri/src/lib.rs` (修改 WebviewBuilder)

```rust
fn create_webview_for_service(/* ... */) -> Result<(), String> {
    let proxy_url = format!("http://127.0.0.1:{}", PROXY_PORT);
    
    let webview_builder = WebviewBuilder::new(label, WebviewUrl::External(parsed_url))
        .proxy_url(proxy_url.parse().unwrap())  // 关键配置
        .user_agent(USER_AGENT)
        .initialization_script(AUTH_SCRIPT)
        // ... 其他配置 ...
    ;
    
    // Windows: 添加忽略证书错误参数
    #[cfg(target_os = "windows")]
    let webview_builder = {
        // 注意: 这可能需要通过 tauri.conf.json 配置
        webview_builder
    };
    
    // ...
}
```

### Step 6: 更新注入脚本

**文件**: `src-tauri/src/lib.rs` (修改 AUTH_SCRIPT)

```javascript
// 在 sendToBackend 函数中
function sendToBackend(payload) {
    const PROXY_PORT = 8888;
    
    // CSP 已被代理剥离，可以直接 fetch
    fetch(`http://127.0.0.1:${PROXY_PORT}/_bridge/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'chat-capture',
            serviceId: payload.serviceId,
            messages: payload.messages,
            url: window.location.href,
            timestamp: Date.now()
        })
    })
    .then(res => res.json())
    .then(data => {
        console.log('[AnyChat] Captured successfully:', data);
    })
    .catch(err => {
        console.log('[AnyChat] Bridge error, using fallback:', err);
        // 回退到队列模式
        window.__anychatQueue = window.__anychatQueue || [];
        window.__anychatQueue.push({
            serviceId: payload.serviceId,
            messages: payload.messages,
            url: window.location.href,
            timestamp: Date.now()
        });
    });
    
    return true;
}
```

### Step 7: Windows 配置

**文件**: `src-tauri/tauri.conf.json`

```json
{
  "tauri": {
    "windows": [
      {
        "label": "main",
        "additionalBrowserArgs": "--ignore-certificate-errors --test-type"
      }
    ]
  }
}
```

### Step 8: macOS 证书安装引导

```rust
#[cfg(target_os = "macos")]
pub fn prompt_ca_installation(cert_path: &std::path::Path) {
    use std::process::Command;
    
    // 方法1: 打开钥匙串访问
    let _ = Command::new("open")
        .arg("-a")
        .arg("Keychain Access")
        .arg(cert_path)
        .spawn();
    
    // 方法2: 使用 security 命令 (需要管理员权限)
    // let _ = Command::new("security")
    //     .args(["add-trusted-cert", "-d", "-r", "trustRoot", "-k", "/Library/Keychains/System.keychain"])
    //     .arg(cert_path)
    //     .spawn();
}
```

## 三、验证清单

| 验证项 | 状态 | 备注 |
|--------|------|------|
| 代理服务器启动成功 | ⬜ | 检查端口 8888 |
| ChatGPT 通过代理正常加载 | ⬜ | 检查页面功能 |
| CSP 头被成功剥离 | ⬜ | DevTools Network 面板 |
| 注入脚本 fetch 成功 | ⬜ | Console 日志 |
| 数据写入本地 | ⬜ | 检查 JSONL 文件 |
| Windows 测试 | ⬜ | --ignore-certificate-errors |
| macOS 测试 | ⬜ | CA 信任流程 |

## 四、风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| macOS 证书信任流程复杂 | 用户体验差 | 提供清晰的 UI 引导 |
| `proxy_url` 不生效 | 方案失败 | 尝试 additionalBrowserArgs |
| HTTPS 握手失败 | 无法加载网页 | 检查证书链 |
| 代理性能问题 | 网页变慢 | 优化连接池 |
| hudsucker 不兼容 | 编译失败 | 尝试 http-mitm-proxy |

## 五、回退条件

如果以下情况发生，转向方案 B (Electron):

1. `proxy_url` 在 Tauri 中完全不工作
2. macOS 证书信任流程导致大量用户放弃
3. 代理导致不可接受的性能下降
4. 2 周内无法完成核心验证

## 六、参考代码

- [hudsucker examples](https://github.com/omame/hudsucker/tree/main/examples)
- [rcgen examples](https://github.com/rustls/rcgen/tree/main/examples)
- [Tauri proxy_url](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html#method.proxy_url)
