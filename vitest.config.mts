import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // data-driven suites solve well over a thousand shapes
    testTimeout: 60_000,
  },
  resolve: {
    alias: { '@': new URL('./src/', import.meta.url).pathname },
  },
})
