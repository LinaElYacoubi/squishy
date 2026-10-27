import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build can be served from any folder on the installation machine.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
