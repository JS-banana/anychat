import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window';

interface Service {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export class WebviewDockManager {
  private windows = new Map<string, WebviewWindow>();
  private sidebarWidth = 64;

  async ensure(service: Service): Promise<WebviewWindow> {
    if (this.windows.has(service.id)) {
      return this.windows.get(service.id)!;
    }

    const label = `svc_${service.id}`;

    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      this.windows.set(service.id, existing);
      return existing;
    }

    const win = new WebviewWindow(label, {
      url: service.url,
      title: service.name,
      decorations: false,
      resizable: false,
      transparent: false,
      visible: false,
      skipTaskbar: true,
    });

    await new Promise<void>((resolve, reject) => {
      win.once('tauri://created', () => resolve());
      win.once('tauri://error', (e) => reject(e));
    });

    win.once('tauri://destroyed', () => {
      this.windows.delete(service.id);
    });

    this.windows.set(service.id, win);
    return win;
  }

  async layoutAll(): Promise<void> {
    const main = getCurrentWindow();
    const outerSize = await main.outerSize();
    const outerPos = await main.outerPosition();
    const innerSize = await main.innerSize();
    const scale = await main.scaleFactor();

    const titleBarHeight = (outerSize.height - innerSize.height) / scale;

    const logicalX = outerPos.x / scale + this.sidebarWidth;
    const logicalY = outerPos.y / scale + titleBarHeight;
    const logicalW = Math.max(0, innerSize.width / scale - this.sidebarWidth);
    const logicalH = innerSize.height / scale;

    await Promise.all(
      [...this.windows.values()].map(async (wvw) => {
        try {
          await wvw.setPosition(new LogicalPosition(logicalX, logicalY));
          await wvw.setSize(new LogicalSize(logicalW, logicalH));
        } catch (err) {
          console.error('Failed to layout webview:', err);
        }
      })
    );
  }

  async showOnly(activeServiceId: string, services: Service[]): Promise<void> {
    const enabledServices = services.filter((s) => s.enabled);

    for (const service of enabledServices) {
      await this.ensure(service);
    }

    await this.layoutAll();

    await Promise.all(
      enabledServices.map(async (service) => {
        const wvw = this.windows.get(service.id);
        if (!wvw) return;

        try {
          if (service.id === activeServiceId) {
            await wvw.show();
            await wvw.setFocus();
          } else {
            await wvw.hide();
          }
        } catch (err) {
          console.error(`Failed to toggle webview ${service.id}:`, err);
        }
      })
    );
  }

  async destroyDisabled(services: Service[]): Promise<void> {
    const enabledIds = new Set(services.filter((s) => s.enabled).map((s) => s.id));

    await Promise.all(
      [...this.windows.entries()].map(async ([id, wvw]) => {
        if (!enabledIds.has(id)) {
          try {
            await wvw.close();
          } catch {
            // ignore
          }
          this.windows.delete(id);
        }
      })
    );
  }

  async hideAll(): Promise<void> {
    await Promise.all(
      [...this.windows.values()].map(async (wvw) => {
        try {
          await wvw.hide();
        } catch {
          // ignore
        }
      })
    );
  }

  async refresh(serviceId: string): Promise<void> {
    const wvw = this.windows.get(serviceId);
    if (wvw) {
      const service = [...this.windows.entries()].find(([id]) => id === serviceId);
      if (service) {
        await wvw.close();
        this.windows.delete(serviceId);
      }
    }
  }
}

let dockManager: WebviewDockManager | null = null;

export function getDockManager(): WebviewDockManager {
  if (!dockManager) {
    dockManager = new WebviewDockManager();
  }
  return dockManager;
}
