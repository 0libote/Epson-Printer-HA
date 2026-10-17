import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";

const apiTarget = `http://127.0.0.1:${process.env.WEB_PORT || "8080"}`;

export default defineConfig({
  root: "frontend",
  plugins: [
    stylex.vite({
      useCSSLayers: true,
      importSources: ["@stylexjs/stylex", "@stylexjs/stylex/lib/stylex"],
      unstable_moduleResolution: { type: "commonJS" },
    }),
    react(),
  ],
  build: {
    outDir: "../public",
    emptyOutDir: true,
    // keep friendly names for debugging but hashed in prod via vite default
    manifest: false,
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vendor", test: /node_modules\/(react|react-dom|scheduler)\// },
            { name: "query", test: /node_modules\/@tanstack\// },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/scans": { target: apiTarget, changeOrigin: true },
      "/client-settings": { target: apiTarget, changeOrigin: true },
      "/setup": { target: apiTarget, changeOrigin: true },
      "/print": { target: apiTarget, changeOrigin: true },
      "/scan": { target: apiTarget, changeOrigin: true },
      "/jobs": { target: apiTarget, changeOrigin: true },
    },
  },
});
