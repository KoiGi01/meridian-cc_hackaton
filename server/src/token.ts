/**
 * Exchanges the API key for a single-use, short-lived token the browser can
 * hold. This is the only place the key is ever used.
 *
 * Verified against live docs 2026-09-11: the Voice Agent API is the one
 * AssemblyAI product that REQUIRES the `Bearer` prefix.
 */

const TOKEN_URL = 'https://agents.assemblyai.com/v1/token';

export class TokenError extends Error {
  // Declared explicitly: Node's strip-only TS mode rejects parameter properties.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TokenError';
    this.status = status;
  }
}

export interface MintOptions {
  /** 1–600. How long the browser has to redeem the token. */
  expiresInSeconds?: number;
  /** 60–10800. Caps the resulting session. */
  maxSessionDurationSeconds?: number;
}

export async function mintToken(
  fetchImpl: typeof fetch,
  apiKey: string,
  opts: MintOptions,
): Promise<{ token: string; expiresAt: number }> {
  if (!apiKey) {
    throw new TokenError('ASSEMBLYAI_API_KEY is not set; the server cannot mint tokens', 500);
  }

  const expiresIn = opts.expiresInSeconds ?? 300;
  const url = new URL(TOKEN_URL);
  url.searchParams.set('expires_in_seconds', String(expiresIn));
  if (opts.maxSessionDurationSeconds !== undefined) {
    url.searchParams.set('max_session_duration_seconds', String(opts.maxSessionDurationSeconds));
  }

  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new TokenError(`AssemblyAI token endpoint returned ${res.status}: ${body.slice(0, 200)}`, res.status);
  }

  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new TokenError('AssemblyAI token endpoint returned no token', 502);

  return { token: data.token, expiresAt: Date.now() + expiresIn * 1000 };
}
