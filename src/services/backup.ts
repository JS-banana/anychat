import { writeTextFile, mkdir, readDir, remove } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { getDatabase } from './database';

const BACKUP_DIR = 'backups';
const MAX_BACKUPS = 24;
const BACKUP_INTERVAL_MS = 60 * 60 * 1000;

let backupIntervalId: ReturnType<typeof setInterval> | null = null;

export async function getBackupDir(): Promise<string> {
  const appDir = await appDataDir();
  return join(appDir, BACKUP_DIR);
}

export async function ensureBackupDir(): Promise<string> {
  const backupDir = await getBackupDir();
  try {
    await mkdir(backupDir, { recursive: true });
  } catch {
    // empty
  }
  return backupDir;
}

export async function exportAllData(): Promise<string> {
  const db = await getDatabase();

  const sessions = await db.select('SELECT * FROM chat_sessions ORDER BY updated_at DESC');
  const messages = await db.select('SELECT * FROM chat_messages ORDER BY created_at');
  const providers = await db.select('SELECT * FROM providers');

  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      providers,
      sessions,
      messages,
    },
    null,
    2
  );
}

export async function createBackup(): Promise<string> {
  const backupDir = await ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}.json`;
  const filepath = await join(backupDir, filename);

  const data = await exportAllData();
  await writeTextFile(filepath, data);

  await cleanupOldBackups();

  return filepath;
}

async function cleanupOldBackups(): Promise<void> {
  const backupDir = await getBackupDir();

  try {
    const entries = await readDir(backupDir);
    const backupFiles = entries
      .filter((e) => e.name?.startsWith('backup-') && e.name?.endsWith('.json'))
      .map((e) => e.name!)
      .sort()
      .reverse();

    if (backupFiles.length > MAX_BACKUPS) {
      const toDelete = backupFiles.slice(MAX_BACKUPS);
      for (const filename of toDelete) {
        const filepath = await join(backupDir, filename);
        await remove(filepath);
        console.log('[Backup] Removed old backup:', filename);
      }
    }
  } catch (err) {
    console.error('[Backup] Cleanup failed:', err);
  }
}

export async function listBackups(): Promise<{ name: string; path: string }[]> {
  const backupDir = await getBackupDir();

  try {
    const entries = await readDir(backupDir);
    const backups = entries
      .filter((e) => e.name?.startsWith('backup-') && e.name?.endsWith('.json'))
      .map((e) => ({ name: e.name!, path: '' }))
      .sort((a, b) => b.name.localeCompare(a.name));

    for (const backup of backups) {
      backup.path = await join(backupDir, backup.name);
    }

    return backups;
  } catch {
    return [];
  }
}

export function startAutoBackup(): void {
  if (backupIntervalId) {
    return;
  }

  setTimeout(async () => {
    try {
      const filepath = await createBackup();
      console.log('[Backup] Initial backup created:', filepath);
    } catch (err) {
      console.error('[Backup] Initial backup failed:', err);
    }
  }, 5000);

  backupIntervalId = setInterval(async () => {
    try {
      const filepath = await createBackup();
      console.log('[Backup] Auto backup created:', filepath);
    } catch (err) {
      console.error('[Backup] Auto backup failed:', err);
    }
  }, BACKUP_INTERVAL_MS);

  console.log('[Backup] Auto backup started (every hour)');
}

export function stopAutoBackup(): void {
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
    console.log('[Backup] Auto backup stopped');
  }
}
