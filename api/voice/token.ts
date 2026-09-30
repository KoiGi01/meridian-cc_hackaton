import { mintToken, TokenError } from '../../server/src/token.ts';

/**
 * The deployed twin of server/'s POST /api/voice/token (BUILD-SPEC 5.8), as a
 * Vercel function. Same-origin with the demo, so no CORS: a browser call from
 * another site carries a foreign Origin and is refused.
 */

const WINDOW_MS = 60_000;
const LIMIT = 30;
// Best effort: one map per warm instance.
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT;
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || (new URL(origin).host !== host && !allowed.includes(origin))) {
    return Response.json({ error: 'origin not allowed' }, { status: 403 });
  }

  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) return Response.json({ error: 'rate limited' }, { status: 429 });

  try {
    const t = await mintToken(fetch, process.env.ASSEMBLYAI_API_KEY ?? '', {
      expiresInSeconds: 300,
      maxSessionDurationSeconds: 1800,
    });
    return Response.json(t);
  } catch (e) {
    const status = e instanceof TokenError ? e.status : 500;
    console.error('token:', e instanceof Error ? e.message : e);
    return Response.json({ error: 'could not mint token' }, { status: status >= 500 ? 502 : status });
  }
}
