import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget =
    env.VITE_PROXY_TARGET ||
    'https://onsitexfeedhandler-production.up.railway.app'

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', 'localhost', '127.0.0.1'],
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api/, '')
        }
      }
    }
  }
})
