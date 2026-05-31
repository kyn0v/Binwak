import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Unit tests do not need real Vue reactivity here,
      // but ref() and computed() still need Vue runtime-core.
      vue: 'vue',
    },
  },
})
