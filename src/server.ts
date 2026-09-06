import app from "./app.ts";
import { main as historyMain } from "./history_worker.ts";

const port = Number.parseInt(process.env.WEB_PORT || "8080", 10);

console.log(`[server] Starting Epson Hub on port ${port} with Bun ${Bun.version}`);

if (import.meta.main) {
  // Start history worker in background only when run as main entrypoint.
  // When deployed via supervisord, the history worker runs as a separate program
  // (config/supervisord.conf [program:history]), so avoid duplicate workers
  // when this module is imported for testing.
  if (!process.env.SUPERVISORD_HISTORY_MANAGED) {
    historyMain().catch((e) => console.error("[history] worker failed", e));
  }

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
