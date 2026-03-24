import { useEffect, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Bot,
  Brain,
  CircleDot,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  GripVertical,
  Info,
  Loader2,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/stores/app-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { findWorkingIconCandidate, normalizeServiceUrl } from '@/lib/icon';
import { useCachedIcon } from '@/hooks/useCachedIcon';
import type { ChatService } from '@/types';

const ANYCHAT_REPO_URL = 'https://github.com/JS-banana/anychat';
const AMBERKEEPER_REPO_URL = 'https://github.com/JS-banana/AmberKeeper';

const PRESET_ICONS = [
  { id: 'message', Icon: MessageSquare, label: '聊天' },
  { id: 'bot', Icon: Bot, label: '机器人' },
  { id: 'brain', Icon: Brain, label: '大脑' },
  { id: 'sparkles', Icon: Sparkles, label: '闪光' },
  { id: 'zap', Icon: Zap, label: '闪电' },
  { id: 'globe', Icon: Globe, label: '地球' },
  { id: 'circle', Icon: CircleDot, label: '圆点' },
] as const;

interface SortableServiceItemProps {
  service: ChatService;
  onToggle: () => void;
  onRemove: () => void;
}

function SortableServiceItem({ service, onToggle, onRemove }: SortableServiceItemProps) {
  const updateService = useAppStore((state) => state.updateService);
  const {
    iconSrc: iconUrl,
    onError,
    onLoad,
  } = useCachedIcon(service.id, service.url, service.iconUrl, {
    onResolvedCandidate: (resolvedIconUrl) => {
      if (!service.id.startsWith('custom-')) return;
      if (resolvedIconUrl === service.iconUrl) return;
      updateService(service.id, { iconUrl: resolvedIconUrl });
    },
  });

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: service.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
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
            onLoad={onLoad}
            onError={onError}
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

function AboutCard({
  title,
  description,
  buttonLabel,
  href,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  href: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 text-card-foreground">
      <div className="space-y-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <Button
        variant="outline"
        className="mt-4 w-full justify-between"
        onClick={() => openUrl(href).catch(console.error)}
      >
        {buttonLabel}
        <ExternalLink className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function SettingsPage() {
  const {
    settingsPageOpen,
    settingsActiveTab,
    setSettingsActiveTab,
    services,
    toggleServiceEnabled,
    removeService,
    reorderServices,
    addService,
  } = useAppStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceUrl, setNewServiceUrl] = useState('');
  const [fetchedLogoUrl, setFetchedLogoUrl] = useState<string | null>(null);
  const [selectedPresetIcon, setSelectedPresetIcon] = useState<string | null>(null);
  const [logoLoading, setLogoLoading] = useState(false);

  const sortedServices = [...services].sort((a, b) => a.order - b.order);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!newServiceUrl) {
        setFetchedLogoUrl(null);
        return;
      }

      const normalized = normalizeServiceUrl(newServiceUrl);
      if (!normalized) {
        setFetchedLogoUrl(null);
        return;
      }

      setLogoLoading(true);
      void findWorkingIconCandidate(normalized)
        .then((detectedLogoUrl) => {
          setFetchedLogoUrl(detectedLogoUrl);
        })
        .finally(() => {
          setLogoLoading(false);
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [newServiceUrl]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedServices.findIndex((service) => service.id === active.id);
    const newIndex = sortedServices.findIndex((service) => service.id === over.id);
    reorderServices(oldIndex, newIndex);
  };

  const handleAddService = () => {
    if (!newServiceName.trim() || !newServiceUrl.trim()) return;

    const normalizedUrl = normalizeServiceUrl(newServiceUrl);
    if (!normalizedUrl) return;

    addService({
      name: newServiceName.trim(),
      url: normalizedUrl,
      enabled: true,
      iconUrl: fetchedLogoUrl || undefined,
    });

    setNewServiceName('');
    setNewServiceUrl('');
    setFetchedLogoUrl(null);
    setSelectedPresetIcon(null);
    setShowAddDialog(false);
  };

  if (!settingsPageOpen) {
    return null;
  }

  return (
    <div className="flex h-full w-full bg-background text-foreground animate-in fade-in duration-200">
      <div className="flex w-64 flex-none flex-col border-r bg-muted/30 pt-4">
        <nav className="flex-1 space-y-1 p-2">
          <button
            onClick={() => setSettingsActiveTab('services')}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              settingsActiveTab === 'services'
                ? 'border-l-2 border-primary bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Settings className="h-4 w-4" />
            服务管理
          </button>

          <button
            onClick={() => setSettingsActiveTab('about')}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              settingsActiveTab === 'about'
                ? 'border-l-2 border-primary bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Info className="h-4 w-4" />
            关于
          </button>
        </nav>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden bg-background">
        {settingsActiveTab === 'services' && (
          <div className="flex-1 overflow-y-auto p-8 max-w-3xl [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">服务管理</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  拖拽排序服务。点击眼睛图标切换显示或隐藏。
                </p>
              </div>
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                添加服务
              </Button>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedServices.map((service) => service.id)}
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
        )}

        {settingsActiveTab === 'about' && (
          <div className="flex-1 overflow-y-auto p-8 max-w-3xl">
            <div className="space-y-6">
              <motion.section
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-3xl border bg-card p-7 text-card-foreground"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                    <Settings className="h-7 w-7 text-primary" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold">关于 AnyChat</h1>
                    <p className="mt-1 text-sm text-muted-foreground">版本 0.1.0</p>
                  </div>
                </div>

                <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground">
                  AnyChat 现在专注于多 AI 服务聚合体验本身，提供统一入口、轻量切换和低占用的 Tauri
                  桌面端使用方式。
                </p>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
                  如果你更关注数据管理和存储，可以使用 AmberKeeper。它是从原 Electron
                  主线拆分出的独立项目， 会继续承接相关能力。
                </p>
              </motion.section>

              <div className="grid gap-4 md:grid-cols-2">
                <AboutCard
                  title="AnyChat 开源项目"
                  description="查看当前 Tauri 主线源码、提交历史和后续迭代。"
                  buttonLabel="访问 AnyChat 项目"
                  href={ANYCHAT_REPO_URL}
                />
                <AboutCard
                  title="AmberKeeper"
                  description="如果你需要数据管理、存储和沉淀能力，请前往 AmberKeeper 项目。"
                  buttonLabel="查看 AmberKeeper"
                  href={AMBERKEEPER_REPO_URL}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加自定义服务</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">服务名称</label>
              <Input
                placeholder="例如：My AI Chat"
                value={newServiceName}
                onChange={(event) => setNewServiceName(event.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">服务地址</label>
              <Input
                placeholder="例如：https://chat.example.com"
                value={newServiceUrl}
                onChange={(event) => setNewServiceUrl(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">图标预览</label>
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                  {logoLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : fetchedLogoUrl ? (
                    <img src={fetchedLogoUrl} alt="Logo" className="h-8 w-8 object-contain" />
                  ) : selectedPresetIcon ? (
                    (() => {
                      const preset = PRESET_ICONS.find((item) => item.id === selectedPresetIcon);
                      if (!preset) {
                        return <Globe className="h-6 w-6 text-muted-foreground" />;
                      }

                      const IconComponent = preset.Icon;
                      return <IconComponent className="h-6 w-6 text-primary" />;
                    })()
                  ) : (
                    <Globe className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>

                <p className="flex-1 text-xs text-muted-foreground">
                  {logoLoading
                    ? '正在获取图标...'
                    : fetchedLogoUrl
                      ? '已从网站获取图标'
                      : '输入地址后自动获取，或选择预设图标'}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">预设图标</label>
              <div className="grid grid-cols-7 gap-2">
                {PRESET_ICONS.map((preset) => {
                  const IconComponent = preset.Icon;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-lg border transition-all hover:border-primary/50',
                        selectedPresetIcon === preset.id
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-muted/30'
                      )}
                      onClick={() => {
                        setSelectedPresetIcon(preset.id);
                        setFetchedLogoUrl(null);
                      }}
                      title={preset.label}
                    >
                      <IconComponent
                        className={cn(
                          'h-5 w-5',
                          selectedPresetIcon === preset.id
                            ? 'text-primary'
                            : 'text-muted-foreground'
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowAddDialog(false)}>
              取消
            </Button>
            <Button
              onClick={handleAddService}
              disabled={!newServiceName.trim() || !newServiceUrl.trim()}
            >
              添加
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
