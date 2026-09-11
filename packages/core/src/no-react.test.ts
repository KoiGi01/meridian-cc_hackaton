import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')
        ? [join(dir, e.name)]
        : [],
  );
}

describe('@pointto/core framework independence', () => {
  it('never imports react', () => {
    const offenders = sourceFiles(import.meta.dirname).filter((f) =>
      /from ['"]react/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
