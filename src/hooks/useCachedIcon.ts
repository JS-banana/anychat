import { useState, useEffect, useCallback } from 'react';
import { getCachedIcon, cacheIcon } from '@/lib/icon-cache';
import { getServiceIconCandidates } from '@/lib/icon';

interface CachedIconState {
  url: string | null;
  loading: boolean;
}

const iconStateCache = new Map<string, CachedIconState>();
const loadingPromises = new Map<string, Promise<string | null>>();

async function tryFetchAndCache(url: string): Promise<string | null> {
  const cached = await getCachedIcon(url);
  if (cached) return cached;

  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return null;

    const blob = await response.blob();
    if (!blob.type.startsWith('image/') && blob.size < 100) return null;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    await cacheIcon(url, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

async function loadIconWithCache(
  serviceUrl: string,
  iconUrl: string | undefined
): Promise<string | null> {
  const candidates = getServiceIconCandidates(serviceUrl, iconUrl);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const result = await tryFetchAndCache(candidate);
    if (result) return result;
  }

  return candidates[0] || null;
}

export function useCachedIcon(
  serviceId: string,
  serviceUrl: string,
  iconUrl: string | undefined
): { iconSrc: string | null; loading: boolean } {
  const cacheKey = `${serviceId}-${serviceUrl}-${iconUrl || ''}`;

  const [state, setState] = useState<CachedIconState>(() => {
    const cached = iconStateCache.get(cacheKey);
    return cached || { url: null, loading: true };
  });

  const loadIcon = useCallback(async () => {
    if (loadingPromises.has(cacheKey)) {
      const result = await loadingPromises.get(cacheKey);
      setState({ url: result ?? null, loading: false });
      return;
    }

    const promise = loadIconWithCache(serviceUrl, iconUrl);
    loadingPromises.set(cacheKey, promise);

    try {
      const result = await promise;
      const newState = { url: result, loading: false };
      iconStateCache.set(cacheKey, newState);
      setState(newState);
    } finally {
      loadingPromises.delete(cacheKey);
    }
  }, [cacheKey, serviceUrl, iconUrl]);

  useEffect(() => {
    const cached = iconStateCache.get(cacheKey);
    if (cached && !cached.loading) {
      setState(cached);
      return;
    }

    loadIcon();
  }, [cacheKey, loadIcon]);

  return { iconSrc: state.url, loading: state.loading };
}
