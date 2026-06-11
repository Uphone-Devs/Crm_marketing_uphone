import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    // Entorno Node (no browser) — la app es Electron/Express
    environment: 'node',

    // Globals: describe, it, expect sin imports
    globals: true,

    // Archivos de test
    include: ['tests/**/*.test.js'],

    // Excluir node_modules y directorios masivos
    exclude: [
      'node_modules/**',
      'dist/**',
      'out/**',
      '.adal/**', '.agents/**', '.antigravity/**', '.augment/**',
      '.bob/**', '.claude/**', '.codebuddy/**', '.commandcode/**',
      '.continue/**', '.cortex/**', '.crush/**', '.factory/**',
      '.goose/**', '.iflow/**', '.junie/**', '.kilocode/**',
      '.kiro/**', '.kode/**', '.mcpjam/**', '.mux/**',
      '.neovate/**', '.openhands/**', '.pi/**', '.pochi/**',
      '.qoder/**', '.qwen/**', '.roo/**', '.trae/**',
      '.vibe/**', '.windsurf/**', '.zencoder/**',
      'backend/node_modules/**', 'scrcpy-win64-v3.1/**',
      'resources/**', 'scratch/**', 'build/**',
    ],

    // Setup global antes de cada suite
    setupFiles: ['./tests/setup.js'],

    // Timeout para tests de integración
    testTimeout: 10000,

    // Pool for better isolation
    pool: 'forks',

    // Resolver alias para imports
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },

    // Coverage config
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.js'],
      exclude: [
        'src/main/preload.js',
        'src/main/windowManager.js',
        'node_modules/**',
        'tests/**',
      ],
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 50,
        lines: 50,
      }
    }
  },
})
