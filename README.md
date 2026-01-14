# AnyChat - 多 AI 聊天聚合应用

一个基于 Tauri 2.0 的桌面应用，可以在一个窗口中统一管理多个 AI Chat 服务（ChatGPT、Gemini、Claude 等），并自动备份聊天记录到本地。

## 功能特性

### 已完成功能

| 功能                | 描述                                                    |
| ------------------- | ------------------------------------------------------- |
| **多服务管理**      | 在一个应用中切换 ChatGPT、Gemini、Claude 等 12+ AI 服务 |
| **左侧导航栏**      | 显示服务图标，点击快速切换                              |
| **键盘快捷键**      | `Cmd+1`, `Cmd+2`... 快速切换服务                        |
| **添加自定义服务**  | 支持添加任意 AI Chat 网站                               |
| **服务启用/禁用**   | 灵活控制显示哪些服务                                    |
| **SQLite 本地存储** | 聊天数据持久化到本地数据库                              |
| **聊天历史管理**    | 查看、搜索、删除历史会话                                |
| **全文搜索**        | 在所有消息中搜索关键词                                  |
| **ChatGPT 导入**    | 支持导入 ChatGPT 官方导出的 JSON 文件                   |
| **数据导出**        | 导出所有数据为 JSON 格式                                |
| **深色模式**        | 默认深色主题                                            |

### 预置服务

| 服务       | 状态     |
| ---------- | -------- |
| ChatGPT    | 默认启用 |
| Gemini     | 默认启用 |
| Claude     | 默认启用 |
| Grok       | 默认隐藏 |
| Copilot    | 默认隐藏 |
| Perplexity | 默认隐藏 |
| Poe        | 默认隐藏 |
| DeepSeek   | 默认隐藏 |
| 通义千问   | 默认隐藏 |
| Kimi       | 默认隐藏 |
| 豆包       | 默认隐藏 |
| 智谱清言   | 默认隐藏 |

### 待完成功能

| 功能         | 优先级 | 描述                                                    |
| ------------ | ------ | ------------------------------------------------------- |
| 自动数据捕获 | P0     | 通过 DOM MutationObserver 自动捕获 WebView 中的聊天内容 |
| 自动备份     | P1     | 定时（每小时）自动备份数据库                            |
| 系统托盘     | P2     | 最小化到系统托盘                                        |
| Gemini 导入  | P2     | 支持导入 Gemini 导出格式                                |
| 拖拽排序     | P2     | 拖拽调整服务顺序                                        |
| 浅色模式切换 | P3     | 支持切换浅色/深色主题                                   |

## 技术栈

```yaml
应用框架: Tauri 2.0
前端框架: React 19 + TypeScript
构建工具: Vite
样式方案: Tailwind CSS 3 + shadcn/ui
图标库: Lucide React
动画库: Framer Motion
状态管理: Zustand (持久化)
数据存储: SQLite (@tauri-apps/plugin-sql)
测试框架: Vitest
代码格式化: Prettier
```

## 开发环境要求

- **Node.js** >= 18
- **pnpm** >= 8
- **Rust** >= 1.70
- **macOS** (当前仅支持 macOS 开发和运行)

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 开发模式

```bash
pnpm tauri dev
```

> 首次运行需要编译 Rust 依赖，可能需要 5-10 分钟，请耐心等待。

### 3. 构建生产版本

```bash
pnpm tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`

## 开发命令

```bash
# 开发模式
pnpm tauri dev

# 仅构建前端
pnpm build

# 类型检查
pnpm lint

# 代码格式化
pnpm format

# 运行测试
pnpm test

# 测试覆盖率
pnpm test:coverage

# 构建生产版本
pnpm tauri build
```

## 使用说明

### 基本操作

| 操作           | 方式                                     |
| -------------- | ---------------------------------------- |
| 切换 AI 服务   | 点击左侧图标，或使用 `Cmd+1`, `Cmd+2`... |
| 添加新服务     | 点击左侧 `+` 按钮                        |
| 查看聊天历史   | 点击左下角时钟图标                       |
| 打开设置       | 点击左下角齿轮图标                       |
| 刷新当前页面   | 点击右上角刷新按钮                       |
| 在浏览器中打开 | 点击右上角外部链接按钮                   |

### 导入 ChatGPT 数据

1. 在 ChatGPT 官网导出你的数据（Settings → Data Controls → Export）
2. 打开 AnyChat 设置 → 点击 "Import ChatGPT"
3. 选择下载的 `conversations.json` 文件
4. 导入完成后可在聊天历史中查看

### 导出数据

1. 打开设置 → 点击 "Export All"
2. 选择保存位置
3. 数据将以 JSON 格式导出

## 项目结构

```
anychat/
├── src/                          # React 前端
│   ├── components/
│   │   ├── ui/                   # shadcn/ui 组件
│   │   ├── AddServiceDialog.tsx  # 添加服务对话框
│   │   ├── AppLayout.tsx         # 主布局
│   │   ├── ChatHistoryPanel.tsx  # 聊天历史面板
│   │   ├── SettingsDialog.tsx    # 设置对话框
│   │   ├── Sidebar.tsx           # 左侧导航栏
│   │   └── WebViewContainer.tsx  # WebView 容器
│   ├── hooks/
│   │   └── useKeyboardShortcuts.ts
│   ├── lib/
│   │   ├── icon.ts               # 图标工具
│   │   └── utils.ts
│   ├── services/
│   │   ├── database.ts           # SQLite 数据库服务
│   │   └── import-export.ts      # 导入导出功能
│   ├── stores/
│   │   └── app-store.ts          # Zustand 状态管理
│   ├── types/
│   │   └── index.ts              # 类型定义 + 预置服务
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css                 # Tailwind + CSS 变量
│
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── lib.rs                # 核心逻辑
│   │   └── main.rs               # 入口
│   ├── capabilities/
│   │   └── default.json          # 权限配置
│   ├── Cargo.toml
│   └── tauri.conf.json           # Tauri 配置
│
├── tests/                        # 测试文件
│   ├── setup.ts                  # 测试初始化
│   └── unit/                     # 单元测试
│       ├── app-store.test.ts
│       └── icon.test.ts
│
├── .sisyphus/plans/              # 开发计划文档
├── docs/                         # 调研报告
├── AGENTS.md                     # AI 辅助开发指南
└── README.md                     # 本文件
```

## 数据库结构

数据存储在 `~/Library/Application Support/com.anychat.app/`

```sql
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT,
  enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  selector_config TEXT,
  created_at INTEGER
);

CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  provider_id TEXT REFERENCES providers(id),
  title TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES chat_sessions(id),
  role TEXT CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  content_hash TEXT,
  source TEXT DEFAULT 'auto',
  created_at INTEGER
);
```

## 常见问题

### Q: 首次运行很慢？

A: 首次运行需要编译 Rust 依赖，这是正常的。后续运行会使用缓存，启动速度会很快。

### Q: WebView 中无法登录 AI 服务？

A: 由于安全限制，某些 AI 服务可能会检测到非标准浏览器环境。这是 Tauri WebView 的已知限制。

### Q: 如何添加其他 AI 服务？

A: 点击左侧 `+` 按钮，输入服务名称和 URL 即可。

### Q: 数据存储在哪里？

A: macOS 上数据存储在 `~/Library/Application Support/com.anychat.app/` 目录下。

## 许可证

MIT
