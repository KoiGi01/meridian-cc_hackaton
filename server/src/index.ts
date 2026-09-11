import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { env } from './env.ts';
import { recordEvents } from './events.ts';
import { mintToken, TokenError } from './token.ts';

/**
 * Two endpoints and nothing else (BUILD-SPEC 5.8). No accounts, no database.
 *
 *   POST /api/voice/token  -> { token, expiresAt }
 *   POST /api/events       -> 204
 *   GET  /health           -> ok
 */

// Sliding-window rate limit per IP. In-memory is fine for one process.
const WINDOW_MS = 60_000;
const LIMIT = 30;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT;
}

function originAllowed(origin: string | undefined): boolean {
  return !!origin && env.allowedOrigins.includes(origin);
}

function cors(res: ServerResponse, origin: string | undefined): void {
  if (originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin!);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const ip = req.socket.remoteAddress ?? 'unknown';
  const path = (req.url ?? '/').split('?')[0];

  cors(res, origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method !== 'POST') {
    json(res, 405, { error: 'method not allowed' });
    return;
  }

  // Browser calls carry an Origin; anything else is not our widget.
  if (!originAllowed(origin)) {
    json(res, 403, { error: 'origin not allowed' });
    return;
  }

  if (rateLimited(ip)) {
    json(res, 429, { error: 'too many requests' });
    return;
  }

  try {
    if (path === '/api/voice/token') {
      const out = await mintToken(fetch, env.apiKey, {
        expiresInSeconds: 300,
        maxSessionDurationSeconds: 1800,
      });
      json(res, 200, out);
      return;
    }

    if (path === '/api/events') {
      await recordEvents(await readJson(req));
      res.writeHead(204);
      res.end();
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (e instanceof TokenError) {
      // Do not leak the upstream body to the browser; log it here.
      console.error('[pointto-server] token mint failed:', e.message);
      json(res, e.status === 401 || e.status === 403 ? 502 : 500, { error: 'could not mint token' });
      return;
    }
    console.error('[pointto-server]', e);
    json(res, 500, { error: 'internal error' });
  }
});

server.listen(env.port, () => {
  console.log(`[pointto-server] listening on http://localhost:${env.port}`);
  console.log(`[pointto-server] allowed origins: ${env.allowedOrigins.join(', ')}`);
  if (!env.apiKey) console.warn('[pointto-server] WARNING: ASSEMBLYAI_API_KEY is not set');
});
