import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Sidebar } from './Sidebar';
import { WebViewContainer } from './WebViewContainer';
import { AddServiceDialog } from './AddServiceDialog';
import { SettingsPage } from './SettingsPage';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import {
  activateServiceContent,
  hideAllServiceContent,
  syncServiceHostState,
  syncDockedContentLayout,
  usesDockedWindowContentHost,
} from '@/services/content-host';
import { useAppStore } from '@/stores/app-store';

export function AppLayout() {
  const { activeServiceId, settingsPageOpen, addServiceDialogOpen, services } = useAppStore();
  const [useDockedWindowHost, setUseDockedWindowHost] = useState<boolean | null>(null);

  const isAnyDialogOpen = settingsPageOpen || addServiceDialogOpen;
  const hostServicesSignature = services
    .map(({ id, name, url, enabled }) => `${id}:${name}:${url}:${enabled}`)
    .join('|');
  const hostServices = useMemo(
    () =>
      services.map(({ id, name, url, enabled }) => ({
        id,
        name,
        url,
        enabled,
      })),
    [hostServicesSignature]
  );
  const activeService = hostServices.find((service) => service.id === activeServiceId);
  const visibleHostServiceId = isAnyDialogOpen ? null : activeService?.id ?? null;

  useKeyboardShortcuts();

  useEffect(() => {
    let cancelled = false;

    usesDockedWindowContentHost()
      .then((shouldUseDockedWindowHost) => {
        if (!cancelled) {
          setUseDockedWindowHost(shouldUseDockedWindowHost);
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setUseDockedWindowHost(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const syncActiveContent = useCallback(() => {
    if (isAnyDialogOpen) {
      hideAllServiceContent().catch(console.error);
      return;
    }

    if (activeService) {
      activateServiceContent(activeService, hostServices).catch(console.error);
      return;
    }

    hideAllServiceContent().catch(console.error);
  }, [activeService, hostServices, isAnyDialogOpen]);

  useEffect(() => {
    if (!useDockedWindowHost) {
      return;
    }

    syncServiceHostState(hostServices, visibleHostServiceId).catch(console.error);
  }, [hostServices, useDockedWindowHost, visibleHostServiceId]);

  useEffect(() => {
    if (useDockedWindowHost === null) {
      return;
    }

    syncActiveContent();
  }, [syncActiveContent, useDockedWindowHost]);

  useEffect(() => {
    if (!useDockedWindowHost) {
      return;
    }

    const currentWindow = getCurrentWindow();
    const relayout = () => {
      syncDockedContentLayout().catch(console.error);
    };
    const restoreActiveContent = (focused: boolean) => {
      if (!focused) {
        return;
      }

      relayout();
      syncActiveContent();
    };

    let unlistenFns: Array<() => void> = [];
    let disposed = false;

    Promise.all([
      currentWindow.onResized(relayout),
      currentWindow.onMoved(relayout),
      currentWindow.onScaleChanged(relayout),
      currentWindow.onFocusChanged(({ payload }) => restoreActiveContent(payload)),
    ])
      .then((fns) => {
        if (disposed) {
          fns.forEach((unlisten) => void unlisten());
          return;
        }

        unlistenFns = fns;
      })
      .catch(console.error);

    return () => {
      disposed = true;
      unlistenFns.forEach((unlisten) => void unlisten());
    };
  }, [syncActiveContent, useDockedWindowHost]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar />
      {settingsPageOpen ? <SettingsPage /> : <WebViewContainer />}
      <AddServiceDialog />
    </div>
  );
}
