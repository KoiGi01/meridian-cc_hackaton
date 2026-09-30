/**
 * The deployed twin of server/'s POST /api/voice/token (BUILD-SPEC 5.8), as a
 * Vercel function. Same-origin with the demo, so no CORS: a browser call from
 * another site carries a foreign Origin and is refused. Self-contained because
 * Vercel's bundler would not follow server/'s `.ts` import.
 */

const TOKEN_URL = 'https://agents.assemblyai.com/v1/token';
const EXPIRES_IN = 300;
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
  let sameHost = false;
  try {
    sameHost = !!origin && new URL(origin).host === host;
  } catch {
    sameHost = false;
  }
  if (!origin || (!sameHost && !allowed.includes(origin))) {
    return Response.json({ error: 'origin not allowed' }, { status: 403 });
  }

  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) return Response.json({ error: 'rate limited' }, { status: 429 });

  const apiKey = process.env.ASSEMBLYAI_API_KEY ?? '';
  if (!apiKey) return Response.json({ error: 'server has no API key' }, { status: 500 });

  const url = new URL(TOKEN_URL);
  url.searchParams.set('expires_in_seconds', String(EXPIRES_IN));
  url.searchParams.set('max_session_duration_seconds', '1800');
  // The Voice Agent API is the one AssemblyAI product that requires `Bearer`.
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    console.error('token mint failed:', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return Response.json({ error: 'could not mint token' }, { status: 502 });
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) return Response.json({ error: 'could not mint token' }, { status: 502 });
  return Response.json({ token: data.token, expiresAt: Date.now() + EXPIRES_IN * 1000 });
}
