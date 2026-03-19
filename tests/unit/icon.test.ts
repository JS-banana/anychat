import { describe, it, expect } from 'vitest';
import { findWorkingIconCandidate, getServiceIconCandidates, normalizeServiceUrl } from '@/lib/icon';

class MockImage {
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  private _src = '';

  static successfulUrls = new Set<string>();

  set src(value: string) {
    this._src = value;
    queueMicrotask(() => {
      if (MockImage.successfulUrls.has(value)) {
        this.onload?.();
        return;
      }

      this.onerror?.();
    });
  }

  get src() {
    return this._src;
  }
}

describe('getServiceIconCandidates', () => {
  it('should return explicit icon URL first when provided', () => {
    const candidates = getServiceIconCandidates(
      'https://chatgpt.com',
      'https://example.com/custom-icon.png'
    );

    expect(candidates[0]).toBe('https://example.com/custom-icon.png');
  });

  it('should include official qianwen icon before generic fallbacks', () => {
    const candidates = getServiceIconCandidates('https://www.qianwen.com');

    expect(candidates[0]).toContain('alicdn.com');
  });

  it('should include origin favicon and ddg favicon as fallbacks', () => {
    const candidates = getServiceIconCandidates('https://example.com');

    expect(candidates.some((c) => c.endsWith('/favicon.ico'))).toBe(true);
    expect(candidates.some((c) => c.includes('icons.duckduckgo.com'))).toBe(true);
  });

  it('should return empty array for invalid URLs', () => {
    const candidates = getServiceIconCandidates('not-a-valid-url');

    expect(candidates.length).toBe(0);
  });

  it('should extract hostname correctly from complex URLs', () => {
    const candidates = getServiceIconCandidates('https://chat.deepseek.com/coder?lang=en');

    expect(candidates.some((c) => c.includes('chat.deepseek.com'))).toBe(true);
  });

  it('should handle URLs with ports', () => {
    const candidates = getServiceIconCandidates('https://localhost:3000/chat');

    expect(candidates.some((c) => c.includes('localhost'))).toBe(true);
  });

  it('should not duplicate URLs when explicit matches fallback', () => {
    const iconUrl = 'https://chatgpt.com/favicon.ico';
    const candidates = getServiceIconCandidates('https://chatgpt.com', iconUrl);

    const uniqueCandidates = [...new Set(candidates)];
    expect(candidates.length).toBe(uniqueCandidates.length);
  });

  it('should prioritize explicit iconUrl over fallback', () => {
    const explicitUrl = 'https://cdn.example.com/icon.svg';
    const candidates = getServiceIconCandidates('https://example.com', explicitUrl);

    expect(candidates[0]).toBe(explicitUrl);
    expect(candidates).toContain('https://example.com/favicon.ico');
    expect(candidates.some((c) => c.includes('icons.duckduckgo.com'))).toBe(true);
  });

  it('should include first-party icon candidates before third-party fallback providers', () => {
    const candidates = getServiceIconCandidates(
      'https://dr.miromind.ai',
      'https://www.google.com/s2/favicons?domain=dr.miromind.ai&sz=64'
    );

    expect(candidates[0]).toBe('https://dr.miromind.ai/favicon.svg');
    expect(candidates).toContain('https://dr.miromind.ai/favicon.ico');
  });

  it('should include parent-domain fallback candidates for subdomain services', () => {
    const candidates = getServiceIconCandidates('https://chat.deepseek.com');

    expect(candidates).toContain('https://icons.duckduckgo.com/ip3/chat.deepseek.com.ico');
    expect(candidates).toContain('https://icons.duckduckgo.com/ip3/deepseek.com.ico');
  });

  it('should include google s2 fallback for both subdomain and parent domain', () => {
    const candidates = getServiceIconCandidates('https://chat.deepseek.com');

    expect(candidates).toContain('https://www.google.com/s2/favicons?domain=chat.deepseek.com&sz=64');
    expect(candidates).toContain('https://www.google.com/s2/favicons?domain=deepseek.com&sz=64');
  });

  it('should prefer first-party icons when explicit iconUrl is a ddg fallback URL', () => {
    const candidates = getServiceIconCandidates(
      'https://dr.miromind.ai',
      'https://icons.duckduckgo.com/ip3/dr.miromind.ai.ico'
    );

    expect(candidates[0]).toBe('https://dr.miromind.ai/favicon.svg');
    expect(candidates).toContain('https://icons.duckduckgo.com/ip3/dr.miromind.ai.ico');
  });

  it('should normalize service URLs by adding https scheme when missing', () => {
    expect(normalizeServiceUrl('example.com')).toBe('https://example.com/');
  });

  it('should find the first probeable icon candidate', async () => {
    MockImage.successfulUrls.clear();
    MockImage.successfulUrls.add('https://example.com/apple-touch-icon.png');

    const iconUrl = await findWorkingIconCandidate('https://example.com', undefined, {
      ImageCtor: MockImage as unknown as typeof Image,
      timeoutMs: 50,
    });

    expect(iconUrl).toBe('https://example.com/apple-touch-icon.png');
  });

  it('should return null when no icon candidate can be probed', async () => {
    MockImage.successfulUrls.clear();

    const iconUrl = await findWorkingIconCandidate('https://broken.example.com', undefined, {
      ImageCtor: MockImage as unknown as typeof Image,
      timeoutMs: 50,
    });

    expect(iconUrl).toBeNull();
  });
});
