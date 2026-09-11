import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === 'dist') return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx|js|json)$/.test(e.name) ? [p] : [];
  });
}

/**
 * The API key lives in server/ and .env only. Nothing under packages/ may
 * reference it, because everything under packages/ ships to the browser.
 * (BUILD-SPEC 5.6: "Never ship the API key to the client.")
 */
describe('published packages never touch the API key', () => {
  it('no file under packages/ mentions ASSEMBLYAI_API_KEY or a Bearer header', () => {
    const root = resolve(import.meta.dirname, '../..');
    const offenders = walk(root)
      .filter((f) => !f.endsWith('no-secrets.test.ts'))
      .filter((f) => /ASSEMBLYAI_API_KEY|Bearer /.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
