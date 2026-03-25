import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { AppLayout } from '@/components/AppLayout';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: () => undefined,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
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

  it('switches to the active service when no dialog is open', async () => {
    storeState = {
      ...storeState,
      activeServiceId: 'chatgpt',
      services: [{ id: 'chatgpt', url: 'https://chatgpt.com' }],
    };

    render(<AppLayout />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('switch_webview', {
        label: 'chatgpt',
        url: 'https://chatgpt.com',
      });
    });
  });

  it('hides all webviews while dialogs are open', async () => {
    storeState = {
      ...storeState,
      settingsPageOpen: true,
      activeServiceId: 'chatgpt',
      services: [{ id: 'chatgpt', url: 'https://chatgpt.com' }],
    };

    render(<AppLayout />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('hide_all_webviews');
    });
  });
});
