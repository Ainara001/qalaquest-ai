import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "./package.json";

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: { host: true, port: 5173 },
  // MapLibre (~800 kB) in its own chunk: app updates do not invalidate the cached map library
  build: { rollupOptions: { output: { manualChunks: { maplibre: ["maplibre-gl"] } } }, chunkSizeWarningLimit: 900 },
});
