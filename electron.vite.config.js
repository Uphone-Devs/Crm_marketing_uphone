import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** Plugin que copia src/main/* → out/main/ (excepto index.js) después del build */
function copyMainModulesPlugin() {
  return {
    name: 'copy-main-modules',
    closeBundle() {
      const SRC = join(__dirname, 'src', 'main')
      const DST = join(__dirname, 'out', 'main')
      copyDir(SRC, DST, true)
      console.log('\x1b[32m[copy-main-modules] Módulos locales copiados a out/main/\x1b[0m')
    }
  }
}

function copyDir(src, dst, skipIndex = false) {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true })
  const items = readdirSync(src, { withFileTypes: true })
  for (const item of items) {
    if (skipIndex && item.name === 'index.js') continue
    const s = join(src, item.name)
    const d = join(dst, item.name)
    if (item.isDirectory()) {
      copyDir(s, d, false)
    } else {
      copyFileSync(s, d)
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyMainModulesPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.js')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/preload.js')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    base: './',
    server: { port: 5173 },
    build: {
      rollupOptions: {
        input: {
          asesor: resolve(__dirname, 'src/renderer/asesor/index.html'),
          supervisor: resolve(__dirname, 'src/renderer/supervisor/index.html'),
          login: resolve(__dirname, 'src/renderer/login/index.html'),
          admin: resolve(__dirname, 'src/renderer/admin/index.html')
        }
      }
    },
    plugins: [react()]
  }
})
