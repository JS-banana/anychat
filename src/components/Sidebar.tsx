import { useState } from 'react';
import { Settings, MessageSquare } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '@/stores/app-store';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getServiceIconCandidates } from '@/lib/icon';

interface ServiceIconProps {
  serviceId: string;
  serviceUrl: string;
  iconUrl?: string;
  serviceName: string;
}

function ServiceIcon({ serviceUrl, iconUrl, serviceName }: ServiceIconProps) {
  const candidates = getServiceIconCandidates(serviceUrl, iconUrl);
  const [errorIndex, setErrorIndex] = useState(0);

  const currentIcon = candidates[errorIndex];

  if (!currentIcon) {
    return <MessageSquare className="h-5 w-5 text-muted-foreground" />;
  }

  return (
    <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg">
      <img
        src={currentIcon}
        alt={serviceName}
        className="h-6 w-6 object-contain"
        onError={() => setErrorIndex((prev) => prev + 1)}
      />
    </div>
  );
}

export function Sidebar() {
  const { services, activeServiceId, setActiveService, setSettingsPageOpen } = useAppStore();

  const enabledServices = services.filter((s) => s.enabled).sort((a, b) => a.order - b.order);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-16 flex-col items-center border-r border-sidebar-border bg-sidebar py-3">
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
