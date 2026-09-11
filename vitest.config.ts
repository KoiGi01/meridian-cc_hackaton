import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests resolve workspace packages to their source, not their build output.
// Without this, every red-green cycle silently runs against the last `pnpm
// build`, and a passing suite can be testing code that no longer exists.
export default defineConfig({
  resolve: {
    alias: {
      'pointto-core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    environmentMatchGlobs: [['packages/react/**', 'jsdom']],
    include: ['packages/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
});
