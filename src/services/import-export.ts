import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { getDatabase, createSession, createMessage } from './database';

export interface ImportResult {
  success: boolean;
  sessionsImported: number;
  messagesImported: number;
  errors: string[];
}

interface ChatGPTExportMessage {
  id: string;
  author: {
    role: 'user' | 'assistant' | 'system';
  };
  content: {
    parts: string[];
  };
  create_time?: number;
}

interface ChatGPTExportConversation {
  id: string;
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<
    string,
    {
      message?: ChatGPTExportMessage;
      children: string[];
    }
  >;
}

interface GeminiThread {
  title: string;
  messages: GeminiMessage[];
}

interface GeminiMessage {
  message_id?: string;
  author: 'user' | 'model';
  content: string;
  created_at?: string;
}

export async function importChatGPTExport(): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    sessionsImported: 0,
    messagesImported: 0,
    errors: [],
  };

  try {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'JSON',
          extensions: ['json'],
        },
      ],
    });

    if (!selected) {
      result.errors.push('No file selected');
      return result;
    }

    const content = await readTextFile(selected as string);
    const data = JSON.parse(content) as ChatGPTExportConversation[];

    if (!Array.isArray(data)) {
      result.errors.push('Invalid ChatGPT export format');
      return result;
    }

    for (const conversation of data) {
      try {
        const sessionId = await createSession('chatgpt', conversation.title);
        result.sessionsImported++;

        const messages = extractMessagesFromMapping(conversation.mapping);

        for (const msg of messages) {
          if (msg.content && msg.content.trim()) {
            await createMessage(sessionId, msg.role, msg.content, 'manual_import');
            result.messagesImported++;
          }
        }
      } catch (err) {
        result.errors.push(`Failed to import conversation "${conversation.title}": ${err}`);
      }
    }

    result.success = true;
  } catch (err) {
    result.errors.push(`Import failed: ${err}`);
  }

  return result;
}

export async function importGeminiExport(): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    sessionsImported: 0,
    messagesImported: 0,
    errors: [],
  };

  try {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'JSON',
          extensions: ['json'],
        },
      ],
    });

    if (!selected) {
      result.errors.push('No file selected');
      return result;
    }

    const content = await readTextFile(selected as string);
    const data = JSON.parse(content) as GeminiThread[];

    if (!Array.isArray(data)) {
      result.errors.push('Invalid Gemini export format');
      return result;
    }

    for (const thread of data) {
      try {
        const title = thread.title || 'Untitled Conversation';
        const sessionId = await createSession('gemini', title);
        result.sessionsImported++;

        const sortedMessages = [...thread.messages].sort((a, b) => {
          const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return timeA - timeB;
        });

        for (const msg of sortedMessages) {
          if (msg.content && msg.content.trim()) {
            const role = msg.author === 'model' ? 'assistant' : 'user';
            await createMessage(sessionId, role, msg.content, 'manual_import');
            result.messagesImported++;
          }
        }
      } catch (err) {
        result.errors.push(`Failed to import thread "${thread.title}": ${err}`);
      }
    }

    result.success = true;
  } catch (err) {
    result.errors.push(`Import failed: ${err}`);
  }

  return result;
}

function extractMessagesFromMapping(
  mapping: ChatGPTExportConversation['mapping']
): { role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }[] {
  const messages: { role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }[] =
    [];
  const visited = new Set<string>();

  function traverse(nodeId: string) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = mapping[nodeId];
    if (!node) return;

    if (node.message && node.message.content?.parts) {
      const content = node.message.content.parts.join('\n');
      if (content.trim()) {
        messages.push({
          role: node.message.author.role,
          content,
          timestamp: node.message.create_time || Date.now() / 1000,
        });
      }
    }

    for (const childId of node.children) {
      traverse(childId);
    }
  }

  const rootNodes = Object.keys(mapping).filter((id) => {
    const node = mapping[id];
    return !node.message || node.message.author.role === 'system';
  });

  for (const rootId of rootNodes) {
    traverse(rootId);
  }

  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

export async function importGenericJSON(): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    sessionsImported: 0,
    messagesImported: 0,
    errors: [],
  };

  try {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'JSON',
          extensions: ['json'],
        },
      ],
    });

    if (!selected) {
      result.errors.push('No file selected');
      return result;
    }

    const content = await readTextFile(selected as string);
    const data = JSON.parse(content);

    if (data.session && data.messages) {
      const sessionId = await createSession(
        data.session.provider_id || 'custom',
        data.session.title || 'Imported Session'
      );
      result.sessionsImported++;

      for (const msg of data.messages) {
        if (msg.content && msg.role) {
          await createMessage(sessionId, msg.role, msg.content, 'manual_import');
          result.messagesImported++;
        }
      }

      result.success = true;
    } else {
      result.errors.push('Unrecognized JSON format');
    }
  } catch (err) {
    result.errors.push(`Import failed: ${err}`);
  }

  return result;
}

export async function exportAllData(): Promise<string> {
  const db = await getDatabase();

  const sessions = await db.select('SELECT * FROM chat_sessions ORDER BY updated_at DESC');
  const messages = await db.select('SELECT * FROM chat_messages ORDER BY created_at');
  const providers = await db.select('SELECT * FROM providers');

  const exportData = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    providers,
    sessions,
    messages,
  };

  return JSON.stringify(exportData, null, 2);
}
