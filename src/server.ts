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

  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    idleTimeout: 255,
    fetch: app.fetch,
    development: false,
  });
  console.log(`[server] Listening on http://0.0.0.0:${port}`);

  // Graceful shutdown: supervisord/docker send SIGTERM. Stop accepting new
  // connections immediately, then exit — in-flight /print and /api/scan jobs
  // finish their current subprocess await (or hit their own timeouts) instead
  // of being SIGKILLed mid-upload and leaking workdirs/locks.
  let _shuttingDown = false;
  const shutdown = (sig: string) => {
    if (_shuttingDown) return;
    _shuttingDown = true;
    console.log(`[server] Received ${sig}, draining…`);
    try { server.stop(true); } catch {}
    // Give in-flight requests a few seconds, then force out so the
    // container doesn't hang supervisord's stopwait.
    setTimeout(() => {
      console.log("[server] Shutdown complete");
      process.exit(0);
    }, 5000).unref?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Export for programmatic use, but avoid Bun auto-serve (which triggers on default export with fetch)
export { app };
