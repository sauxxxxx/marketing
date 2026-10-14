/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    // The PDF renderer (~1.2 MB) is loaded lazily, only when someone exports.
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules\/(@react-pdf|pdfkit|fontkit|yoga-layout|restructure|linebreak|unicode-|brotli|png-js|jay-peg|hyphen|emoji-regex|bidi-js|crypto-js|@swc)/.test(id)) return undefined
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) return 'react'
          if (/node_modules\/@supabase\//.test(id)) return 'supabase'
          if (/node_modules\/(zod|react-hook-form|@hookform)\//.test(id)) return 'forms'
          if (/node_modules\/(@radix-ui|radix-ui|@floating-ui|cmdk|sonner|lucide-react|tailwind-merge|clsx|class-variance-authority)\//.test(id)) return 'ui'
          if (/node_modules\/(date-fns|@date-fns)\//.test(id)) return 'dates'
          if (/node_modules\/@tanstack\//.test(id)) return 'query'
          if (/node_modules\/@dnd-kit\//.test(id)) return 'dnd'
          return undefined
        },
      },
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./tests/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          environment: 'node',
          globals: true,
          include: ['tests/db/**/*.test.ts'],
          // Each file boots an in-process PostgreSQL (WASM); run them one at a time.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
})
