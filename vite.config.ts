import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon-maxpos.png', 'icon-maxpos-192.png', 'icon-maxpos-maskable.png'],
        manifest: {
          name: 'MaxPOS ERP/PDV',
          short_name: 'MaxPOS',
          description: 'Sistema de Gestão e Ponto de Venda Moderno',
          theme_color: '#121212',
          background_color: '#121212',
          display: 'standalone',
          orientation: 'portrait',
          icons: [
            {
              src: 'icon-maxpos-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: 'icon-maxpos.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              // Variante com safe zone: o logo ocupa 60% do quadro, deixando
              // ~20% de margem de cada lado. O icone normal so tinha 3,7% e o
              // Android recortava dentro do wordmark ao aplicar a mascara.
              src: 'icon-maxpos-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ]
        }
      })
    ],
    // VITE_* vars are automatically exposed to the client via import.meta.env
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-pdf': ['jspdf', 'jspdf-autotable'],
            'vendor-scanner': ['html5-qrcode'],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
