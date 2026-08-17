import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
    watch: {
      // Windows 上忽略编辑器临时文件，避免 EBUSY 监视崩溃
      ignored: ['**/.*.tmpdir/**', '**/*.tmp'],
    },
  },
})
