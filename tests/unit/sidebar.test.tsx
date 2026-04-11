import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { Sidebar } from '@/components/Sidebar';

type StoreState = {
  services: Array<{
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    order: number;
    iconUrl?: string;
  }>;
  activeServiceId: string | null;
  setActiveService: (id: string) => void;
  setSettingsPageOpen: (open: boolean) => void;
  updateService: (id: string, updates: { iconUrl?: string }) => void;
};

let storeState: StoreState = {
  services: [],
  activeServiceId: null,
  setActiveService: vi.fn(),
  setSettingsPageOpen: vi.fn(),
  updateService: vi.fn(),
};

vi.mock('@/stores/app-store', () => ({
  useAppStore: () => storeState,
}));

vi.mock('@/hooks/useCachedIcon', () => ({
  useCachedIcon: () => ({
    iconSrc: null,
    onError: vi.fn(),
    onLoad: vi.fn(),
  }),
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = {
      services: [
        {
          id: 'chatgpt',
          name: 'ChatGPT',
          url: 'https://chatgpt.com',
          enabled: true,
          order: 1,
        },
        {
          id: 'gemini',
          name: 'Gemini',
          url: 'https://gemini.google.com',
          enabled: true,
          order: 2,
        },
      ],
      activeServiceId: 'gemini',
      setActiveService: vi.fn(),
      setSettingsPageOpen: vi.fn(),
      updateService: vi.fn(),
    };
  });

  it('updates active service and closes settings without issuing a duplicate host switch', () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }));

    expect(storeState.setActiveService).toHaveBeenCalledWith('chatgpt');
    expect(storeState.setSettingsPageOpen).toHaveBeenCalledWith(false);
  });
});
