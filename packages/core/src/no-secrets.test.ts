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
 * API keys live in server/, the CLI, and .env only. The two packages that
 * ship to the browser — pointto-core and pointto — must never reference one.
 * (BUILD-SPEC 5.6: "Never ship the API key to the client.") pointto-cli is
 * a Node tool run on the developer's machine, so it is out of scope.
 */
describe('browser packages never touch an API key', () => {
  it('no file under packages/core or packages/react mentions an API key env var or a Bearer header', () => {
    const root = resolve(import.meta.dirname, '../..');
    const offenders = [...walk(resolve(root, 'core')), ...walk(resolve(root, 'react'))]
      .filter((f) => !f.endsWith('no-secrets.test.ts'))
      .filter((f) => /ASSEMBLYAI_API_KEY|GEMINI_API_KEY|POINTTO_LLM_API_KEY|Bearer /.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
