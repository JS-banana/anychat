import { useState, useEffect } from 'react';
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
import { Input } from '@/components/ui/input';
import {
  Settings,
  Database,
  Info,
  Eye,
  EyeOff,
  GripVertical,
  Trash2,
  Plus,
  Loader2,
  Save,
  Download,
  Search,
  Calendar,
  X,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getServiceIconCandidates } from '@/lib/icon';
import { ChatService } from '@/types';
import { exportAllData } from '@/services/import-export';
import {
  getSessions,
  getMessages,
  deleteSession,
  searchMessages,
  ChatSession,
  ChatMessage,
} from '@/services/database';
import { createBackup } from '@/services/backup';
import { motion, AnimatePresence } from 'framer-motion';

// --- Sub-components for Services Tab ---

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

// --- Main Settings Page Component ---

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

  const [showAddForm, setShowAddForm] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceUrl, setNewServiceUrl] = useState('');

  // Data Management State
  const [exporting, setExporting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  // History State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const sortedServices = [...services].sort((a, b) => a.order - b.order);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (settingsPageOpen && settingsActiveTab === 'data') {
      loadSessions();
    }
  }, [settingsPageOpen, settingsActiveTab]);

  useEffect(() => {
    if (selectedSession) {
      loadMessages(selectedSession.id);
    }
  }, [selectedSession]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        handleSearch();
      } else {
        setSearchResults([]);
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadSessions = async () => {
    setLoadingHistory(true);
    try {
      const data = await getSessions();
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadMessages = async (sessionId: string) => {
    try {
      const data = await getMessages(sessionId);
      setMessages(data);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  };

  const handleSearch = async () => {
    setIsSearching(true);
    try {
      const results = await searchMessages(searchQuery);
      setSearchResults(results);
    } catch (err) {
      console.error('Search failed:', err);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (selectedSession?.id === sessionId) {
        setSelectedSession(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = sortedServices.findIndex((s) => s.id === active.id);
      const newIndex = sortedServices.findIndex((s) => s.id === over.id);
      reorderServices(oldIndex, newIndex);
    }
  };

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      await createBackup();
      alert('备份创建成功！');
    } catch (err) {
      console.error('Backup failed:', err);
      alert('备份失败');
    } finally {
      setBackingUp(false);
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

  const handleExportSession = (session: ChatSession) => {
    const exportData = {
      session,
      messages,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${session.title.slice(0, 30)}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (!settingsPageOpen) return null;

  return (
    <div className="flex h-full w-full bg-background text-foreground animate-in fade-in duration-200">
      {/* Left Sidebar */}
      <div className="w-64 flex-none border-r bg-muted/30 flex flex-col pt-4">
        <nav className="flex-1 p-2 space-y-1">
          <button
            onClick={() => setSettingsActiveTab('services')}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors',
              settingsActiveTab === 'services'
                ? 'bg-primary/10 text-primary border-l-2 border-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Settings className="h-4 w-4" />
            服务管理
          </button>

          <button
            onClick={() => setSettingsActiveTab('data')}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors',
              settingsActiveTab === 'data'
                ? 'bg-primary/10 text-primary border-l-2 border-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Database className="h-4 w-4" />
            数据管理
          </button>

          <button
            onClick={() => setSettingsActiveTab('about')}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors',
              settingsActiveTab === 'about'
                ? 'bg-primary/10 text-primary border-l-2 border-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Info className="h-4 w-4" />
            关于
          </button>
        </nav>
      </div>

      {/* Right Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        {settingsActiveTab === 'services' && (
          <div className="flex-1 overflow-y-auto p-8 max-w-3xl [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            <h1 className="text-2xl font-bold mb-6">服务管理</h1>
            <div className="space-y-6">
              <div>
                <p className="text-sm text-muted-foreground mb-4">
                  拖拽排序服务。点击眼睛图标切换显示/隐藏。
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

                {showAddForm ? (
                  <div className="mt-4 space-y-3 rounded-lg border border-dashed p-4 animate-in fade-in slide-in-from-top-2">
                    <h3 className="font-medium">添加自定义服务</h3>
                    <div className="space-y-2">
                      <Input
                        placeholder="服务名称"
                        value={newServiceName}
                        onChange={(e) => setNewServiceName(e.target.value)}
                        autoFocus
                      />
                      <Input
                        placeholder="服务地址 (例如 https://chat.example.com)"
                        value={newServiceUrl}
                        onChange={(e) => setNewServiceUrl(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setShowAddForm(false);
                          setNewServiceName('');
                          setNewServiceUrl('');
                        }}
                      >
                        取消
                      </Button>
                      <Button
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
                        添加
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="mt-4 w-full border-dashed"
                    onClick={() => setShowAddForm(true)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    添加自定义服务
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {settingsActiveTab === 'data' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-6 border-b bg-background z-10">
              <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-bold">数据管理</h1>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleBackup} disabled={backingUp}>
                    {backingUp ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    立即备份
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                    {exporting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    导出全部
                  </Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">管理您的聊天记录、备份和数据导出。</p>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {/* Session List */}
              <div className="w-80 flex-none border-r flex flex-col bg-muted/10">
                <div className="p-3 border-b">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="搜索消息..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 bg-background"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {loadingHistory ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                      加载中...
                    </div>
                  ) : isSearching ? (
                    <div className="p-2">
                      <p className="text-xs text-muted-foreground px-2 py-1">
                        找到 {searchResults.length} 条结果
                      </p>
                      {searchResults.map((msg) => (
                        <div
                          key={msg.id}
                          className="p-3 mb-2 rounded-lg bg-background border hover:border-primary/50 cursor-pointer text-sm transition-all"
                        >
                          <p className="line-clamp-2 font-medium">{msg.content}</p>
                          <p className="text-xs text-muted-foreground mt-2 flex items-center justify-between">
                            <span>{formatDate(msg.created_at)}</span>
                            <span className="capitalize bg-muted px-1.5 py-0.5 rounded text-[10px]">
                              {msg.role}
                            </span>
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : sessions.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                      <MessageSquare className="h-8 w-8 mb-3 opacity-20" />
                      <p>暂无聊天记录</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {sessions.map((session) => (
                        <div
                          key={session.id}
                          className={cn(
                            'p-3 cursor-pointer transition-all hover:bg-muted/50',
                            selectedSession?.id === session.id
                              ? 'bg-muted border-l-2 border-primary pl-[10px]'
                              : 'pl-3'
                          )}
                          onClick={() => setSelectedSession(session)}
                        >
                          <div className="flex items-start justify-between mb-1">
                            <p
                              className={cn(
                                'font-medium truncate text-sm',
                                selectedSession?.id === session.id && 'text-primary'
                              )}
                            >
                              {session.title}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {formatDate(session.updated_at)}
                            <span>·</span>
                            <span>{session.message_count} 条消息</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Chat View */}
              <div className="flex-1 flex flex-col bg-background">
                {selectedSession ? (
                  <>
                    <div className="h-14 flex items-center justify-between px-6 border-b flex-none">
                      <div>
                        <h3 className="font-medium truncate max-w-md">{selectedSession.title}</h3>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleExportSession(selectedSession)}
                          title="导出会话"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleDeleteSession(selectedSession.id)}
                          title="删除会话"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                      <AnimatePresence>
                        {messages.map((msg, idx) => (
                          <motion.div
                            key={msg.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.02 }}
                            className={cn(
                              'flex w-full',
                              msg.role === 'user' ? 'justify-end' : 'justify-start'
                            )}
                          >
                            <div
                              className={cn(
                                'max-w-[80%] rounded-2xl p-4 text-sm',
                                msg.role === 'user'
                                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                                  : 'bg-muted text-foreground rounded-bl-sm'
                              )}
                            >
                              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                              <p
                                className={cn(
                                  'text-[10px] mt-2 opacity-70',
                                  msg.role === 'user'
                                    ? 'text-primary-foreground/80'
                                    : 'text-muted-foreground'
                                )}
                              >
                                {new Date(msg.created_at * 1000).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                    <MessageSquare className="h-12 w-12 mb-4 opacity-10" />
                    <p>选择会话查看历史</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {settingsActiveTab === 'about' && (
          <div className="flex-1 overflow-y-auto p-8 max-w-2xl">
            <h1 className="text-2xl font-bold mb-6">关于 AnyChat</h1>
            <div className="space-y-4 text-sm text-muted-foreground">
              <div className="p-6 rounded-lg border bg-card text-card-foreground">
                <div className="flex items-center gap-4 mb-4">
                  <div className="h-12 w-12 bg-primary/10 rounded-xl flex items-center justify-center">
                    <Settings className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">AnyChat</h2>
                    <p className="text-xs">版本 0.1.0</p>
                  </div>
                </div>
                <p className="leading-relaxed">
                  基于 Tauri 2.0 的多 AI Chat 聚合桌面客户端，聚焦"统一入口 +
                  本地可控的聊天数据沉淀"。
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="p-4 rounded-lg border bg-muted/20">
                  <h3 className="font-medium text-foreground mb-2">隐私优先</h3>
                  <p className="text-xs">
                    您的聊天数据存储在本地设备上。我们不会收集或上传您的对话记录。
                  </p>
                </div>
                <div className="p-4 rounded-lg border bg-muted/20">
                  <h3 className="font-medium text-foreground mb-2">开源</h3>
                  <p className="text-xs">本项目开源。您可以在我们的代码库中贡献代码或审计安全。</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
