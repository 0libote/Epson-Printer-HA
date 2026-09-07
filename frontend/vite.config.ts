import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";

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
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/scans": { target: "http://localhost:8080", changeOrigin: true },
      "/setup": { target: "http://localhost:8080", changeOrigin: true },
      "/print": { target: "http://localhost:8080", changeOrigin: true },
      "/scan": { target: "http://localhost:8080", changeOrigin: true },
      "/jobs": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
