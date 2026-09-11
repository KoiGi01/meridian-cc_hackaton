import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Resolve the workspace packages to source so the playground picks up edits
// without a rebuild, and can never render a stale dist.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  resolve: {
    alias: {
      '@pointto/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@pointto/react': fileURLToPath(new URL('../../packages/react/src/index.ts', import.meta.url)),
    },
  },
});
