# chat-box-app

一个可以访问不同 AI chat web 的客户端，可自动备份聊天记录数据

## 产品形态描述

考虑做一个可自动备份的客户端 app

1. 使用electron或者tauri（更轻量，我觉得这个更好）之类的工具，实现一个webview容器 app 应用，可以在 mac 电脑上便捷打开使用

2. 可以添加并管理 gpt/gemini/DeepSeek 等等的Ai chat聊天界面，其实就是官方chat web网站，而不是 provider api 的方式

3. 这样做的目的是，为了在客户端，能够自动缓存或者说是记录不同聊天chat的数据，然后备份到软件中，可以是 sqlite，择优选择合适的即可。
    - 这一步我理解其实和在浏览器中访问页面然后使用 chrome 缓存插件实现聊天记录的存储是一样的效果
    - 区别就是，可以本地化在一个 app 中实现，不用再切换浏览器页面，专门用来管理 chat 聊天

4. 目前很多人都频繁使用多个 AI 模型，一方面，这样来回访问不同的浏览器网站，不方便使用，有人就希望像使用 chat box 一样，有个软件能够方便统一的管理这些；其次，不同 AI 模型的聊天数据，我希望能够统一维护，做到可控，我很看重这些数据，我希望能够自己管理和记录这些数据

5. 最后，可以进一步提供管理聊天数据的能力，可以是专门的功能模块界面，有不错的交互和功能设计

这样子，相当于是个chat box，聊天都在这个软件中进行，可以保证能够留存聊天数据的能力

## 界面

使用 UI 设计的 skill 优化界面的美观度

希望功能是这样的：

1. 左侧提供一个宽度不大的竖直的导航，显示的是对应 ai 产品的官方网站的 logo 图标
2. 点击图标可以快速切换到不同的 chat 页面
3. 可以自定义添加不同的 chat 页面，比如 https://gemini.google.com 、https://chatgpt.com
4. 右侧渲染的就是这个 chat 页面，整个应用可以拖拽控制宽高大小
5. 左下角提供设置入口，相关的聊天数据管理等功能都放在这里

---

## 技术选型（已确定）

| 决策项 | 选择 |
|--------|------|
| 技术框架 | Tauri 2.0 |
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite |
| 样式方案 | Tailwind CSS 3 + shadcn/ui |
| 状态管理 | Zustand (持久化) |
| 数据存储 | SQLite (@tauri-apps/plugin-sql) |
| 数据捕获策略 | 自动捕获 + 手动导入备份 |
| 数据加密 | 不需要 |
| 云同步 | 不需要，纯本地存储 |
| MVP 范围 | ChatGPT + Gemini (2个服务) |

## 开发进度

### ✅ 已完成功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 项目初始化 | ✅ | Tauri 2.0 + React + TypeScript + Tailwind |
| 左侧导航栏 (Sidebar) | ✅ | 64px 宽度，显示服务图标 |
| WebView 容器 | ✅ | iframe 实现，支持多服务切换 |
| 键盘快捷键 | ✅ | Cmd+1/2/... 快速切换服务 |
| 添加自定义服务 | ✅ | 对话框表单 |
| 服务启用/禁用 | ✅ | 设置中管理 |
| SQLite 数据库 | ✅ | 表结构、CRUD、内容去重 |
| 聊天历史管理 | ✅ | ChatHistoryPanel - 查看、搜索、删除 |
| 全文搜索 | ✅ | 在所有消息中搜索 |
| ChatGPT 导入 | ✅ | 支持官方导出 JSON 格式 |
| 数据导出 | ✅ | 导出所有数据为 JSON |
| 深色模式 | ✅ | 默认启用 |
| 设置面板 | ✅ | 服务管理 + 导入导出 + 统计 |
| 前端构建 | ✅ | pnpm build 通过 |
| Rust 后端编译 | ✅ | cargo check 通过 |

### ⏳ 待完成功能

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 自动数据捕获 | P0 | 需要重构为 iframe 方案（见下方技术说明） |
| 自动备份 | P1 | 定时（每小时）自动备份数据库文件 |
| 系统托盘 | P2 | 最小化到系统托盘，后台运行 |
| Gemini 导入 | P2 | 支持 Gemini 导出格式解析 |
| 拖拽排序 | ✅ | 已完成，使用 @dnd-kit |
| 浅色模式切换 | P3 | 支持浅色/深色主题切换 |

### 🔧 技术限制说明

**自动数据捕获功能受 Tauri 安全限制**：

1. **问题**：通过 `window.add_child()` 创建的子 WebView 加载外部 URL（如 chatgpt.com）时，无法使用 `window.__TAURI__` API
2. **原因**：Tauri 出于安全考虑，不向外部 URL 注入 Tauri API
3. **影响**：AUTH_SCRIPT 中的 MutationObserver 可以捕获聊天内容，但无法将数据发送回 Rust

**解决方案**：需要重构为 **iframe + postMessage** 方案
- 用 React iframe 替代 Tauri 子 WebView
- 通过 `postMessage` 在 iframe 和主窗口之间通信
- 主窗口通过 Tauri IPC 将数据发送到 Rust

**临时方案**：使用手动导入功能（ChatGPT 导出 JSON）

## 项目结构

```
chat-box-app/
├── src/                          # React 前端
│   ├── components/
│   │   ├── ui/                   # shadcn/ui 组件 (Button, Dialog, Input, Tooltip)
│   │   ├── AddServiceDialog.tsx  # 添加服务对话框
│   │   ├── AppLayout.tsx         # 主布局
│   │   ├── ChatHistoryPanel.tsx  # 聊天历史管理面板
│   │   ├── SettingsDialog.tsx    # 设置对话框（含导入导出）
│   │   ├── Sidebar.tsx           # 左侧导航栏
│   │   └── WebViewContainer.tsx  # WebView/iframe 容器
│   ├── hooks/
│   │   └── useKeyboardShortcuts.ts  # 快捷键 Hook
│   ├── lib/
│   │   └── utils.ts              # cn() 工具函数
│   ├── services/
│   │   ├── database.ts           # SQLite 数据库服务
│   │   └── import-export.ts      # 导入导出功能
│   ├── stores/
│   │   └── app-store.ts          # Zustand 状态管理
│   ├── types/
│   │   └── index.ts              # 类型定义
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css                 # Tailwind + CSS 变量
│
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── lib.rs                # 插件配置
│   │   └── main.rs               # 入口
│   ├── capabilities/
│   │   └── default.json          # 权限配置
│   ├── Cargo.toml
│   └── tauri.conf.json           # Tauri 配置
│
├── .sisyphus/plans/              # 开发计划文档
│   ├── chat-box-app-implementation-plan.md
│   └── code-examples.md
├── docs/                         # 调研报告
│   ├── 调研报告.md
│   └── 报告2.md
├── AGENTS.md                     # 本文件
└── README.md                     # 使用说明
```

## 数据库设计

```sql
-- AI 服务提供商
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

-- 聊天会话
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  provider_id TEXT REFERENCES providers(id),
  title TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);

-- 聊天消息
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

## 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式（首次运行需编译 Rust，约 5-10 分钟）
pnpm tauri dev

# 仅构建前端
pnpm build

# 类型检查
pnpm exec tsc --noEmit

# 构建生产版本
pnpm tauri build
```

## 注意事项

1. **首次运行**: 需要编译 Rust 依赖，耐心等待 5-10 分钟
2. **WebView 限制**: 由于 Tauri WebView 安全限制，某些 AI 服务可能检测到非标准浏览器环境
3. **数据位置**: macOS 上数据存储在 `~/Library/Application Support/com.sunss.chat-box-app/`
