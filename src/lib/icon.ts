import { invoke } from '@tauri-apps/api/core';

const OFFICIAL_ICON_MAP: Record<string, string> = {
  'deepseek.com': 'https://deepseek.com/favicon.ico',
  'qianwen.com':
    'https://img.alicdn.com/imgextra/i4/O1CN01uar8u91DHWktnF2fl_!!6000000000191-2-tps-110-110.png',
};
const DEFAULT_ICON_PROBE_TIMEOUT_MS = 3000;

export function getServiceIconCandidates(url: string, explicitIconUrl?: string): string[] {
  const candidates: string[] = [];

  const addCandidate = (candidate: string | undefined) => {
    if (!candidate) return;
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  const parsedUrl = parseUrl(url);
  const explicitIsFallback = isThirdPartyFallbackIcon(explicitIconUrl);

  if (!explicitIsFallback) {
    addCandidate(explicitIconUrl);
  }

  if (!parsedUrl) {
    if (explicitIsFallback) {
      addCandidate(explicitIconUrl);
    }
    return candidates;
  }

  const hostVariants = getHostVariants(parsedUrl.hostname);
  const originVariants = getOriginVariants(parsedUrl, hostVariants);

  for (const host of hostVariants) {
    addCandidate(OFFICIAL_ICON_MAP[host]);
  }

  for (const origin of originVariants) {
    addCandidate(`${origin}/favicon.svg`);
    addCandidate(`${origin}/favicon.ico`);
    addCandidate(`${origin}/apple-touch-icon.png`);
    addCandidate(`${origin}/icon.svg`);
  }

  if (explicitIsFallback) {
    addCandidate(explicitIconUrl);
  }

  for (const host of hostVariants) {
    addCandidate(buildDuckDuckGoFavicon(host));
    addCandidate(buildGoogleS2Favicon(host));
  }

  return candidates;
}

export function normalizeServiceUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`).toString();
  } catch {
    return null;
  }
}

export async function findWorkingIconCandidate(
  serviceUrl: string,
  explicitIconUrl?: string,
  options?: { timeoutMs?: number; ImageCtor?: typeof Image }
): Promise<string | null> {
  const candidates = await resolveServiceIconCandidates(serviceUrl, explicitIconUrl);

  for (const candidate of candidates) {
    try {
      await probeImageUrl(candidate, options);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

export async function resolveServiceIconCandidates(
  serviceUrl: string,
  explicitIconUrl?: string
): Promise<string[]> {
  const baseCandidates = getServiceIconCandidates(serviceUrl, explicitIconUrl);
  const hasStableExplicitIcon = !!explicitIconUrl && !isThirdPartyFallbackIcon(explicitIconUrl);

  if (hasStableExplicitIcon) {
    return baseCandidates;
  }

  const discoveredIconUrl = await discoverSiteIcon(serviceUrl);

  if (!discoveredIconUrl || baseCandidates.includes(discoveredIconUrl)) {
    return baseCandidates;
  }

  const explicitIsPreferred =
    !!explicitIconUrl && !isThirdPartyFallbackIcon(explicitIconUrl) && baseCandidates[0] === explicitIconUrl;

  if (explicitIsPreferred) {
    return [baseCandidates[0], discoveredIconUrl, ...baseCandidates.slice(1)];
  }

  return [discoveredIconUrl, ...baseCandidates];
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

async function discoverSiteIcon(serviceUrl: string): Promise<string | null> {
  try {
    const discoveredIconUrl = await invoke<string | null>('discover_site_icon', { url: serviceUrl });
    return typeof discoveredIconUrl === 'string' && discoveredIconUrl ? discoveredIconUrl : null;
  } catch {
    return null;
  }
}

function probeImageUrl(
  url: string,
  options?: { timeoutMs?: number; ImageCtor?: typeof Image }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_ICON_PROBE_TIMEOUT_MS;
  const ImageCtor = options?.ImageCtor ?? Image;

  return new Promise((resolve, reject) => {
    const image = new ImageCtor();
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Icon probe timeout'));
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
    };

    image.onload = () => {
      cleanup();
      resolve();
    };

    image.onerror = () => {
      cleanup();
      reject(new Error('Icon probe failed'));
    };

    image.src = url;
  });
}

function getHostVariants(hostname: string): string[] {
  const variants: string[] = [];
  const addVariant = (value: string | undefined) => {
    if (!value) return;
    if (!variants.includes(value)) {
      variants.push(value);
    }
  };

  const normalizedHost = hostname.replace(/^www\./, '');
  addVariant(normalizedHost);

  const parts = normalizedHost.split('.');
  if (parts.length >= 3) {
    addVariant(parts.slice(1).join('.'));
  }
  if (parts.length >= 2) {
    addVariant(parts.slice(-2).join('.'));
  }

  return variants;
}

function getOriginVariants(url: URL, hostVariants: string[]): string[] {
  const variants: string[] = [];
  const addVariant = (value: string | undefined) => {
    if (!value) return;
    if (!variants.includes(value)) {
      variants.push(value);
    }
  };

  addVariant(url.origin);
  for (const host of hostVariants) {
    addVariant(`${url.protocol}//${host}`);
  }

  return variants;
}

function buildDuckDuckGoFavicon(host: string): string {
  return `https://icons.duckduckgo.com/ip3/${host}.ico`;
}

function buildGoogleS2Favicon(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
}

function isThirdPartyFallbackIcon(iconUrl: string | undefined): boolean {
  if (!iconUrl) return false;

  const parsed = parseUrl(iconUrl);
  if (!parsed) return false;

  const host = parsed.hostname.replace(/^www\./, '');
  return (
    (host === 'google.com' && parsed.pathname === '/s2/favicons') ||
    (host === 'icons.duckduckgo.com' && parsed.pathname.startsWith('/ip3/')) ||
    (host === 't1.gstatic.com' && parsed.pathname === '/faviconV2') ||
    (host === 't2.gstatic.com' && parsed.pathname === '/faviconV2')
  );
}
