import { useCallback, useSyncExternalStore } from 'react';

const iconErrorCache = new Map<string, number>();

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  return iconErrorCache;
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function useIconCache() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const getErrorIndex = useCallback((key: string): number => {
    return iconErrorCache.get(key) ?? 0;
  }, []);

  const incrementErrorIndex = useCallback((key: string): void => {
    const current = iconErrorCache.get(key) ?? 0;
    iconErrorCache.set(key, current + 1);
    notifyListeners();
  }, []);

  const resetErrorIndex = useCallback((key: string): void => {
    if (iconErrorCache.has(key)) {
      iconErrorCache.delete(key);
      notifyListeners();
    }
  }, []);

  return { getErrorIndex, incrementErrorIndex, resetErrorIndex };
}
