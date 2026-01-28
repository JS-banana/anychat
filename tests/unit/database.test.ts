import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const select = vi.fn();

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn(() => Promise.resolve({ execute, select })),
  },
}));

describe('database migrations', () => {
  beforeEach(() => {
    vi.resetModules();
    execute.mockReset();
    select.mockReset();
  });

  it('adds missing columns before creating external_id index', async () => {
    select.mockResolvedValueOnce([
      { name: 'id' },
      { name: 'session_id' },
      { name: 'role' },
      { name: 'content' },
      { name: 'content_hash' },
      { name: 'source' },
      { name: 'created_at' },
    ]);

    const { initDatabase } = await import('@/services/database');
    await initDatabase();

    const sqlCalls = execute.mock.calls.map((call) => call[0]);
    const addExternal = sqlCalls.indexOf(
      'ALTER TABLE chat_messages ADD COLUMN external_id TEXT'
    );
    const addMeta = sqlCalls.indexOf('ALTER TABLE chat_messages ADD COLUMN meta TEXT');
    const createIndex = sqlCalls.indexOf(
      'CREATE INDEX IF NOT EXISTS idx_messages_external ON chat_messages(external_id)'
    );

    expect(addExternal).toBeGreaterThan(-1);
    expect(addMeta).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(addExternal);
  });
});
