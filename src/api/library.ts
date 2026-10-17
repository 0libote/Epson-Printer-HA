import type { Hono } from "hono";
import { ScanStorageError, type ScanReservation } from "../scanning/library.ts";
import { combineScans, CombineError } from "../scanning/combine.ts";

export function registerLibraryApi(
  app: Hono,
  deps: {
    auth: (c: any) => Response | null;
    csrf: (c: any, body: any) => boolean;
    readBody: (c: any) => Promise<any>;
    directory: () => string;
    outputName: (name: string, extension: string) => string;
    reserve: () => ScanReservation;
    lock: <T>(
      action: () => Promise<T>,
    ) => Promise<{ acquired: boolean; result?: T }>;
    invalidate: () => void;
  },
) {
  app.post("/api/scans/combine", async (c) => {
    const auth = deps.auth(c);
    if (auth) return auth;
    const body = await deps.readBody(c);
    if (!deps.csrf(c, body))
      return c.text("Invalid or missing CSRF token", 400);
    let output: string;
    try {
      output = deps.outputName(String(body.name || "Combined scan"), ".pdf");
    } catch {
      return c.json(
        { ok: false, error: "Choose a valid name for your PDF." },
        400,
      );
    }
    try {
      const result = await deps.lock(async () => {
        const reservation = deps.reserve();
        try {
          const result = await combineScans(
            deps.directory(),
            body.files,
            output,
          );
          reservation.commit(result.name);
          return result;
        } finally {
          reservation.release();
        }
      });
      if (!result.acquired)
        return c.json(
          {
            ok: false,
            error: "Another PDF is being created. Try again shortly.",
          },
          409,
        );
      deps.invalidate();
      return c.json({ ok: true, ...result.result });
    } catch (error) {
      if (error instanceof CombineError || error instanceof ScanStorageError)
        return c.json({ ok: false, error: error.message }, error.status);
      console.error("[scans] PDF assembly failed", error);
      return c.json(
        {
          ok: false,
          error:
            "Could not save the combined PDF. Check available storage and try again.",
        },
        503,
      );
    }
  });
}
