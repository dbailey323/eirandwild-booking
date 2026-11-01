import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  // Each test starts its own in-memory Postgres, which can take a few seconds when files run in parallel
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
