import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: true },
  build: {
    rollupOptions: {
      output: {
        // Kütüphaneler ayrı paketlerde: uygulama kodu değiştiğinde
        // kullanıcının tarayıcısı bunları yeniden indirmez.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          return id.includes('@supabase') ? 'supabase' : 'vendor'
        },
      },
    },
  },
})
