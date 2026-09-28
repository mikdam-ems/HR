import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
    // Each test file builds a fresh in-memory database and runs every migration first.
    hookTimeout: 30000,
  },
});
