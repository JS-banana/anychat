const OFFICIAL_ICON_MAP: Record<string, string> = {
  'qianwen.com':
    'https://img.alicdn.com/imgextra/i4/O1CN01uar8u91DHWktnF2fl_!!6000000000191-2-tps-110-110.png',
};

export function getServiceIconCandidates(url: string, explicitIconUrl?: string): string[] {
  const candidates: string[] = [];

  const addCandidate = (candidate: string | undefined) => {
    if (!candidate) return;
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  addCandidate(explicitIconUrl);

  const parsedUrl = parseUrl(url);
  if (!parsedUrl) {
    return candidates;
  }

  const host = parsedUrl.hostname.replace(/^www\./, '');
  addCandidate(OFFICIAL_ICON_MAP[host]);
  addCandidate(buildOriginFavicon(parsedUrl));
  addCandidate(buildDuckDuckGoFavicon(host));

  return candidates;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function buildOriginFavicon(url: URL): string {
  return `${url.origin}/favicon.ico`;
}

function buildDuckDuckGoFavicon(host: string): string {
  return `https://icons.duckduckgo.com/ip3/${host}.ico`;
}
