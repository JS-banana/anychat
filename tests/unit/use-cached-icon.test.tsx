import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCachedIcon } from '@/hooks/useCachedIcon';
import { getServiceIconCandidates } from '@/lib/icon';
import { getCachedIcon, cacheIcon } from '@/lib/icon-cache';

vi.mock('@/lib/icon', () => ({
  getServiceIconCandidates: vi.fn(),
}));

vi.mock('@/lib/icon-cache', () => ({
  getCachedIcon: vi.fn(),
  cacheIcon: vi.fn(),
}));

describe('useCachedIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fall back to the first candidate URL when caching fetches all fail', async () => {
    vi.mocked(getServiceIconCandidates).mockReturnValue([
      'https://example.com/favicon.svg',
      'https://example.com/favicon.ico',
    ]);
    vi.mocked(getCachedIcon).mockResolvedValue(null);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      blob: vi.fn(),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useCachedIcon('svc-all-fail', 'https://example.com', undefined)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.iconSrc).toBe('https://example.com/favicon.svg');
  });

  it('should advance to the next candidate when the current image source errors', async () => {
    vi.mocked(getServiceIconCandidates).mockReturnValue([
      'https://example.com/favicon.svg',
      'https://example.com/favicon.ico',
      'https://www.google.com/s2/favicons?domain=example.com&sz=64',
    ]);
    vi.mocked(getCachedIcon).mockResolvedValue(null);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      blob: vi.fn(),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useCachedIcon('svc-advance', 'https://example.com', undefined)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.iconSrc).toBe('https://example.com/favicon.svg');

    act(() => {
      (result.current as { onError?: () => void }).onError?.();
    });

    await waitFor(() => {
      expect(result.current.iconSrc).toBe('https://example.com/favicon.ico');
    });
  });

  it('reports the resolved candidate URL after a fallback image loads successfully', async () => {
    vi.mocked(getServiceIconCandidates).mockReturnValue([
      'https://example.com/favicon.svg',
      'https://example.com/favicon.ico',
    ]);
    vi.mocked(getCachedIcon).mockResolvedValue(null);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      blob: vi.fn(),
    });
    const handleResolved = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useCachedIcon('svc-resolve', 'https://example.com', undefined, {
        onResolvedCandidate: handleResolved,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.onError();
    });

    act(() => {
      (result.current as { onLoad?: () => void }).onLoad?.();
    });

    expect(handleResolved).toHaveBeenCalledWith('https://example.com/favicon.ico');
  });

  it('should skip non-image response and continue trying next candidate', async () => {
    vi.mocked(getServiceIconCandidates).mockReturnValue([
      'https://example.com/not-image',
      'https://example.com/real-image',
    ]);
    vi.mocked(getCachedIcon).mockResolvedValue(null);

    const htmlBlob = new Blob(['x'.repeat(200)], { type: 'text/html' });
    const imageBlob = new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' });

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('not-image')) {
        return Promise.resolve({
          ok: true,
          blob: async () => htmlBlob,
        });
      }

      return Promise.resolve({
        ok: true,
        blob: async () => imageBlob,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useCachedIcon('svc-non-image', 'https://example.com', undefined)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.iconSrc).toMatch(/^data:image\//);
    expect(cacheIcon).toHaveBeenCalledWith(
      'https://example.com/real-image',
      expect.stringMatching(/^data:image\//)
    );
  });
});
