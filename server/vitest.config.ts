import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DB_PATH: ':memory:',
      STORAGE_DRIVER: 'local',
      WX_APPID: '',
      WX_SECRET: '',
      OSS_REGION: '',
      OSS_BUCKET: '',
      OSS_ACCESS_KEY_ID: '',
      OSS_ACCESS_KEY_SECRET: '',
      GH_ISSUES_TOKEN: '',
      GH_ISSUES_REPO: '',
      JWT_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
    },
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
})
