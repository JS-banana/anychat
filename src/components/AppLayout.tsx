import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Sidebar } from './Sidebar';
import { WebViewContainer } from './WebViewContainer';
import { AddServiceDialog } from './AddServiceDialog';
import { SettingsPage } from './SettingsPage';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAppStore } from '@/stores/app-store';

export function AppLayout() {
  const { activeServiceId, settingsPageOpen, addServiceDialogOpen, services } = useAppStore();

  const isAnyDialogOpen = settingsPageOpen || addServiceDialogOpen;
  const activeService = services.find((service) => service.id === activeServiceId);

  useKeyboardShortcuts();

  useEffect(() => {
    if (isAnyDialogOpen) {
      invoke('hide_all_webviews').catch(console.error);
      return;
    }

    if (activeServiceId && activeService) {
      invoke('switch_webview', {
        label: activeServiceId,
        url: activeService.url,
      }).catch(console.error);
    }
  }, [isAnyDialogOpen, activeServiceId, activeService]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar />
      {settingsPageOpen ? <SettingsPage /> : <WebViewContainer />}
      <AddServiceDialog />
    </div>
  );
}
