import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { SettingsPage } from '@/components/SettingsPage';

const { mockOpenUrl } = vi.hoisted(() => ({
  mockOpenUrl: vi.fn(() => Promise.resolve()),
}));

type StoreState = {
  settingsPageOpen: boolean;
  settingsActiveTab: 'services' | 'about';
  setSettingsActiveTab: (tab: 'services' | 'about') => void;
  services: Array<{
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    order: number;
  }>;
  toggleServiceEnabled: (id: string) => void;
  removeService: (id: string) => void;
  reorderServices: (startIndex: number, endIndex: number) => void;
  addService: () => void;
};

let storeState: StoreState = {
  settingsPageOpen: true,
  settingsActiveTab: 'about',
  setSettingsActiveTab: vi.fn(),
  services: [],
  toggleServiceEnabled: vi.fn(),
  removeService: vi.fn(),
  reorderServices: vi.fn(),
  addService: vi.fn(),
};

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: mockOpenUrl,
}));

vi.mock('@/stores/app-store', () => ({
  useAppStore: () => storeState,
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = {
      settingsPageOpen: true,
      settingsActiveTab: 'about',
      setSettingsActiveTab: vi.fn(),
      services: [],
      toggleServiceEnabled: vi.fn(),
      removeService: vi.fn(),
      reorderServices: vi.fn(),
      addService: vi.fn(),
    };
  });

  it('removes the data management tab and outdated local-storage copy', () => {
    render(<SettingsPage />);

    expect(screen.queryByRole('button', { name: '数据管理' })).not.toBeInTheDocument();
    expect(screen.queryByText(/本地可控的聊天数据沉淀/)).not.toBeInTheDocument();
    expect(screen.queryByText(/聊天数据存储在本地设备上/)).not.toBeInTheDocument();
  });

  it('shows one-click project links for AnyChat and AmberKeeper in the about view', async () => {
    render(<SettingsPage />);

    expect(screen.getByText(/如果你更关注数据管理和存储/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /访问 AnyChat 项目/i }));
    expect(mockOpenUrl).toHaveBeenCalledWith('https://github.com/JS-banana/anychat');

    fireEvent.click(screen.getByRole('button', { name: /查看 AmberKeeper/i }));
    expect(mockOpenUrl).toHaveBeenCalledWith('https://github.com/JS-banana/AmberKeeper');
  });
});
