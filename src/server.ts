import app from "./app.ts";
import { main as historyMain } from "./history_worker.ts";

const port = parseInt(process.env.WEB_PORT || "8080", 10);

console.log(`[server] Starting Epson Hub on port ${port} with Bun ${Bun.version}`);

// Start history worker in background (non-blocking)
historyMain().catch((e) => console.error("[history] worker failed", e));

if (import.meta.main) {
  Bun.serve({
    port,
    hostname: "0.0.0.0",
    idleTimeout: 255,
    fetch: app.fetch,
    development: false,
  });
  console.log(`[server] Listening on http://0.0.0.0:${port}`);
}

// Export for programmatic use, but avoid Bun auto-serve (which triggers on default export with fetch)
export { app };
