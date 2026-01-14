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

  it('should include Google S2 favicon as fallback', () => {
    const candidates = getServiceIconCandidates('https://chatgpt.com');

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]).toContain('google.com/s2/favicons');
  });

  it('should include hostname in fallback URL', () => {
    const candidates = getServiceIconCandidates('https://chatgpt.com');

    expect(candidates[0]).toContain('chatgpt.com');
  });

  it('should not duplicate URLs when explicit matches fallback', () => {
    const iconUrl = 'https://www.google.com/s2/favicons?domain=chatgpt.com&sz=64';
    const candidates = getServiceIconCandidates('https://chatgpt.com', iconUrl);

    const uniqueCandidates = [...new Set(candidates)];
    expect(candidates.length).toBe(uniqueCandidates.length);
  });

  it('should return empty array for invalid URLs', () => {
    const candidates = getServiceIconCandidates('not-a-valid-url');

    expect(candidates.length).toBe(0);
  });

  it('should extract hostname correctly from complex URLs', () => {
    const candidates = getServiceIconCandidates('https://chat.deepseek.com/coder?lang=en');

    expect(candidates[0]).toContain('chat.deepseek.com');
  });

  it('should handle URLs with ports', () => {
    const candidates = getServiceIconCandidates('https://localhost:3000/chat');

    expect(candidates[0]).toContain('localhost');
  });

  it('should prioritize explicit iconUrl over fallback', () => {
    const explicitUrl = 'https://cdn.example.com/icon.svg';
    const candidates = getServiceIconCandidates('https://example.com', explicitUrl);

    expect(candidates[0]).toBe(explicitUrl);
    expect(candidates.length).toBe(2);
  });
});
