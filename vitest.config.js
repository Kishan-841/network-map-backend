import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Seeds fixed-id test users so requireAuth's per-request user lookup
    // resolves the synthetic tokens the route tests sign.
    globalSetup: ['./tests/setup/seed-test-users.js'],
  },
})
