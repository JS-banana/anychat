# Chat-Box-App 实施计划 v2.0

> 生成时间: 2026-01-13
> 状态: 待实施

---

## 一、项目概述

### 1.1 产品定义

构建一个基于 **Tauri 2.0** 的多 AI Chat 聚合桌面应用，核心能力：
- 统一管理多个 AI Chat 服务（MVP: ChatGPT + Gemini）
- 自动捕获 + 手动导入双重备份机制
- 本地 SQLite 存储，纯离线，无云同步
- 优雅的数据管理和搜索功能

### 1.2 技术决策

| 决策项 | 选择 |
|--------|------|
| 技术框架 | Tauri 2.0 |
| 数据捕获策略 | 自动捕获 + 手动导入备份 |
| 数据加密 | 不需要 |
| MVP 范围 | ChatGPT + Gemini (2个服务) |
| 云同步 | 不需要，纯本地存储 |

### 1.3 技术栈

```yaml
# 核心框架
应用框架: Tauri 2.0
前端框架: React 19 + TypeScript
构建工具: Vite

# UI/样式
样式方案: Tailwind CSS v4
组件库: shadcn/ui (基于 Radix UI)
图标库: Lucide React
动画库: Framer Motion

# 状态与数据
状态管理: Zustand
数据存储: SQLite (@tauri-apps/plugin-sql)
文件系统: @tauri-apps/plugin-fs
对话框: @tauri-apps/plugin-dialog

# 开发工具
包管理: pnpm
代码规范: ESLint + Prettier
类型检查: TypeScript strict mode
```

---

## 二、架构设计

### 2.1 整体架构

```
┌────────────────────────────────────────────────────────────┐
│                      Tauri Application                      │
├────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    React Frontend                    │   │
│  │  ┌──────────┐  ┌────────────────────────────────┐   │   │
│  │  │ Sidebar  │  │        WebView Container        │   │   │
│  │  │          │  │  ┌─────────┐ ┌─────────┐       │   │   │
│  │  │ [GPT]    │  │  │ GPT     │ │ Gemini  │       │   │   │
│  │  │ [Gemini] │  │  │ WebView │ │ WebView │       │   │   │
│  │  │ [+]      │  │  │ (active)│ │ (hidden)│       │   │   │
│  │  │ ──────   │  │  └─────────┘ └─────────┘       │   │   │
│  │  │ [⚙️]     │  │                                 │   │   │
│  │  └──────────┘  └────────────────────────────────┘   │   │
│  │       64px              自适应宽度                    │   │
│  └─────────────────────────────────────────────────────┘   │
├────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Content Script (注入到 WebView)         │   │
│  │  • DOM MutationObserver 监听                        │   │
│  │  • 消息提取 + 防抖去重                               │   │
│  │  • IPC 发送到 Rust 后端                             │   │
│  └─────────────────────────────────────────────────────┘   │
├────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Rust Backend                       │   │
│  │  • SQLite 数据持久化                                 │   │
│  │  • 文件系统操作（备份/导出）                          │   │
│  │  • 系统托盘管理                                      │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
用户在 WebView 中聊天
        ↓
Content Script 检测 DOM 变化
        ↓
提取消息 (防抖 300ms + 去重)
        ↓
通过 IPC 发送到 Frontend
        ↓
Frontend 调用 Tauri Command
        ↓
Rust 后端写入 SQLite
        ↓
定时自动备份 (每小时)
```

---

## 三、数据库设计

### 3.1 表结构

```sql
-- AI 服务提供商
CREATE TABLE providers (
  id TEXT PRIMARY KEY,           -- 'chatgpt', 'gemini'
  name TEXT NOT NULL,            -- 显示名称
  url TEXT NOT NULL,             -- 官方 Chat URL
  icon TEXT,                     -- 图标 (base64 或路径)
  enabled INTEGER DEFAULT 1,     -- 是否启用
  sort_order INTEGER DEFAULT 0,  -- 排序
  selector_config TEXT,          -- JSON: DOM 选择器配置
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 聊天会话
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  title TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 聊天消息
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  content_hash TEXT,             -- 用于去重
  source TEXT DEFAULT 'auto',    -- 'auto' | 'manual_import'
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 应用设置
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 索引
CREATE INDEX idx_sessions_provider ON chat_sessions(provider_id);
CREATE INDEX idx_sessions_updated ON chat_sessions(updated_at DESC);
CREATE INDEX idx_messages_session ON chat_messages(session_id);
CREATE INDEX idx_messages_created ON chat_messages(created_at DESC);
CREATE INDEX idx_messages_hash ON chat_messages(content_hash);

-- 全文搜索
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='chat_messages',
  content_rowid='rowid'
);

-- 自动同步 FTS 索引
CREATE TRIGGER messages_ai AFTER INSERT ON chat_messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON chat_messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
```

### 3.2 默认数据

```sql
-- MVP 预置的两个 AI 服务
INSERT INTO providers (id, name, url, sort_order, selector_config) VALUES
('chatgpt', 'ChatGPT', 'https://chatgpt.com', 1, '{
  "containerSelector": "main",
  "messageSelector": "[data-message-id]",
  "userSelector": "[data-message-author-role=\"user\"]",
  "assistantSelector": "[data-message-author-role=\"assistant\"]",
  "contentSelector": ".markdown"
}'),
('gemini', 'Gemini', 'https://gemini.google.com/app', 2, '{
  "containerSelector": "main",
  "messageSelector": "message-content",
  "userSelector": ".user-message",
  "assistantSelector": ".model-response",
  "contentSelector": ".message-text"
}');
```

---

## 四、项目结构

```
chat-box-app/
├── src/                              # React 前端
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx         # 主布局
│   │   │   ├── Sidebar.tsx           # 左侧导航
│   │   │   └── WebViewContainer.tsx  # WebView 容器
│   │   ├── sidebar/
│   │   │   ├── ProviderIcon.tsx      # 服务图标
│   │   │   ├── AddProviderButton.tsx # 添加服务
│   │   │   └── SettingsButton.tsx    # 设置入口
│   │   ├── settings/
│   │   │   ├── SettingsDialog.tsx    # 设置对话框
│   │   │   ├── GeneralTab.tsx        # 通用设置
│   │   │   ├── DataTab.tsx           # 数据管理
│   │   │   ├── ImportExportTab.tsx   # 导入导出
│   │   │   └── DiagnosticsTab.tsx    # 诊断工具
│   │   ├── chat-history/
│   │   │   ├── ChatHistoryPanel.tsx  # 历史记录面板
│   │   │   ├── SessionList.tsx       # 会话列表
│   │   │   ├── MessageViewer.tsx     # 消息查看器
│   │   │   └── SearchBar.tsx         # 搜索栏
│   │   ├── common/
│   │   │   ├── Toast.tsx             # Toast 通知
│   │   │   ├── Skeleton.tsx          # 加载骨架
│   │   │   └── EmptyState.tsx        # 空状态
│   │   └── ui/                       # shadcn/ui 组件
│   │       ├── sidebar.tsx
│   │       ├── dialog.tsx
│   │       ├── tabs.tsx
│   │       └── ...
│   ├── services/
│   │   ├── database.ts               # 数据库服务
│   │   ├── webview-manager.ts        # WebView 管理
│   │   ├── chat-monitor.ts           # 聊天监控
│   │   ├── backup-manager.ts         # 备份管理
│   │   ├── import-export.ts          # 导入导出
│   │   └── selector-config.ts        # 选择器配置
│   ├── stores/
│   │   ├── useAppStore.ts            # 应用状态
│   │   ├── useProviderStore.ts       # 服务商状态
│   │   └── useSettingsStore.ts       # 设置状态
│   ├── hooks/
│   │   ├── useDatabase.ts            # 数据库 Hook
│   │   ├── useWebView.ts             # WebView Hook
│   │   └── useToast.ts               # Toast Hook
│   ├── types/
│   │   ├── database.ts               # 数据库类型
│   │   ├── provider.ts               # 服务商类型
│   │   └── message.ts                # 消息类型
│   ├── lib/
│   │   ├── utils.ts                  # 工具函数
│   │   └── cn.ts                     # className 合并
│   ├── content-scripts/
│   │   ├── monitor.ts                # 通用监控脚本
│   │   ├── chatgpt.ts                # ChatGPT 适配
│   │   └── gemini.ts                 # Gemini 适配
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css                     # Tailwind 入口
│
├── src-tauri/                        # Rust 后端
│   ├── src/
│   │   ├── lib.rs                    # 主入口
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── database.rs           # 数据库命令
│   │   │   ├── backup.rs             # 备份命令
│   │   │   └── system.rs             # 系统命令
│   │   └── utils/
│   │       └── mod.rs
│   ├── capabilities/
│   │   └── default.json              # 权限配置
│   ├── icons/                        # 应用图标
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── public/
│   └── icons/                        # AI 服务图标
│       ├── chatgpt.svg
│       └── gemini.svg
│
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tailwind.config.js
├── vite.config.ts
└── README.md
```

---

## 五、开发阶段

### Phase 1: 项目初始化 (Day 1)

**目标**: 创建项目并配置基础环境

**任务**:
- [ ] 1.1 创建 Tauri + React 项目
- [ ] 1.2 配置 Tailwind CSS + 深色模式
- [ ] 1.3 安装 shadcn/ui 组件
- [ ] 1.4 配置 Tauri 插件 (sql, fs, dialog)
- [ ] 1.5 创建基础目录结构
- [ ] 1.6 配置 TypeScript 路径别名

**命令**:
```bash
# 创建项目
pnpm create tauri-app@latest chat-box-app --template react-ts
cd chat-box-app

# 安装依赖
pnpm add zustand framer-motion lucide-react
pnpm add -D tailwindcss postcss autoprefixer

# 初始化 Tailwind
npx tailwindcss init -p

# 添加 shadcn/ui
npx shadcn-ui@latest init
npx shadcn-ui@latest add sidebar dialog tabs button input tooltip

# 添加 Tauri 插件
cd src-tauri
cargo add tauri-plugin-sql --features sqlite
cargo add tauri-plugin-fs
cargo add tauri-plugin-dialog
```

**验收标准**:
- 项目可以成功启动 `pnpm tauri dev`
- Tailwind 样式生效
- shadcn/ui 组件可用

---

### Phase 2: 基础 UI 布局 (Day 2)

**目标**: 实现主界面布局

**任务**:
- [ ] 2.1 实现 AppLayout 主布局
- [ ] 2.2 实现 Sidebar 组件 (固定宽度 64px)
- [ ] 2.3 实现 ProviderIcon 组件 (图标 + Tooltip)
- [ ] 2.4 实现 SettingsButton 组件
- [ ] 2.5 实现 SettingsDialog 基础框架
- [ ] 2.6 配置窗口属性 (最小尺寸 1024x768)
- [ ] 2.7 实现深色/浅色模式切换

**验收标准**:
- 左侧导航栏显示 ChatGPT/Gemini 图标
- 点击图标有视觉反馈
- 设置对话框可以打开
- 主题切换正常工作

---

### Phase 3: WebView 集成 (Day 3-4)

**目标**: 实现多 WebView 管理和切换

**任务**:
- [ ] 3.1 实现 WebViewManager 服务
- [ ] 3.2 实现 WebViewContainer 组件
- [ ] 3.3 实现 show/hide 切换逻辑
- [ ] 3.4 处理 WebView 加载状态 (Skeleton)
- [ ] 3.5 处理加载错误和重试
- [ ] 3.6 实现键盘快捷键切换 (Cmd+1/2)
- [ ] 3.7 实现窗口大小变化时 WebView 自适应

**验收标准**:
- 可以加载 ChatGPT 页面
- 可以加载 Gemini 页面
- 切换时页面保持登录状态
- 快捷键正常工作

---

### Phase 4: 数据库初始化 (Day 5)

**目标**: 配置 SQLite 并初始化数据库

**任务**:
- [ ] 4.1 配置 tauri-plugin-sql
- [ ] 4.2 创建数据库初始化脚本
- [ ] 4.3 实现 DatabaseService
- [ ] 4.4 实现 CRUD 操作
- [ ] 4.5 预置 ChatGPT/Gemini 提供商数据
- [ ] 4.6 实现 WAL 模式优化

**验收标准**:
- 数据库文件创建成功
- 表结构正确
- CRUD 操作正常

---

### Phase 5: 数据捕获系统 (Day 6-7)

**目标**: 实现聊天消息自动捕获

**任务**:
- [ ] 5.1 实现 ChatMonitor 类
- [ ] 5.2 实现 MutationObserver 监听
- [ ] 5.3 实现防抖机制 (300ms)
- [ ] 5.4 实现消息去重 (hash)
- [ ] 5.5 实现选择器配置系统
- [ ] 5.6 实现 IPC 通信 (WebView → Rust)
- [ ] 5.7 实现消息持久化到数据库
- [ ] 5.8 实现捕获状态诊断面板

**验收标准**:
- 在 ChatGPT 中发消息后，数据库有记录
- 在 Gemini 中发消息后，数据库有记录
- 无重复消息
- 诊断面板显示正确状态

---

### Phase 6: 手动导入功能 (Day 8)

**目标**: 实现备用的手动导入机制

**任务**:
- [ ] 6.1 实现 ChatGPT 官方导出 JSON 解析
- [ ] 6.2 实现通用 JSON 导入
- [ ] 6.3 实现导入进度显示
- [ ] 6.4 实现导入冲突处理 (去重)
- [ ] 6.5 实现导入结果反馈

**验收标准**:
- 可以导入 ChatGPT 官方导出文件
- 导入进度正确显示
- 重复消息被跳过

---

### Phase 7: 数据管理界面 (Day 9-10)

**目标**: 实现聊天历史管理功能

**任务**:
- [ ] 7.1 实现 ChatHistoryPanel 组件
- [ ] 7.2 实现会话列表 (分组显示)
- [ ] 7.3 实现搜索功能 (FTS5)
- [ ] 7.4 实现消息详情查看
- [ ] 7.5 实现导出功能 (JSON/Markdown)
- [ ] 7.6 实现批量删除
- [ ] 7.7 实现统计信息展示

**验收标准**:
- 可以查看所有会话
- 搜索返回正确结果
- 可以导出为 JSON/Markdown
- 可以删除会话

---

### Phase 8: 设置与备份 (Day 11-12)

**目标**: 完善设置和备份功能

**任务**:
- [ ] 8.1 完善设置对话框各 Tab
- [ ] 8.2 实现自动备份 (每小时)
- [ ] 8.3 实现手动备份
- [ ] 8.4 实现备份列表和恢复
- [ ] 8.5 实现系统托盘
- [ ] 8.6 实现应用退出时备份

**验收标准**:
- 设置可以正常保存
- 自动备份定时执行
- 可以手动备份和恢复
- 系统托盘正常显示

---

### Phase 9: 优化与收尾 (Day 13-14)

**目标**: 性能优化和最终测试

**任务**:
- [ ] 9.1 WebView 懒加载优化
- [ ] 9.2 虚拟滚动优化
- [ ] 9.3 SQLite WAL 模式
- [ ] 9.4 错误处理完善
- [ ] 9.5 首次使用引导
- [ ] 9.6 键盘快捷键完善
- [ ] 9.7 打包测试 (macOS)
- [ ] 9.8 编写 README

**验收标准**:
- 应用启动时间 < 3秒
- 内存占用 < 200MB
- 连续使用 1 小时无崩溃
- 打包成功

---

## 六、风险控制

### 6.1 DOM 选择器失效应对

- 提供远程配置更新机制
- 用户可自定义选择器
- 手动导入作为备用方案

### 6.2 捕获失败诊断

- 设置页面提供诊断面板
- 显示每个服务的捕获状态
- 提供故障排查建议

---

## 七、交付清单

### MVP 功能清单

| 功能 | 优先级 | 状态 |
|------|--------|------|
| 左侧导航 + WebView 布局 | P0 | ⬜ |
| ChatGPT/Gemini 切换 | P0 | ⬜ |
| 自动数据捕获 (DOM) | P0 | ⬜ |
| SQLite 本地存储 | P0 | ⬜ |
| 手动导入 (ChatGPT 格式) | P0 | ⬜ |
| 聊天历史查看 | P0 | ⬜ |
| 全文搜索 | P1 | ⬜ |
| 导出 (JSON/Markdown) | P1 | ⬜ |
| 自动备份 | P1 | ⬜ |
| 深色模式 | P1 | ⬜ |
| 设置面板 | P1 | ⬜ |
| 诊断工具 | P2 | ⬜ |
| 系统托盘 | P2 | ⬜ |
| 快捷键 | P2 | ⬜ |

---

## 八、参考资源

### 官方文档
- [Tauri 官方文档](https://tauri.app/)
- [shadcn/ui 组件库](https://ui.shadcn.com/)
- [Tauri SQL Plugin](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/sql)

### 参考项目
- [tauri-ui 模板](https://github.com/agmmnn/tauri-ui)
- [OpenChat](https://github.com/team-forge-ai/openchat)
- [ChatBox](https://github.com/chatboxai/chatbox)
