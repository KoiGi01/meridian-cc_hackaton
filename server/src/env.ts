import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reads the repo-root `.env` without a dependency. Real environment variables
 * win, so deployment platforms can inject secrets the normal way.
 */
function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, '../../.env');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

export const env = {
  apiKey: process.env.ASSEMBLYAI_API_KEY ?? '',
  port: Number(process.env.PORT ?? 8787),
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS ??
    'http://localhost:5173,http://localhost:5190,http://127.0.0.1:5173,http://127.0.0.1:5190'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
