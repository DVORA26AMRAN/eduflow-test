/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    // Evidence: full-suite failures were pure 5s vitest timeouts while the same
    // files passed in isolation. Default worker parallelism starved jsdom on
    // Windows (environment setup alone exceeded several seconds per file).
    maxWorkers: 2,
    testTimeout: 10_000,
  },
})
