// =====================================================================================
//  PrivvaClub — Configuración de Vite + PWA
//
//  - @vitejs/plugin-react: React + Fast Refresh.
//  - vite-plugin-pwa (estrategia generateSW): Service Worker automático con
//    auto-actualización inmediata y precaché de los assets estáticos para soporte offline.
//
//  Dependencias:
//    npm i -D vite @vitejs/plugin-react vite-plugin-pwa
//    npm i react react-dom @supabase/supabase-js
// =====================================================================================

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Genera el SW automáticamente (Workbox) y lo actualiza apenas hay versión nueva.
      registerType: "autoUpdate",
      // Inyecta el registro del SW de forma automática (complementa el registro manual
      // de main.tsx vía 'virtual:pwa-register').
      injectRegister: "auto",

      // Assets sueltos a incluir además del build (favicon, etc.).
      includeAssets: ["favicon.ico", "robots.txt", "apple-touch-icon.png"],

      // §2 — Web App Manifest.
      manifest: {
        name: "PrivvaClub",
        short_name: "PrivvaClub",
        description: "Directorio premium de entretenimiento y acompañamiento.",
        theme_color: "#0B0B0F", // color oscuro principal de la app
        background_color: "#0B0B0F", // splash screen
        display: "standalone", // oculta la barra del navegador
        orientation: "portrait", // fijo vertical
        start_url: "/",
        scope: "/",
        lang: "es-CO",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },

      // §3 — Workbox: precaché de assets estáticos para carga instantánea offline.
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },

      // SW de desarrollo para poder probar la PWA con `vite dev`.
      devOptions: {
        enabled: false,
        type: "module",
      },
    }),
  ],
});
