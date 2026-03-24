import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { AppLayout } from '@/components/AppLayout';

const {
  mockInvoke,
  mockListen,
  mockInitDatabase,
  mockCreateSession,
  mockCreateMessage,
  mockStartAutoBackup,
  mockStopAutoBackup,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(() => Promise.resolve()),
  mockListen: vi.fn(() => Promise.resolve(() => undefined)),
  mockInitDatabase: vi.fn(() => Promise.resolve()),
  mockCreateSession: vi.fn(),
  mockCreateMessage: vi.fn(),
  mockStartAutoBackup: vi.fn(),
  mockStopAutoBackup: vi.fn(),
}));

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: () => undefined,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}));

vi.mock('@/services/backup', () => ({
  startAutoBackup: mockStartAutoBackup,
  stopAutoBackup: mockStopAutoBackup,
}));

vi.mock('@/services/database', () => ({
  initDatabase: mockInitDatabase,
  createSession: mockCreateSession,
  createMessage: mockCreateMessage,
}));

type StoreState = {
  activeServiceId: string | null;
  settingsPageOpen: boolean;
  settingsActiveTab: 'services' | 'about';
  addServiceDialogOpen: boolean;
  services: Array<{ id: string; url: string }>;
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
    vi.clearAllMocks();
    storeState = {
      activeServiceId: null,
      settingsPageOpen: false,
      settingsActiveTab: 'services',
      addServiceDialogOpen: false,
      services: [],
    };
  });

  it('renders webview content when settings page is closed', () => {
    render(<AppLayout />);

    expect(screen.getByTestId('webview')).toBeInTheDocument();
    expect(screen.queryByTestId('settings')).not.toBeInTheDocument();
  });

  it('renders settings page when settings page is open', () => {
    storeState = {
      ...storeState,
      settingsPageOpen: true,
      settingsActiveTab: 'about',
    };

    render(<AppLayout />);

    expect(screen.getByTestId('settings')).toBeInTheDocument();
    expect(screen.queryByTestId('webview')).not.toBeInTheDocument();
  });

  it('does not initialize database, backup, or capture listeners on mount', () => {
    render(<AppLayout />);

    expect(mockInitDatabase).not.toHaveBeenCalled();
    expect(mockStartAutoBackup).not.toHaveBeenCalled();
    expect(mockListen).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });
});
