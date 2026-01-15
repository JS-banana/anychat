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
import {
  Trash2,
  Eye,
  EyeOff,
  GripVertical,
  Upload,
  Download,
  Loader2,
  Plus,
  Save,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { importChatGPTExport, importGeminiExport, exportAllData } from '@/services/import-export';
import { getStatistics } from '@/services/database';
import { createBackup, listBackups } from '@/services/backup';
import { ChatService } from '@/types';
import { getServiceIconCandidates } from '@/lib/icon';
import { Input } from '@/components/ui/input';

interface SortableServiceItemProps {
  service: ChatService;
  onToggle: () => void;
  onRemove: () => void;
}

function SortableServiceItem({ service, onToggle, onRemove }: SortableServiceItemProps) {
  const candidates = getServiceIconCandidates(service.url, service.iconUrl);
  const [errorIndex, setErrorIndex] = useState(0);
  const iconUrl = candidates[errorIndex];

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: service.id,
  });

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
        service.enabled ? 'border-border bg-card' : 'border-border/50 bg-muted/30 opacity-60',
        isDragging && 'opacity-50 shadow-lg'
      )}
    >
      <GripVertical
        className="h-4 w-4 cursor-grab text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      />

      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
        {!iconUrl ? (
          <span className="text-xs font-medium">{service.name.charAt(0).toUpperCase()}</span>
        ) : (
          <img
            src={iconUrl}
            alt={service.name}
            className="h-5 w-5 object-contain"
            onError={() => setErrorIndex((prev) => prev + 1)}
          />
        )}
      </div>

      <div className="flex-1">
        <p className="text-sm font-medium">{service.name}</p>
        <p className="truncate text-xs text-muted-foreground">{service.url}</p>
      </div>

      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggle}>
        {service.enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
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
    settingsPageOpen: settingsOpen,
    setSettingsPageOpen: setSettingsOpen,
    services,
    toggleServiceEnabled,
    removeService,
    reorderServices,
    addService,
  } = useAppStore();

  const [importing, setImporting] = useState(false);
  const [importingGemini, setImportingGemini] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupCount, setBackupCount] = useState(0);
  const [stats, setStats] = useState<{ totalSessions: number; totalMessages: number } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceUrl, setNewServiceUrl] = useState('');

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
        alert(
          `Imported ${result.sessionsImported} sessions and ${result.messagesImported} messages`
        );
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

  const handleImportGemini = async () => {
    setImportingGemini(true);
    try {
      const result = await importGeminiExport();
      if (result.success) {
        alert(
          `Imported ${result.sessionsImported} sessions and ${result.messagesImported} messages`
        );
        loadStats();
      } else if (result.errors.length > 0) {
        alert(`Import errors: ${result.errors.join('\n')}`);
      }
    } catch (err) {
      console.error('Gemini import failed:', err);
    } finally {
      setImportingGemini(false);
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
      const backups = await listBackups();
      setBackupCount(backups.length);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      await createBackup();
      const backups = await listBackups();
      setBackupCount(backups.length);
      alert('Backup created successfully!');
    } catch (err) {
      console.error('Backup failed:', err);
      alert('Backup failed');
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <Dialog
      open={settingsOpen}
      onOpenChange={(open) => {
        setSettingsOpen(open);
        if (open) loadStats();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
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
                <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
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

            {showAddForm ? (
              <div className="mt-3 space-y-2 rounded-lg border border-dashed p-3">
                <Input
                  placeholder="Service name"
                  value={newServiceName}
                  onChange={(e) => setNewServiceName(e.target.value)}
                  autoFocus
                />
                <Input
                  placeholder="https://example.com"
                  value={newServiceUrl}
                  onChange={(e) => setNewServiceUrl(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      if (newServiceName.trim() && newServiceUrl.trim()) {
                        let url = newServiceUrl.trim();
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                          url = `https://${url}`;
                        }
                        addService({
                          name: newServiceName.trim(),
                          url,
                          enabled: true,
                        });
                        setNewServiceName('');
                        setNewServiceUrl('');
                        setShowAddForm(false);
                      }
                    }}
                    disabled={!newServiceName.trim() || !newServiceUrl.trim()}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowAddForm(false);
                      setNewServiceName('');
                      setNewServiceUrl('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 w-full justify-start text-muted-foreground"
                onClick={() => setShowAddForm(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add custom service
              </Button>
            )}
          </div>

          <div className="border-t pt-4">
            <h3 className="mb-3 text-sm font-medium">Data Management</h3>
            {stats && (
              <p className="mb-3 text-xs text-muted-foreground">
                {stats.totalSessions} sessions · {stats.totalMessages} messages · {backupCount}{' '}
                backups
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleBackup} disabled={backingUp}>
                {backingUp ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Backup Now
              </Button>
              <Button variant="outline" size="sm" onClick={handleImport} disabled={importing}>
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
                onClick={handleImportGemini}
                disabled={importingGemini}
              >
                {importingGemini ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Import Gemini
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
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
              AnyChat v0.1.0 - A multi-AI chat aggregator app.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
