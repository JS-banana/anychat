import { useState, useEffect, useCallback, useRef } from 'react';
import { getCachedIcon, cacheIcon } from '@/lib/icon-cache';
import { getServiceIconCandidates } from '@/lib/icon';

interface CachedIconState {
  url: string | null;
  loading: boolean;
  candidateIndex: number;
  candidateUrl: string | null;
  resolved: boolean;
}

const iconStateCache = new Map<string, CachedIconState>();
const loadingPromises = new Map<string, Promise<CachedIconState>>();

async function tryFetchAndCache(url: string): Promise<string | null> {
  const cached = await getCachedIcon(url);
  if (cached) return cached;

  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return null;

    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return null;

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
): Promise<CachedIconState> {
  const candidates = getServiceIconCandidates(serviceUrl, iconUrl);
  if (candidates.length === 0) {
    return { url: null, loading: false, candidateIndex: -1, candidateUrl: null, resolved: false };
  }

  for (const [index, candidate] of candidates.entries()) {
    const result = await tryFetchAndCache(candidate);
    if (result) {
      return {
        url: result,
        loading: false,
        candidateIndex: index,
        candidateUrl: candidate,
        resolved: true,
      };
    }
  }

  return {
    url: candidates[0] ?? null,
    loading: false,
    candidateIndex: 0,
    candidateUrl: candidates[0] ?? null,
    resolved: false,
  };
}

export function useCachedIcon(
  serviceId: string,
  serviceUrl: string,
  iconUrl: string | undefined,
  options?: { onResolvedCandidate?: (candidateUrl: string) => void }
): { iconSrc: string | null; loading: boolean; onError: () => void; onLoad: () => void } {
  const cacheKey = `${serviceId}-${serviceUrl}-${iconUrl || ''}`;
  const onResolvedCandidateRef = useRef(options?.onResolvedCandidate);
  const lastResolvedCandidateRef = useRef<string | null>(null);

  useEffect(() => {
    onResolvedCandidateRef.current = options?.onResolvedCandidate;
  }, [options?.onResolvedCandidate]);

  useEffect(() => {
    lastResolvedCandidateRef.current = null;
  }, [cacheKey]);

  const [state, setState] = useState<CachedIconState>(() => {
    const cached = iconStateCache.get(cacheKey);
    return (
      cached || {
        url: null,
        loading: true,
        candidateIndex: -1,
        candidateUrl: null,
        resolved: false,
      }
    );
  });

  const reportResolvedCandidate = useCallback((candidateUrl: string | null) => {
    if (!candidateUrl || lastResolvedCandidateRef.current === candidateUrl) return;

    lastResolvedCandidateRef.current = candidateUrl;
    onResolvedCandidateRef.current?.(candidateUrl);
  }, []);

  const loadIcon = useCallback(async () => {
    if (loadingPromises.has(cacheKey)) {
      const result = await loadingPromises.get(cacheKey);
      if (result) {
        setState(result);
        if (result.resolved) {
          reportResolvedCandidate(result.candidateUrl);
        }
      }
      return;
    }

    const promise = loadIconWithCache(serviceUrl, iconUrl);
    loadingPromises.set(cacheKey, promise);

    try {
      const result = await promise;
      iconStateCache.set(cacheKey, result);
      setState(result);
      if (result.resolved) {
        reportResolvedCandidate(result.candidateUrl);
      }
    } finally {
      loadingPromises.delete(cacheKey);
    }
  }, [cacheKey, serviceUrl, iconUrl, reportResolvedCandidate]);

  const handleError = useCallback(() => {
    const candidates = getServiceIconCandidates(serviceUrl, iconUrl);

    setState((prev) => {
      const nextIndex = prev.candidateIndex + 1;
      const nextState: CachedIconState = {
        url: candidates[nextIndex] ?? null,
        loading: false,
        candidateIndex: nextIndex,
        candidateUrl: candidates[nextIndex] ?? null,
        resolved: false,
      };
      iconStateCache.set(cacheKey, nextState);
      return nextState;
    });
  }, [cacheKey, serviceUrl, iconUrl]);

  const handleLoad = useCallback(() => {
    setState((prev) => {
      if (prev.resolved) return prev;

      const nextState = { ...prev, resolved: true };
      iconStateCache.set(cacheKey, nextState);
      reportResolvedCandidate(nextState.candidateUrl);
      return nextState;
    });
  }, [cacheKey, reportResolvedCandidate]);

  useEffect(() => {
    const cached = iconStateCache.get(cacheKey);
    if (cached && !cached.loading) {
      setState(cached);
      if (cached.resolved) {
        reportResolvedCandidate(cached.candidateUrl);
      }
      return;
    }

    loadIcon();
  }, [cacheKey, loadIcon, reportResolvedCandidate]);

  return { iconSrc: state.url, loading: state.loading, onError: handleError, onLoad: handleLoad };
}
