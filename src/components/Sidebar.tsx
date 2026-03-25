import { Settings, MessageSquare } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '@/stores/app-store';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useCachedIcon } from '@/hooks/useCachedIcon';

interface ServiceIconProps {
  serviceId: string;
  serviceUrl: string;
  iconUrl?: string;
  serviceName: string;
  onResolvedIcon?: (resolvedIconUrl: string) => void;
}

function ServiceIcon({
  serviceId,
  serviceUrl,
  iconUrl,
  serviceName,
  onResolvedIcon,
}: ServiceIconProps) {
  const { iconSrc: currentIcon, onError, onLoad } = useCachedIcon(serviceId, serviceUrl, iconUrl, {
    onResolvedCandidate: onResolvedIcon,
  });

  if (!currentIcon) {
    return <MessageSquare className="h-5 w-5 text-muted-foreground" />;
  }

  return (
    <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg">
      <img
        src={currentIcon}
        alt={serviceName}
        className="h-6 w-6 object-contain"
        onLoad={onLoad}
        onError={onError}
      />
    </div>
  );
}

export function Sidebar() {
  const { services, activeServiceId, setActiveService, setSettingsPageOpen, updateService } =
    useAppStore();

  const enabledServices = services.filter((s) => s.enabled).sort((a, b) => a.order - b.order);

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex h-full w-16 flex-col items-center border-r border-sidebar-border bg-sidebar py-3"
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="flex flex-1 flex-col items-center gap-2">
          {enabledServices.map((service) => {
            const isActive = activeServiceId === service.id;

            return (
              <Tooltip key={service.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={async () => {
                      setActiveService(service.id);
                      setSettingsPageOpen(false);
                      await invoke('switch_webview', { label: service.id, url: service.url });
                    }}
                    className={cn(
                      'relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200 hover:scale-105 active:scale-95',
                      isActive ? 'bg-black/[0.06] ring-1 ring-black/10' : 'hover:bg-black/[0.04]'
                    )}
                    aria-pressed={isActive}
                    aria-label={service.name}
                  >
                    <ServiceIcon
                      serviceId={service.id}
                      serviceUrl={service.url}
                      iconUrl={service.iconUrl}
                      serviceName={service.name}
                      onResolvedIcon={(resolvedIconUrl) => {
                        if (resolvedIconUrl === service.iconUrl) return;
                        updateService(service.id, { iconUrl: resolvedIconUrl });
                      }}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{service.name}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-2 pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-xl text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={() => setSettingsPageOpen(true)}
              >
                <Settings className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>设置</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
