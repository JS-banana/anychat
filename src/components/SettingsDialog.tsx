import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAppStore } from '@/stores/app-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Trash2, Eye, EyeOff, GripVertical, Upload, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { importChatGPTExport, exportAllData } from '@/services/import-export';
import { getStatistics } from '@/services/database';
import { ChatService } from '@/types';

interface SortableServiceItemProps {
  service: ChatService;
  onToggle: () => void;
  onRemove: () => void;
}

function SortableServiceItem({ service, onToggle, onRemove }: SortableServiceItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: service.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 transition-colors',
        service.enabled
          ? 'border-border bg-card'
          : 'border-border/50 bg-muted/30 opacity-60',
        isDragging && 'opacity-50 shadow-lg'
      )}
    >
      <GripVertical
        className="h-4 w-4 cursor-grab text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      />

      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
        {service.iconUrl ? (
          <img
            src={service.iconUrl}
            alt={service.name}
            className="h-5 w-5 object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <span className="text-xs font-medium">
            {service.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex-1">
        <p className="text-sm font-medium">{service.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {service.url}
        </p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onToggle}
      >
        {service.enabled ? (
          <Eye className="h-4 w-4" />
        ) : (
          <EyeOff className="h-4 w-4" />
        )}
      </Button>

      {service.id.startsWith('custom-') && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export function SettingsDialog() {
  const {
    settingsOpen,
    setSettingsOpen,
    services,
    toggleServiceEnabled,
    removeService,
    reorderServices,
  } = useAppStore();

  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<{ totalSessions: number; totalMessages: number } | null>(null);

  const sortedServices = [...services].sort((a, b) => a.order - b.order);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = sortedServices.findIndex((s) => s.id === active.id);
      const newIndex = sortedServices.findIndex((s) => s.id === over.id);
      reorderServices(oldIndex, newIndex);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await importChatGPTExport();
      if (result.success) {
        alert(`Imported ${result.sessionsImported} sessions and ${result.messagesImported} messages`);
        loadStats();
      } else if (result.errors.length > 0) {
        alert(`Import errors: ${result.errors.join('\n')}`);
      }
    } catch (err) {
      console.error('Import failed:', err);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await exportAllData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chatbox-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const loadStats = async () => {
    try {
      const data = await getStatistics();
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  return (
    <Dialog open={settingsOpen} onOpenChange={(open) => {
      setSettingsOpen(open);
      if (open) loadStats();
    }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage your chat services and application preferences.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h3 className="mb-3 text-sm font-medium">Chat Services</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Drag to reorder. Click eye to enable/disable.
            </p>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedServices.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {sortedServices.map((service) => (
                    <SortableServiceItem
                      key={service.id}
                      service={service}
                      onToggle={() => toggleServiceEnabled(service.id)}
                      onRemove={() => removeService(service.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          <div className="border-t pt-4">
            <h3 className="mb-3 text-sm font-medium">Data Management</h3>
            {stats && (
              <p className="mb-3 text-xs text-muted-foreground">
                {stats.totalSessions} sessions · {stats.totalMessages} messages
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Import ChatGPT
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Export All
              </Button>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="mb-3 text-sm font-medium">About</h3>
            <p className="text-sm text-muted-foreground">
              ChatBox v0.1.0 - A multi-AI chat aggregator app.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
