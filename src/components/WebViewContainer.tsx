import { Globe, RefreshCw, ExternalLink } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useAppStore } from '@/stores/app-store';
import { Button } from '@/components/ui/button';
import { refreshServiceContent } from '@/services/content-host';

export function WebViewContainer() {
  const { services, activeServiceId } = useAppStore();

  const activeService = services.find((s) => s.id === activeServiceId);

  const handleRefresh = async () => {
    if (activeService) {
      await refreshServiceContent(activeService, services);
    }
  };

  const handleOpenExternal = async () => {
    if (activeService) {
      await openUrl(activeService.url);
    }
  };

  return (
    <div className="relative flex-1 overflow-hidden bg-background">
      {!activeService ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
          <Globe className="h-16 w-16 opacity-50" />
          <p className="text-lg">Select a chat service to get started</p>
        </div>
      ) : (
        <div className="absolute right-4 top-4 z-10 flex gap-2">
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-lg bg-background/80 backdrop-blur-sm"
            onClick={handleRefresh}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-lg bg-background/80 backdrop-blur-sm"
            onClick={handleOpenExternal}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
