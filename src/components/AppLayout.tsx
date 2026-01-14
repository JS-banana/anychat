import { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Sidebar } from './Sidebar';
import { WebViewContainer } from './WebViewContainer';
import { AddServiceDialog } from './AddServiceDialog';
import { SettingsDialog } from './SettingsDialog';
import { ChatHistoryPanel } from './ChatHistoryPanel';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAppStore } from '@/stores/app-store';
import { initDatabase, createSession, createMessage } from '@/services/database';

interface CapturedMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  index: number;
  timestamp: number;
}

interface ChatCaptureEvent {
  service_id: string;
  messages: CapturedMessage[];
}

export function AppLayout() {
  const [dbReady, setDbReady] = useState(false);
  const { 
    chatHistoryOpen, 
    setChatHistoryOpen,
    activeServiceId,
    settingsOpen,
    addServiceDialogOpen,
    services,
  } = useAppStore();
  
  const isAnyDialogOpen = settingsOpen || addServiceDialogOpen || chatHistoryOpen;
  const activeService = services.find(s => s.id === activeServiceId);
  const sessionCacheRef = useRef<Record<string, string>>({});
  
  useKeyboardShortcuts();

  useEffect(() => {
    initDatabase()
      .then(() => setDbReady(true))
      .catch(console.error);
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    
    const setupListener = async () => {
      unlisten = await listen<ChatCaptureEvent>('chat-captured', async (event) => {
        const { service_id, messages } = event.payload;
        console.log('[ChatBox] Received captured messages:', service_id, messages.length);
        
        try {
          let sessionId = sessionCacheRef.current[service_id];
          if (!sessionId) {
            const title = `${service_id} - ${new Date().toLocaleDateString()}`;
            sessionId = await createSession(service_id, title);
            sessionCacheRef.current[service_id] = sessionId;
          }
          
          for (const msg of messages) {
            await createMessage(sessionId, msg.role, msg.content, 'auto_capture');
          }
          console.log('[ChatBox] Saved messages to database');
        } catch (err) {
          console.error('[ChatBox] Failed to save messages:', err);
        }
      });
    };
    
    if (dbReady) {
      setupListener();
    }
    
    return () => {
      if (unlisten) unlisten();
    };
  }, [dbReady]);

  useEffect(() => {
    if (activeServiceId && activeService) {
      invoke('switch_webview', { label: activeServiceId, url: activeService.url }).catch(console.error);
    }
  }, []);

  useEffect(() => {
    if (isAnyDialogOpen) {
      invoke('hide_all_webviews').catch(console.error);
    } else if (activeServiceId && activeService) {
      invoke('switch_webview', { label: activeServiceId, url: activeService.url }).catch(console.error);
    }
  }, [isAnyDialogOpen, activeServiceId, activeService?.url]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background dark">
      <Sidebar />
      <WebViewContainer />
      <AddServiceDialog />
      <SettingsDialog />
      <ChatHistoryPanel open={chatHistoryOpen} onOpenChange={setChatHistoryOpen} />
      {!dbReady && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <div className="text-muted-foreground">Initializing...</div>
        </div>
      )}
    </div>
  );
}
