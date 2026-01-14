import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/app-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

const PRESET_SERVICES = [
  {
    id: 'preset-claude',
    name: 'Claude',
    url: 'https://claude.ai',
    iconUrl: 'https://claude.ai/favicon.ico',
  },
  {
    id: 'preset-deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com',
    iconUrl: 'https://chat.deepseek.com/favicon.svg',
  },
  {
    id: 'preset-poe',
    name: 'Poe',
    url: 'https://poe.com',
    iconUrl: 'https://poe.com/favicon.ico',
  },
  {
    id: 'preset-perplexity',
    name: 'Perplexity',
    url: 'https://www.perplexity.ai',
    iconUrl: 'https://www.perplexity.ai/favicon.ico',
  },
  {
    id: 'preset-copilot',
    name: 'Copilot',
    url: 'https://copilot.microsoft.com',
    iconUrl: 'https://copilot.microsoft.com/favicon.ico',
  },
];

function getFaviconUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return `${urlObj.origin}/favicon.ico`;
  } catch {
    return '';
  }
}

export function AddServiceDialog() {
  const { addServiceDialogOpen, setAddServiceDialogOpen, addService, services } = useAppStore();
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [autoIconUrl, setAutoIconUrl] = useState('');

  const existingUrls = services.map((s) => s.url.toLowerCase());

  useEffect(() => {
    if (url) {
      let finalUrl = url.trim();
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = `https://${finalUrl}`;
      }
      const favicon = getFaviconUrl(finalUrl);
      setAutoIconUrl(favicon);
    } else {
      setAutoIconUrl('');
    }
  }, [url]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;

    let finalUrl = url.trim();
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = `https://${finalUrl}`;
    }

    addService({
      name: name.trim(),
      url: finalUrl,
      iconUrl: iconUrl.trim() || autoIconUrl || undefined,
      enabled: true,
    });

    resetAndClose();
  };

  const handlePresetSelect = (preset: (typeof PRESET_SERVICES)[0]) => {
    if (existingUrls.includes(preset.url.toLowerCase())) {
      return;
    }
    addService({
      name: preset.name,
      url: preset.url,
      iconUrl: preset.iconUrl,
      enabled: true,
    });
    resetAndClose();
  };

  const resetAndClose = () => {
    setName('');
    setUrl('');
    setIconUrl('');
    setAutoIconUrl('');
    setMode('preset');
    setAddServiceDialogOpen(false);
  };

  const availablePresets = PRESET_SERVICES.filter(
    (p) => !existingUrls.includes(p.url.toLowerCase())
  );

  return (
    <Dialog open={addServiceDialogOpen} onOpenChange={resetAndClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Chat Service</DialogTitle>
          <DialogDescription>Add a new AI chat service to your dashboard.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 border-b pb-3">
          <Button
            variant={mode === 'preset' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMode('preset')}
          >
            Presets
          </Button>
          <Button
            variant={mode === 'custom' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMode('custom')}
          >
            Custom
          </Button>
        </div>

        {mode === 'preset' ? (
          <div className="space-y-2">
            {availablePresets.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                All preset services have been added.
              </p>
            ) : (
              availablePresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handlePresetSelect(preset)}
                  className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                    <img
                      src={preset.iconUrl}
                      alt={preset.name}
                      className="h-5 w-5 object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{preset.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{preset.url}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="name"
                placeholder="e.g., My AI Chat"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="url" className="text-sm font-medium">
                URL
              </label>
              <Input
                id="url"
                placeholder="e.g., https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="iconUrl" className="text-sm font-medium">
                Icon URL <span className="font-normal text-muted-foreground">(auto-detected)</span>
              </label>
              <Input
                id="iconUrl"
                placeholder={autoIconUrl || 'e.g., https://example.com/icon.svg'}
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
              />
              {autoIconUrl && !iconUrl && (
                <p className="text-xs text-muted-foreground">Will use: {autoIconUrl}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button type="submit">Add Service</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
