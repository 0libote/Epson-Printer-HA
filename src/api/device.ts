import type { Hono } from "hono";
import { arch } from "node:os";
import { runCommand } from "../system/commands.ts";
import { epsonUtilityIntegration } from "../printer/epson-utility.ts";
import type { createPrinterDeviceService } from "../printer/manager.ts";
import type { createScannerManager } from "../scanning/manager.ts";
import { version } from "../../package.json";

export function registerDeviceApi(app: Hono, deps: {
 auth: (c: any) => Response | null;
 ip: () => string; queue: () => string;
 scanner: ReturnType<typeof createScannerManager>;
 printer: ReturnType<typeof createPrinterDeviceService>;
 csrf: (c: any, body: any) => boolean;
 readBody: (c: any) => Promise<any>;
}) {
 let versions: Promise<Record<string, string | null>> | null = null;
 let versionsUntil = 0;
 const getVersions = () => {
  if (!versions || versionsUntil < Date.now()) {
   versionsUntil = Date.now() + 300_000;
   versions = Promise.all([
    runCommand(["cups-config", "--version"], 3000),
    runCommand(["dpkg-query", "-W", "-f=${Version}", "printer-driver-escpr"], 3000),
   ]).then(([cups, driver]) => ({ cups: cups.ok ? cups.stdout.slice(0, 80) : null, escpr: driver.ok ? driver.stdout.slice(0, 80) : null }));
  }
  return versions;
 };
 app.get("/api/capabilities", async c => {
  const auth = deps.auth(c); if (auth) return auth;
  const [scanner, printer] = await Promise.all([deps.scanner.capabilities(deps.ip()), deps.printer.capabilities(deps.ip())]);
  return c.json({ printing: { backend: "cups", name: "CUPS + Epson ESC/P-R" }, scanner, printer });
 });
 app.get("/api/printer/status", async c => {
  const auth = deps.auth(c); if (auth) return auth;
  return c.json(await deps.printer.status(deps.ip(), deps.queue()));
 });
 app.get("/api/scanner/status", async c => {
  const auth = deps.auth(c); if (auth) return auth;
  const summary = await deps.scanner.capabilities(deps.ip());
  if (summary.selected === "epsonscan2") {
   try { return c.json({ ...summary, ...await deps.scanner.epson.status(deps.ip()) }); }
   catch { return c.json({ ...summary, ok: false, state: "unknown", error: "Scanner sidecar unavailable" }); }
  }
  return c.json({ ...summary, ok: !!summary.selected, state: summary.selected ? "unknown" : "offline" });
 });
 app.post("/api/scanner/rediscover", async c => {
  const auth = deps.auth(c); if (auth) return auth;
  const body = await deps.readBody(c);
  if (!deps.csrf(c, body)) return c.text("Invalid or missing CSRF token", 400);
  return c.json(await deps.scanner.capabilities(deps.ip(), true));
 });
 app.post("/api/printer/maintenance/:action", async c => {
  const auth = deps.auth(c); if (auth) return auth;
  const body = await deps.readBody(c);
  if (!deps.csrf(c, body)) return c.text("Invalid or missing CSRF token", 400);
  const action = c.req.param("action");
  if (action !== "nozzle-check" && action !== "head-clean") return c.json({ ok: false, error: "Invalid maintenance action" }, 400);
  if (!deps.ip()) return c.json({ ok: false, error: "Set up the printer first" }, 400);
  const result = await deps.printer.maintenance(deps.ip(), deps.queue(), action);
  return c.json(result, result.status as 200 | 400 | 409 | 501 | 502);
 });
 app.get("/api/diagnostics", async c => {
  const auth = deps.auth(c); if (auth) return auth;
  const [scanner, printer, installedVersions, utility, epson] = await Promise.all([
   deps.scanner.capabilities(deps.ip()), deps.printer.capabilities(deps.ip()), getVersions(),
   epsonUtilityIntegration.installation(), deps.scanner.epson.health().catch(() => null),
  ]);
  return c.json({ version, architecture: arch(), printerAddress: deps.ip(), printing: { backend: "cups", ...installedVersions },
   scanner, epsonScan2: { available: !!epson, version: epson?.version ?? null, profilesValidated: !!epson?.capabilities.verified && epson.printerAddress === deps.ip(),
    lastError: epson?.lastError ?? deps.scanner.epson.lastError }, printer, epsonUtility: utility });
 });
}
