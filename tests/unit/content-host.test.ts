import { afterEach, describe, expect, it, vi } from 'vitest';

type InvokeMock = ReturnType<typeof vi.fn>;

async function loadContentHostModule(
  hostPlatform: 'windows' | 'macos' | 'linux' | 'unknown' | 'reject'
) {
  vi.resetModules();

  const mockInvoke: InvokeMock = vi.fn((command: string) => {
    if (command === 'host_platform') {
      if (hostPlatform === 'reject') {
        return Promise.reject(new Error('host platform unavailable'));
      }

      return Promise.resolve(hostPlatform);
    }

    return Promise.resolve();
  });

  vi.doMock('@tauri-apps/api/core', () => ({
    invoke: mockInvoke,
  }));

  const contentHost = await import('@/services/content-host');

  return {
    contentHost,
    mockInvoke,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('content-host', () => {
  it('activates service content through the shared Rust command surface on non-Windows platforms', async () => {
    const { contentHost, mockInvoke } = await loadContentHostModule('macos');

    await contentHost.activateServiceContent(
      { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true },
      [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true }]
    );

    expect(mockInvoke).toHaveBeenCalledWith('activate_service_content', {
      service: { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true },
      services: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true }],
    });
  });

  it('routes Windows activation through the shared Rust command surface and preserves managed service metadata', async () => {
    const { contentHost, mockInvoke } = await loadContentHostModule('windows');

    await contentHost.activateServiceContent(
      { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true },
      [
        { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true },
        { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', enabled: false },
      ]
    );

    expect(mockInvoke).toHaveBeenCalledWith('activate_service_content', {
      service: { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true },
      services: [
        { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true },
        { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', enabled: false },
      ],
    });
  });

  it('refreshes service content through the shared Rust command surface', async () => {
    const { contentHost, mockInvoke } = await loadContentHostModule('windows');

    await contentHost.refreshServiceContent(
      { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true },
      [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true }]
    );

    expect(mockInvoke).toHaveBeenCalledWith('refresh_service_content', {
      service: { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true },
      services: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true }],
    });
  });

  it('syncs managed service host state through Rust when the active service changes', async () => {
    const { contentHost, mockInvoke } = await loadContentHostModule('windows');

    await contentHost.syncServiceHostState(
      [
        { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true },
        { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', enabled: false },
      ],
      null
    );

    expect(mockInvoke).toHaveBeenCalledWith('sync_service_host_state', {
      services: [
        { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', enabled: true },
        { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', enabled: false },
      ],
      activeServiceId: null,
    });
  });

  it('syncs docked content layout through Rust only on Windows hosts', async () => {
    const { contentHost, mockInvoke } = await loadContentHostModule('windows');

    await contentHost.syncDockedContentLayout();

    expect(mockInvoke).toHaveBeenCalledWith('sync_docked_content_layout');
  });

  it('treats platform lookup failures as non-Windows hosts', async () => {
    const { contentHost, mockInvoke } = await loadContentHostModule('reject');

    await expect(contentHost.usesDockedWindowContentHost()).resolves.toBe(false);

    expect(mockInvoke).toHaveBeenCalledWith('host_platform');
  });
});
