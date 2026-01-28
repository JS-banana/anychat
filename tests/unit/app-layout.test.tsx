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

type StoreState = {
  activeServiceId: string | null;
  settingsPageOpen: boolean;
  settingsActiveTab: 'services' | 'data' | 'about';
  addServiceDialogOpen: boolean;
  services: unknown[];
};

let storeState: StoreState = {
  activeServiceId: null,
  settingsPageOpen: false,
  settingsActiveTab: 'services',
  addServiceDialogOpen: false,
  services: [],
};

vi.mock('@/stores/app-store', () => ({
  useAppStore: () => storeState,
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
  beforeEach(() => {
    storeState = {
      activeServiceId: null,
      settingsPageOpen: false,
      settingsActiveTab: 'services',
      addServiceDialogOpen: false,
      services: [],
    };
  });

  it('shows database init error when initialization fails', async () => {
    storeState = {
      activeServiceId: null,
      settingsPageOpen: true,
      settingsActiveTab: 'data',
      addServiceDialogOpen: false,
      services: [],
    };
    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByText('数据库初始化失败')).toBeInTheDocument();
    });

    expect(screen.getByText('db init failed')).toBeInTheDocument();
  });

  it('does not show db overlay when settings page is closed', async () => {
    storeState = {
      activeServiceId: null,
      settingsPageOpen: false,
      settingsActiveTab: 'data',
      addServiceDialogOpen: false,
      services: [],
    };
    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.queryByText('Initializing...')).not.toBeInTheDocument();
    });
  });

  it('shows db overlay only on data tab', async () => {
    storeState = {
      activeServiceId: null,
      settingsPageOpen: true,
      settingsActiveTab: 'data',
      addServiceDialogOpen: false,
      services: [],
    };
    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByText('数据库初始化失败')).toBeInTheDocument();
    });
  });
});
