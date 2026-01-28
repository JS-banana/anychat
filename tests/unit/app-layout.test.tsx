import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { AppLayout } from '@/components/AppLayout';

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: () => undefined,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@/services/backup', () => ({
  startAutoBackup: vi.fn(),
  stopAutoBackup: vi.fn(),
}));

vi.mock('@/services/database', () => ({
  initDatabase: vi.fn(() => Promise.reject(new Error('db init failed'))),
  createSession: vi.fn(),
  createMessage: vi.fn(),
}));

vi.mock('@/stores/app-store', () => ({
  useAppStore: () => ({
    activeServiceId: null,
    settingsPageOpen: false,
    addServiceDialogOpen: false,
    services: [],
  }),
}));

vi.mock('@/components/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock('@/components/WebViewContainer', () => ({
  WebViewContainer: () => <div data-testid="webview" />,
}));

vi.mock('@/components/AddServiceDialog', () => ({
  AddServiceDialog: () => <div data-testid="add-service" />,
}));

vi.mock('@/components/SettingsPage', () => ({
  SettingsPage: () => <div data-testid="settings" />,
}));

// no-op localStorage for zustand persist in other imports
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  writable: true,
});

describe('AppLayout', () => {
  it('shows database init error when initialization fails', async () => {
    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByText('数据库初始化失败')).toBeInTheDocument();
    });

    expect(screen.getByText('db init failed')).toBeInTheDocument();
  });
});
