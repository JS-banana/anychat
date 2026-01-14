# 关键代码示例

本文档提供 Chat-Box-App 的核心代码示例，供实施时参考。

---

## 1. WebView 管理器

```typescript
// src/services/webview-manager.ts
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface WebViewConfig {
  id: string;
  url: string;
  label: string;
}

export class WebViewManager {
  private webviews = new Map<string, Webview>();
  private currentId: string | null = null;
  private sidebarWidth = 64;

  async initialize(providers: WebViewConfig[]): Promise<void> {
    for (const provider of providers) {
      await this.createWebView(provider.id, provider.url);
    }
  }

  async createWebView(id: string, url: string): Promise<Webview> {
    if (this.webviews.has(id)) {
      return this.webviews.get(id)!;
    }

    const appWindow = getCurrentWindow();
    const size = await appWindow.innerSize();

    const webview = new Webview(appWindow, `webview-${id}`, {
      url,
      x: this.sidebarWidth,
      y: 0,
      width: size.width - this.sidebarWidth,
      height: size.height,
    });

    // 初始隐藏
    await webview.hide();
    this.webviews.set(id, webview);

    // 监听窗口大小变化
    appWindow.onResized(async ({ payload: size }) => {
      const wv = this.webviews.get(id);
      if (wv) {
        await wv.setSize({
          width: size.width - this.sidebarWidth,
          height: size.height,
        });
      }
    });

    return webview;
  }

  async switchTo(id: string): Promise<void> {
    // 隐藏当前
    if (this.currentId && this.currentId !== id) {
      const current = this.webviews.get(this.currentId);
      await current?.hide();
    }

    // 显示目标
    const target = this.webviews.get(id);
    if (target) {
      await target.show();
      this.currentId = id;
    }
  }

  getCurrentId(): string | null {
    return this.currentId;
  }

  async destroyAll(): Promise<void> {
    for (const [id, webview] of this.webviews) {
      await webview.close();
    }
    this.webviews.clear();
    this.currentId = null;
  }
}

export const webviewManager = new WebViewManager();
```

---

## 2. 数据库服务

```typescript
// src/services/database.ts
import Database from '@tauri-apps/plugin-sql';

export interface Provider {
  id: string;
  name: string;
  url: string;
  icon?: string;
  enabled: boolean;
  sortOrder: number;
  selectorConfig: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  providerId: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  contentHash?: string;
  source: 'auto' | 'manual_import';
  createdAt: number;
}

class DatabaseService {
  private db: Database | null = null;
  private static instance: DatabaseService;

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  async initialize(): Promise<void> {
    if (this.db) return;

    this.db = await Database.load('sqlite:chatbox.db');
    await this.createTables();
    await this.enableWAL();
    await this.seedDefaultProviders();
  }

  private async createTables(): Promise<void> {
    await this.db?.execute(`
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        icon TEXT,
        enabled INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        selector_config TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);

    await this.db?.execute(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES providers(id),
        title TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);

    await this.db?.execute(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        content_hash TEXT,
        source TEXT DEFAULT 'auto',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);

    await this.db?.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // 创建索引
    await this.db?.execute(
      `CREATE INDEX IF NOT EXISTS idx_sessions_provider ON chat_sessions(provider_id)`
    );
    await this.db?.execute(
      `CREATE INDEX IF NOT EXISTS idx_sessions_updated ON chat_sessions(updated_at DESC)`
    );
    await this.db?.execute(
      `CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id)`
    );
    await this.db?.execute(
      `CREATE INDEX IF NOT EXISTS idx_messages_created ON chat_messages(created_at DESC)`
    );
    await this.db?.execute(
      `CREATE INDEX IF NOT EXISTS idx_messages_hash ON chat_messages(content_hash)`
    );

    // 全文搜索
    await this.db?.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content)
    `);
  }

  private async enableWAL(): Promise<void> {
    await this.db?.execute(`PRAGMA journal_mode=WAL`);
    await this.db?.execute(`PRAGMA synchronous=NORMAL`);
  }

  private async seedDefaultProviders(): Promise<void> {
    const existing = await this.db?.select<Provider[]>('SELECT * FROM providers');
    if (existing && existing.length > 0) return;

    await this.db?.execute(`
      INSERT INTO providers (id, name, url, sort_order, selector_config) VALUES
      ('chatgpt', 'ChatGPT', 'https://chatgpt.com', 1, '${JSON.stringify({
        containerSelector: 'main',
        messageSelector: '[data-message-id]',
        userSelector: '[data-message-author-role="user"]',
        assistantSelector: '[data-message-author-role="assistant"]',
        contentSelector: '.markdown',
      })}'),
      ('gemini', 'Gemini', 'https://gemini.google.com/app', 2, '${JSON.stringify({
        containerSelector: 'main',
        messageSelector: 'message-content',
        userSelector: '.user-message',
        assistantSelector: '.model-response',
        contentSelector: '.message-text',
      })}')
    `);
  }

  // Provider 操作
  async getProviders(): Promise<Provider[]> {
    const rows = await this.db?.select<any[]>('SELECT * FROM providers ORDER BY sort_order');
    return (rows || []).map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      icon: row.icon,
      enabled: row.enabled === 1,
      sortOrder: row.sort_order,
      selectorConfig: row.selector_config,
      createdAt: row.created_at,
    }));
  }

  // Session 操作
  async createSession(providerId: string, title: string): Promise<string> {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await this.db?.execute(
      `INSERT INTO chat_sessions (id, provider_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, providerId, title, now, now]
    );

    return id;
  }

  async getSessions(providerId?: string): Promise<ChatSession[]> {
    let query = 'SELECT * FROM chat_sessions';
    const params: any[] = [];

    if (providerId) {
      query += ' WHERE provider_id = ?';
      params.push(providerId);
    }

    query += ' ORDER BY updated_at DESC';

    const rows = await this.db?.select<any[]>(query, params);
    return (rows || []).map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      title: row.title,
      messageCount: row.message_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // Message 操作
  async addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    source: 'auto' | 'manual_import' = 'auto'
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const hash = await this.generateHash(role, content);

    // 去重检查
    const existing = await this.db?.select<any[]>(
      'SELECT id FROM chat_messages WHERE content_hash = ?',
      [hash]
    );
    if (existing && existing.length > 0) {
      return existing[0].id;
    }

    await this.db?.execute(
      `INSERT INTO chat_messages (id, session_id, role, content, content_hash, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, sessionId, role, content, hash, source, now]
    );

    // 更新 session
    await this.db?.execute(
      `UPDATE chat_sessions SET 
         message_count = message_count + 1, 
         updated_at = ? 
       WHERE id = ?`,
      [now, sessionId]
    );

    // 更新全文索引
    await this.db?.execute(
      `INSERT INTO messages_fts(rowid, content) VALUES (last_insert_rowid(), ?)`,
      [content]
    );

    return id;
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const rows = await this.db?.select<any[]>(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC',
      [sessionId]
    );
    return (rows || []).map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      contentHash: row.content_hash,
      source: row.source,
      createdAt: row.created_at,
    }));
  }

  async searchMessages(query: string): Promise<ChatMessage[]> {
    const rows = await this.db?.select<any[]>(
      `SELECT m.* FROM chat_messages m
       JOIN messages_fts fts ON m.rowid = fts.rowid
       WHERE messages_fts MATCH ?
       ORDER BY m.created_at DESC
       LIMIT 100`,
      [query]
    );
    return (rows || []).map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      contentHash: row.content_hash,
      source: row.source,
      createdAt: row.created_at,
    }));
  }

  // 工具方法
  private async generateHash(role: string, content: string): Promise<string> {
    const str = `${role}:${content.slice(0, 200)}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

export const db = DatabaseService.getInstance();
```

---

## 3. 聊天监控器

```typescript
// src/content-scripts/monitor.ts

interface SelectorConfig {
  containerSelector: string;
  messageSelector: string;
  userSelector: string;
  assistantSelector: string;
  contentSelector: string;
}

interface CapturedMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  hash: string;
}

class ChatMonitor {
  private observer: MutationObserver | null = null;
  private messageHashes = new Set<string>();
  private debounceTimer: number | null = null;
  private config: SelectorConfig;
  private providerId: string;

  constructor(providerId: string, config: SelectorConfig) {
    this.providerId = providerId;
    this.config = config;
  }

  start(): boolean {
    const container = document.querySelector(this.config.containerSelector);
    if (!container) {
      console.error(
        `[ChatMonitor:${this.providerId}] Container not found: ${this.config.containerSelector}`
      );
      return false;
    }

    this.observer = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });

    this.observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    console.log(
      `[ChatMonitor:${this.providerId}] Started watching: ${this.config.containerSelector}`
    );
    return true;
  }

  private handleMutations(mutations: MutationRecord[]): void {
    // 防抖处理：300ms 内的变化合并处理
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.processMessages();
    }, 300);
  }

  private processMessages(): void {
    const messages = this.extractAllMessages();

    messages.forEach((msg) => {
      // 去重检查
      if (!this.messageHashes.has(msg.hash)) {
        this.messageHashes.add(msg.hash);
        this.sendToHost(msg);
        console.log(
          `[ChatMonitor:${this.providerId}] New message captured:`,
          msg.role,
          msg.content.slice(0, 50)
        );
      }
    });
  }

  private extractAllMessages(): CapturedMessage[] {
    const messages: CapturedMessage[] = [];
    const elements = document.querySelectorAll(this.config.messageSelector);

    elements.forEach((el) => {
      const isUser =
        el.matches(this.config.userSelector) || el.querySelector(this.config.userSelector) !== null;
      const isAssistant =
        el.matches(this.config.assistantSelector) ||
        el.querySelector(this.config.assistantSelector) !== null;

      if (isUser || isAssistant) {
        const contentEl = el.querySelector(this.config.contentSelector) || el;
        const content = contentEl.textContent?.trim();

        if (content && content.length > 0) {
          const hash = this.generateHash(isUser ? 'user' : 'assistant', content);
          messages.push({
            role: isUser ? 'user' : 'assistant',
            content,
            timestamp: Date.now(),
            hash,
          });
        }
      }
    });

    return messages;
  }

  private generateHash(role: string, content: string): string {
    const str = `${role}:${content.slice(0, 200)}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  private sendToHost(msg: CapturedMessage): void {
    // 发送到父窗口
    window.parent.postMessage(
      {
        type: 'CHAT_MESSAGE_CAPTURED',
        providerId: this.providerId,
        payload: msg,
      },
      '*'
    );
  }

  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    console.log(`[ChatMonitor:${this.providerId}] Stopped`);
  }

  // 诊断方法
  diagnose(): { healthy: boolean; error?: string } {
    const container = document.querySelector(this.config.containerSelector);
    if (!container) {
      return { healthy: false, error: `Container not found: ${this.config.containerSelector}` };
    }

    const messages = document.querySelectorAll(this.config.messageSelector);
    if (messages.length === 0) {
      return {
        healthy: false,
        error: `No messages found with selector: ${this.config.messageSelector}`,
      };
    }

    return { healthy: true };
  }
}

// 导出给 WebView 使用
(window as any).__ChatMonitor = ChatMonitor;
```

---

## 4. Zustand 状态管理

```typescript
// src/stores/useProviderStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { db, Provider } from '@/services/database';
import { webviewManager } from '@/services/webview-manager';

interface ProviderState {
  providers: Provider[];
  activeProviderId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadProviders: () => Promise<void>;
  setActiveProvider: (id: string) => Promise<void>;
  addProvider: (provider: Omit<Provider, 'id' | 'createdAt'>) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
}

export const useProviderStore = create<ProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      activeProviderId: null,
      isLoading: false,
      error: null,

      loadProviders: async () => {
        set({ isLoading: true, error: null });
        try {
          const providers = await db.getProviders();
          set({ providers, isLoading: false });

          // 初始化 WebViews
          for (const provider of providers.filter((p) => p.enabled)) {
            await webviewManager.createWebView(provider.id, provider.url);
          }

          // 默认激活第一个
          if (providers.length > 0 && !get().activeProviderId) {
            await get().setActiveProvider(providers[0].id);
          }
        } catch (error) {
          set({ error: (error as Error).message, isLoading: false });
        }
      },

      setActiveProvider: async (id: string) => {
        await webviewManager.switchTo(id);
        set({ activeProviderId: id });
      },

      addProvider: async (provider) => {
        // TODO: 实现添加自定义 provider
      },

      removeProvider: async (id: string) => {
        // TODO: 实现删除 provider
      },
    }),
    {
      name: 'provider-store',
      partialize: (state) => ({ activeProviderId: state.activeProviderId }),
    }
  )
);
```

```typescript
// src/stores/useAppStore.ts
import { create } from 'zustand';

interface AppState {
  isSettingsOpen: boolean;
  isHistoryPanelOpen: boolean;
  theme: 'light' | 'dark' | 'system';

  // Actions
  openSettings: () => void;
  closeSettings: () => void;
  toggleHistoryPanel: () => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export const useAppStore = create<AppState>((set) => ({
  isSettingsOpen: false,
  isHistoryPanelOpen: false,
  theme: 'system',

  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),
  toggleHistoryPanel: () => set((state) => ({ isHistoryPanelOpen: !state.isHistoryPanelOpen })),
  setTheme: (theme) => {
    set({ theme });
    // 应用主题
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (theme === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      // system
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  },
}));
```

---

## 5. 备份管理器

```typescript
// src/services/backup-manager.ts
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, copyFile, readDir, remove } from '@tauri-apps/plugin-fs';
import { BaseDirectory } from '@tauri-apps/plugin-fs';

class BackupManager {
  private static readonly BACKUP_DIR = 'backups';
  private static readonly MAX_BACKUPS = 10;
  private static readonly DB_NAME = 'chatbox.db';

  private backupInterval: number | null = null;

  async startAutoBackup(intervalMs: number = 60 * 60 * 1000): Promise<void> {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
    }

    // 立即执行一次
    await this.createBackup();

    // 定时执行
    this.backupInterval = window.setInterval(async () => {
      await this.createBackup();
    }, intervalMs);

    console.log('[BackupManager] Auto backup started, interval:', intervalMs);
  }

  stopAutoBackup(): void {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
    }
    console.log('[BackupManager] Auto backup stopped');
  }

  async createBackup(): Promise<string | null> {
    try {
      const appDir = await appDataDir();
      const dbPath = await join(appDir, BackupManager.DB_NAME);
      const backupDir = await join(appDir, BackupManager.BACKUP_DIR);

      // 确保备份目录存在
      const backupDirExists = await exists(backupDir, { baseDir: BaseDirectory.AppLocalData });
      if (!backupDirExists) {
        await mkdir(backupDir, { recursive: true, baseDir: BaseDirectory.AppLocalData });
      }

      // 创建备份文件（带时间戳）
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `chatbox_${timestamp}.db`;
      const backupPath = await join(backupDir, backupFileName);

      await copyFile(dbPath, backupPath, {
        fromPathBaseDir: BaseDirectory.AppLocalData,
        toPathBaseDir: BaseDirectory.AppLocalData,
      });

      console.log('[BackupManager] Backup created:', backupFileName);

      // 清理旧备份
      await this.cleanOldBackups();

      return backupPath;
    } catch (error) {
      console.error('[BackupManager] Backup failed:', error);
      return null;
    }
  }

  private async cleanOldBackups(): Promise<void> {
    try {
      const appDir = await appDataDir();
      const backupDir = await join(appDir, BackupManager.BACKUP_DIR);

      const entries = await readDir(backupDir, { baseDir: BaseDirectory.AppLocalData });

      const backups = entries
        .filter((e) => e.name?.startsWith('chatbox_') && e.name?.endsWith('.db'))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      // 保留最新的 N 个
      if (backups.length > BackupManager.MAX_BACKUPS) {
        const toDelete = backups.slice(0, backups.length - BackupManager.MAX_BACKUPS);

        for (const backup of toDelete) {
          const path = await join(backupDir, backup.name!);
          await remove(path, { baseDir: BaseDirectory.AppLocalData });
          console.log('[BackupManager] Deleted old backup:', backup.name);
        }
      }
    } catch (error) {
      console.error('[BackupManager] Clean old backups failed:', error);
    }
  }

  async listBackups(): Promise<{ name: string; path: string }[]> {
    try {
      const appDir = await appDataDir();
      const backupDir = await join(appDir, BackupManager.BACKUP_DIR);

      const backupDirExists = await exists(backupDir, { baseDir: BaseDirectory.AppLocalData });
      if (!backupDirExists) {
        return [];
      }

      const entries = await readDir(backupDir, { baseDir: BaseDirectory.AppLocalData });

      const backups = entries
        .filter((e) => e.name?.startsWith('chatbox_') && e.name?.endsWith('.db'))
        .sort((a, b) => (b.name || '').localeCompare(a.name || '')); // 降序，最新在前

      return await Promise.all(
        backups.map(async (backup) => ({
          name: backup.name!,
          path: await join(backupDir, backup.name!),
        }))
      );
    } catch (error) {
      console.error('[BackupManager] List backups failed:', error);
      return [];
    }
  }

  async restoreBackup(backupPath: string): Promise<boolean> {
    try {
      const appDir = await appDataDir();
      const dbPath = await join(appDir, BackupManager.DB_NAME);

      // 先备份当前数据库
      await this.createBackup();

      // 恢复备份
      await copyFile(backupPath, dbPath, {
        fromPathBaseDir: BaseDirectory.AppLocalData,
        toPathBaseDir: BaseDirectory.AppLocalData,
      });

      console.log('[BackupManager] Backup restored from:', backupPath);
      return true;
    } catch (error) {
      console.error('[BackupManager] Restore backup failed:', error);
      return false;
    }
  }
}

export const backupManager = new BackupManager();
```

---

## 6. 导入导出服务

```typescript
// src/services/import-export.ts
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { db, ChatSession, ChatMessage } from './database';

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  error?: string;
}

export interface ExportData {
  version: string;
  exportedAt: string;
  sessions: (ChatSession & { messages: ChatMessage[] })[];
}

// ChatGPT 官方导出格式
interface ChatGPTExport {
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<
    string,
    {
      id: string;
      message?: {
        author: { role: string };
        content: { parts: string[] };
        create_time: number;
      };
    }
  >;
}

export async function importChatGPTExport(): Promise<ImportResult> {
  try {
    const filePath = await open({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false,
    });

    if (!filePath || typeof filePath !== 'string') {
      return { success: false, imported: 0, skipped: 0, error: 'No file selected' };
    }

    const content = await readTextFile(filePath);
    const data: ChatGPTExport[] = JSON.parse(content);

    let imported = 0;
    let skipped = 0;

    for (const conv of data) {
      // 创建会话
      const sessionId = await db.createSession('chatgpt', conv.title || 'Untitled');

      // 解析消息
      for (const [nodeId, node] of Object.entries(conv.mapping || {})) {
        const msg = node.message;
        if (msg && msg.content?.parts?.length > 0) {
          const content = msg.content.parts.join('\n').trim();
          if (!content) continue;

          const role = msg.author.role === 'user' ? 'user' : 'assistant';

          try {
            await db.addMessage(sessionId, role as any, content, 'manual_import');
            imported++;
          } catch {
            skipped++; // 重复消息
          }
        }
      }
    }

    return { success: true, imported, skipped };
  } catch (error) {
    return { success: false, imported: 0, skipped: 0, error: (error as Error).message };
  }
}

export async function exportAsJSON(): Promise<boolean> {
  try {
    const sessions = await db.getSessions();
    const exportData: ExportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      sessions: [],
    };

    for (const session of sessions) {
      const messages = await db.getMessages(session.id);
      exportData.sessions.push({ ...session, messages });
    }

    const filePath = await save({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      defaultPath: `chatbox_export_${Date.now()}.json`,
    });

    if (!filePath) return false;

    await writeTextFile(filePath, JSON.stringify(exportData, null, 2));
    return true;
  } catch (error) {
    console.error('Export failed:', error);
    return false;
  }
}

export async function exportAsMarkdown(sessionId: string): Promise<boolean> {
  try {
    const sessions = await db.getSessions();
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return false;

    const messages = await db.getMessages(sessionId);

    let markdown = `# ${session.title}\n\n`;
    markdown += `**Provider:** ${session.providerId}\n`;
    markdown += `**Date:** ${new Date(session.createdAt * 1000).toLocaleString()}\n\n`;
    markdown += `---\n\n`;

    for (const msg of messages) {
      const role = msg.role === 'user' ? '👤 User' : '🤖 Assistant';
      markdown += `### ${role}\n\n${msg.content}\n\n`;
    }

    const filePath = await save({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: `${session.title.replace(/\s+/g, '_')}.md`,
    });

    if (!filePath) return false;

    await writeTextFile(filePath, markdown);
    return true;
  } catch (error) {
    console.error('Export failed:', error);
    return false;
  }
}
```

---

## 7. 主应用入口

```typescript
// src/App.tsx
import { useEffect } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { useProviderStore } from '@/stores/useProviderStore'
import { useAppStore } from '@/stores/useAppStore'
import { db } from '@/services/database'
import { backupManager } from '@/services/backup-manager'

export default function App() {
  const { loadProviders } = useProviderStore()
  const { setTheme, theme } = useAppStore()

  useEffect(() => {
    async function init() {
      // 初始化数据库
      await db.initialize()

      // 加载 providers
      await loadProviders()

      // 启动自动备份
      await backupManager.startAutoBackup()

      // 应用主题
      setTheme(theme)
    }

    init()

    // 注册快捷键
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + 1/2 切换 provider
      if ((e.metaKey || e.ctrlKey) && ['1', '2'].includes(e.key)) {
        e.preventDefault()
        const providers = useProviderStore.getState().providers
        const index = parseInt(e.key) - 1
        if (providers[index]) {
          useProviderStore.getState().setActiveProvider(providers[index].id)
        }
      }

      // Cmd/Ctrl + , 打开设置
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        useAppStore.getState().openSettings()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      <AppLayout />
      <SettingsDialog />
    </>
  )
}
```

---

## 8. Tauri 配置

```json
// src-tauri/tauri.conf.json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Chat Box",
  "version": "0.1.0",
  "identifier": "com.chatbox.app",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "label": "main",
        "title": "Chat Box",
        "width": 1280,
        "height": 800,
        "minWidth": 1024,
        "minHeight": 768,
        "resizable": true,
        "fullscreen": false,
        "decorations": true,
        "transparent": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "plugins": {
    "sql": {
      "preload": ["sqlite:chatbox.db"]
    }
  }
}
```

```json
// src-tauri/capabilities/default.json
{
  "$schema": "https://schema.tauri.app/config/2/capability",
  "identifier": "default",
  "description": "Default capabilities for the app",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "sql:default",
    "sql:allow-load",
    "sql:allow-execute",
    "sql:allow-select",
    "fs:default",
    "fs:allow-read",
    "fs:allow-write",
    "fs:allow-exists",
    "fs:allow-mkdir",
    "fs:allow-remove",
    "fs:allow-copy-file",
    "fs:allow-read-dir",
    "dialog:default",
    "dialog:allow-open",
    "dialog:allow-save",
    "shell:allow-open"
  ]
}
```

---

以上代码示例涵盖了项目的核心功能模块。实施时可以根据实际情况进行调整。
