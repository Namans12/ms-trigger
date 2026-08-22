import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    // Fail loudly instead of silently drifting to 8081/8082/... on a stale
    // instance — that drift is what makes "which URL is it on now?" happen.
    strictPort: true,
    // Dev-only — `server.proxy` has no effect on `vite build`. Forwards /api
    // to scripts/dev-api-server.mjs, which runs the real api/**.ts handlers
    // against the real database (see `npm run dev:full`).
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.DEV_API_PORT || 3001}`,
        changeOrigin: true,
      },
    },
  },
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      // We hand-wrote public/manifest.webmanifest and link it from index.html
      // ourselves, so let the plugin only handle the service worker.
      manifest: false,
      injectRegister: "auto",
      registerType: "autoUpdate",
      workbox: {
        // /api/watchlist is private, mutable, per-owner data — never cache it,
        // even network-first, to avoid leaking stale state across the auth boundary.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Precomputed digest + future calendar/tmdb reads: try the network
            // first (data changes on a schedule), fall back to cache if offline.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/releases") || url.pathname.startsWith("/api/calendar"),
            handler: "NetworkFirst",
            options: {
              cacheName: "spotlight-api-data",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            // Private, mutable, per-owner — never cached.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/watchlist") || url.pathname.startsWith("/api/auth"),
            handler: "NetworkOnly",
          },
          {
            // TMDB posters/backdrops: never cached (cross-origin, storage cost
            // isn't worth it for a personal project) — matches the old sw.js behavior.
            urlPattern: ({ url }) => url.origin === "https://image.tmdb.org",
            handler: "NetworkOnly",
          },
          {
            // Our own static images — the brand mark (on every page), the intro
            // fixture, the PWA icons, the favicon. These were neither precached
            // (the precache globs only pick up js/css/html) nor runtime-cached,
            // so every single load refetched them. StaleWhileRevalidate rather
            // than CacheFirst because these filenames are not content-hashed:
            // it serves instantly from cache but still picks up a replaced
            // asset on the next load instead of pinning it for weeks.
            urlPattern: ({ url, request }) =>
              url.origin === self.location.origin && request.destination === "image",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "spotlight-static-images",
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Routes were already split, but every shared dependency landed in the
        // single entry chunk, which has to parse before any route can render.
        // Splitting the framework out also means a deploy that only touches app
        // code leaves these hashes untouched, so returning users keep them from
        // cache instead of re-downloading React on every release.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});
