import { describe, expect, it, vi } from 'vitest';
import { mintToken, TokenError } from './token.ts';

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe('mintToken', () => {
  it('calls the voice-agent token endpoint with a Bearer key', async () => {
    const f = fakeFetch(200, { token: 'tok_123' });
    await mintToken(f, 'sk_test', { expiresInSeconds: 300 });

    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://agents.assemblyai.com/v1/token?expires_in_seconds=300');
    // Bearer is required on the Voice Agent API specifically; other AssemblyAI
    // products take the raw key. Verified against live docs 2026-09-11.
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test');
  });

  it('returns the token and an absolute expiry', async () => {
    const before = Date.now();
    const out = await mintToken(fakeFetch(200, { token: 'tok_123' }), 'sk', { expiresInSeconds: 60 });
    expect(out.token).toBe('tok_123');
    expect(out.expiresAt).toBeGreaterThanOrEqual(before + 60_000 - 5);
  });

  it('caps the session length when asked', async () => {
    const f = fakeFetch(200, { token: 't' });
    await mintToken(f, 'sk', { expiresInSeconds: 60, maxSessionDurationSeconds: 900 });
    const [url] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('max_session_duration_seconds=900');
  });

  it('surfaces a rejected key as a TokenError carrying the status', async () => {
    await expect(mintToken(fakeFetch(401, { error: 'unauthorized' }), 'bad', {})).rejects.toBeInstanceOf(
      TokenError,
    );
    await expect(mintToken(fakeFetch(401, { error: 'unauthorized' }), 'bad', {})).rejects.toMatchObject({
      status: 401,
    });
  });

  it('refuses to mint with an empty key rather than sending a useless request', async () => {
    const f = fakeFetch(200, { token: 't' });
    await expect(mintToken(f, '', {})).rejects.toThrow(/ASSEMBLYAI_API_KEY/);
    expect(f).not.toHaveBeenCalled();
  });
});
