import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { createPricingProxy } from './server/pricing-proxy.mjs'

export default defineConfig({
  plugins: [vue(), tailwindcss(), {
    name: 'pricing-proxy',
    configureServer(server) {
      server.middlewares.use(createPricingProxy())
    }
  }]
})
