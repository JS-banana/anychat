export function getServiceIconCandidates(url: string, explicitIconUrl?: string): string[] {
  const candidates: string[] = [];

  if (explicitIconUrl) {
    candidates.push(explicitIconUrl);
  }

  const fallback = buildFaviconFallback(url);
  if (fallback && !candidates.includes(fallback)) {
    candidates.push(fallback);
  }

  return candidates;
}

function buildFaviconFallback(url: string): string {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return '';
  }
}
