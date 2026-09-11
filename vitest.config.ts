import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['packages/react/**', 'jsdom']],
    include: ['packages/**/*.test.{ts,tsx}'],
  },
});
