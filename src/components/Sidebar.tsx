import { useState } from 'react';
import { motion } from 'framer-motion';
import { Settings, Plus, MessageSquare, History } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '@/stores/app-store';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const {
    services,
    activeServiceId,
    setActiveService,
    setSettingsOpen,
    setAddServiceDialogOpen,
    setChatHistoryOpen,
  } = useAppStore();
  
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  const enabledServices = services
    .filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order);

  const handleImageError = (serviceId: string) => {
    setImgErrors((prev) => ({ ...prev, [serviceId]: true }));
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-16 flex-col items-center border-r border-sidebar-border bg-sidebar py-3">
        <div className="flex flex-1 flex-col items-center gap-2">
          {enabledServices.map((service) => (
            <Tooltip key={service.id}>
              <TooltipTrigger asChild>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={async () => {
                    setActiveService(service.id);
                    await invoke('switch_webview', { label: service.id, url: service.url });
                  }}
                  className={cn(
                    'relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200',
                    activeServiceId === service.id
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-md'
                      : 'bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/80'
                  )}
                >
                  {activeServiceId === service.id && (
                    <motion.div
                      layoutId="activeIndicator"
                      className="absolute -left-3 h-8 w-1 rounded-r-full bg-sidebar-primary"
                      initial={false}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                  {service.iconUrl && !imgErrors[service.id] ? (
                    <img
                      src={service.iconUrl}
                      alt={service.name}
                      className="h-6 w-6 object-contain"
                      onError={() => handleImageError(service.id)}
                    />
                  ) : (
                    <MessageSquare className="h-5 w-5" />
                  )}
                </motion.button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>{service.name}</p>
              </TooltipContent>
            </Tooltip>
          ))}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="mt-2 h-11 w-11 rounded-xl border-2 border-dashed border-sidebar-border text-sidebar-foreground/50 hover:border-sidebar-foreground/30 hover:text-sidebar-foreground"
                onClick={() => setAddServiceDialogOpen(true)}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Add Chat Service</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex flex-col items-center gap-2 pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-xl text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={() => setChatHistoryOpen(true)}
              >
                <History className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Chat History</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-xl text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Settings</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
