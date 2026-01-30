import { describe, it, expect } from 'vitest';
import { getServiceIconCandidates } from '@/lib/icon';

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
    expect(candidates.length).toBe(3);
  });
});
