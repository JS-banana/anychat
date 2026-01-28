import Database from '@tauri-apps/plugin-sql';

let db: Database | null = null;
let dbInitPromise: Promise<Database> | null = null;

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT,
  enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  selector_config TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  title TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  content_hash TEXT,
  source TEXT DEFAULT 'auto',
  external_id TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_provider ON chat_sessions(provider_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_hash ON chat_messages(content_hash);
`;

async function ensureChatMessageSchema(database: Database): Promise<void> {
  const columns = await database.select<{ name: string }[]>(
    "PRAGMA table_info('chat_messages')"
  );
  const columnNames = new Set(columns.map((col) => col.name));

  let hasExternalId = columnNames.has('external_id');
  if (!hasExternalId) {
    await database.execute('ALTER TABLE chat_messages ADD COLUMN external_id TEXT');
    hasExternalId = true;
  }

  if (!columnNames.has('meta')) {
    await database.execute('ALTER TABLE chat_messages ADD COLUMN meta TEXT');
  }

  if (hasExternalId) {
    await database.execute(
      'CREATE INDEX IF NOT EXISTS idx_messages_external ON chat_messages(external_id)'
    );
  }
}

const DEFAULT_PROVIDERS_SQL = `
INSERT OR IGNORE INTO providers (id, name, url, sort_order, selector_config) VALUES
('chatgpt', 'ChatGPT', 'https://chatgpt.com', 1, '{"containerSelector":"main","messageSelector":"[data-message-id]","userSelector":"[data-message-author-role=\\"user\\"]","assistantSelector":"[data-message-author-role=\\"assistant\\"]","contentSelector":".markdown"}'),
('gemini', 'Gemini', 'https://gemini.google.com/app', 2, '{"containerSelector":"main","messageSelector":"message-content","userSelector":".user-message","assistantSelector":".model-response","contentSelector":".message-text"}');
`;

export interface Provider {
  id: string;
  name: string;
  url: string;
  icon: string | null;
  enabled: number;
  sort_order: number;
  selector_config: string | null;
  created_at: number;
}

export interface ChatSession {
  id: string;
  provider_id: string;
  title: string;
  message_count: number;
  created_at: number;
  updated_at: number;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  content_hash: string | null;
  source: string;
  external_id: string | null;
  meta: string | null;
  created_at: number;
}

export async function initDatabase(): Promise<Database> {
  if (db) return db;

  // React StrictMode(dev) may run effects twice, so guard concurrent initialization.
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    const loaded = await Database.load('sqlite:chatbox.db');

    await loaded.execute(INIT_SQL);
    await loaded.execute(DEFAULT_PROVIDERS_SQL);
    await ensureChatMessageSchema(loaded);

    db = loaded;
    return loaded;
  })();

  try {
    return await dbInitPromise;
  } finally {
    // Keep db cached; allow retry on failure.
    if (!db) dbInitPromise = null;
  }
}

export async function getDatabase(): Promise<Database> {
  if (!db) {
    return initDatabase();
  }
  return db;
}

export async function getProviders(): Promise<Provider[]> {
  const database = await getDatabase();
  return database.select<Provider[]>('SELECT * FROM providers ORDER BY sort_order');
}

export async function getSessions(providerId?: string): Promise<ChatSession[]> {
  const database = await getDatabase();
  if (providerId) {
    return database.select<ChatSession[]>(
      'SELECT * FROM chat_sessions WHERE provider_id = ? ORDER BY updated_at DESC',
      [providerId]
    );
  }
  return database.select<ChatSession[]>('SELECT * FROM chat_sessions ORDER BY updated_at DESC');
}

export async function getMessages(sessionId: string): Promise<ChatMessage[]> {
  const database = await getDatabase();
  return database.select<ChatMessage[]>(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC',
    [sessionId]
  );
}

export async function createSession(providerId: string, title: string): Promise<string> {
  const database = await getDatabase();
  const id = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  await database.execute('INSERT INTO chat_sessions (id, provider_id, title) VALUES (?, ?, ?)', [
    id,
    providerId,
    title,
  ]);

  return id;
}

export async function createMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  source: string = 'auto'
): Promise<string> {
  const database = await getDatabase();
  const id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const contentHash = await hashContent(content);

  const existing = await database.select<{ id: string }[]>(
    'SELECT id FROM chat_messages WHERE session_id = ? AND content_hash = ?',
    [sessionId, contentHash]
  );

  if (existing.length > 0) {
    return existing[0].id;
  }

  await database.execute(
    'INSERT INTO chat_messages (id, session_id, role, content, content_hash, source) VALUES (?, ?, ?, ?, ?, ?)',
    [id, sessionId, role, content, contentHash, source]
  );

  await database.execute(
    'UPDATE chat_sessions SET message_count = message_count + 1, updated_at = strftime("%s", "now") WHERE id = ?',
    [sessionId]
  );

  return id;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const database = await getDatabase();
  await database.execute('DELETE FROM chat_sessions WHERE id = ?', [sessionId]);
}

export async function searchMessages(query: string): Promise<ChatMessage[]> {
  const database = await getDatabase();
  return database.select<ChatMessage[]>(
    'SELECT * FROM chat_messages WHERE content LIKE ? ORDER BY created_at DESC LIMIT 100',
    [`%${query}%`]
  );
}

export async function getStatistics(): Promise<{
  totalSessions: number;
  totalMessages: number;
  byProvider: { provider_id: string; count: number }[];
}> {
  const database = await getDatabase();

  const [sessions] = await database.select<{ count: number }[]>(
    'SELECT COUNT(*) as count FROM chat_sessions'
  );
  const [messages] = await database.select<{ count: number }[]>(
    'SELECT COUNT(*) as count FROM chat_messages'
  );
  const byProvider = await database.select<{ provider_id: string; count: number }[]>(
    'SELECT provider_id, COUNT(*) as count FROM chat_sessions GROUP BY provider_id'
  );

  return {
    totalSessions: sessions?.count ?? 0,
    totalMessages: messages?.count ?? 0,
    byProvider,
  };
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
