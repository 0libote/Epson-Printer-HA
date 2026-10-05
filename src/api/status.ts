import { createStatusSnapshot } from "../system/status-snapshot.ts";
import { join } from "node:path";
import { buildInfo } from "../system/build-info.ts";
import type { Hono } from "hono";
import { cachedPrinterReachable, cachedCupsPrinterStatus, scannerStatus, cachedListJobs, localIPv4s, printerNetworkHint, runCommand } from "../core.ts";
import { listPrintHistory } from "../history.ts";
import type { InkStatus } from "../printer/ink-types.ts";
import type { createPrinterDeviceService } from "../printer/manager.ts";
export function registerStatusApi(app: Hono, deps: {
 requireAuth: (c: any) => Response | null;
 currentPrinterIp: () => string; currentPrinterName: () => string; currentDisplayName: () => string;
 clientSetup: (name: string, host: string) => any; networkSharingEnabledSync: () => boolean;
 recentScans: (limit: number) => Array<{ name: string; path: string }>;
 printerDeviceService: ReturnType<typeof createPrinterDeviceService>;
 recovery?: () => unknown;
 scannerBusy?: () => boolean;
 dataDir?: () => string;
 csrf: (c: any, body: any) => boolean;
 readBody: (c: any) => Promise<any>;
 limits: () => { upload: number; scans: number };
}) {
 const { requireAuth, currentPrinterIp, currentPrinterName, currentDisplayName, clientSetup, networkSharingEnabledSync, recentScans, printerDeviceService, limits } = deps;
// One sampler for all clients. A scanner probe never holds up queue or reachability updates.
 const emptyInk = (): InkStatus => ({ ok: false, source: "none", cartridges: [], updated_at: "", message: "Checking printer supplies in the background…" });
 const snapshot = createStatusSnapshot({
  ttlMs: { ink: 30_000, capabilities: 60_000, printer: 5000, device: 5000, queue: 5000, reachable: 10_000 },
  validate: (name, value: any) => {
   if (name === "queue") return Array.isArray(value) && value.every(job => ["id", "owner", "size", "raw"].every(key => typeof job?.[key] === "string"));
   if (name === "scanner" && value?.capabilities?.verified) return ["modes", "sources", "formats"].every(key => Array.isArray(value.capabilities[key]) && value.capabilities[key].every((v: unknown) => typeof v === "string")) && Array.isArray(value.capabilities.resolutions) && value.capabilities.resolutions.every((v: unknown) => typeof v === "number") && (value.capabilities.combinations === undefined || (Array.isArray(value.capabilities.combinations) && value.capabilities.combinations.every((v: any) => typeof v?.dpi === "number" && typeof v?.mode === "string")));
   if (name === "ink") return Array.isArray(value?.cartridges) && value.cartridges.every((c: any) => typeof c?.key === "string" && typeof c.name === "string" && typeof c.color === "string" && typeof c.state === "string" && typeof c.detail === "string" && (c.level === null || (typeof c.level === "number" && c.level >= 0 && c.level <= 100)));
   return true;
  },
  key: () => JSON.stringify([currentPrinterIp(), currentPrinterName(), deps.dataDir?.()]),
  path: deps.dataDir ? () => join(deps.dataDir!(), "status-cache.json") : undefined,
  fallback: () => ({ ink: emptyInk(), reachable: false,
   printer: { ok: false, state: "unknown", detail: "Checking print queue…" },
   scanner: { ok: false, state: "unknown", detail: "Checking scanner in the background…", backend: null, device: null, open_source: false } as Awaited<ReturnType<typeof scannerStatus>>,
   queue: [] as Awaited<ReturnType<typeof cachedListJobs>>,
   device: { state: "unknown" as string, backend: "standard", rawState: "unknown", warnings: [] as string[] },
   capabilities: { backend: "standard", capabilities: { inkLevels: true, pageCount: false, nozzleCheck: false, headCleaning: false }, maintenance: { state: "unsupported", action: null as string | null } },
  }),
  loaders: {
   ink: async (): Promise<InkStatus> => {
    if (!currentPrinterIp()) return emptyInk();
    if (!await cachedPrinterReachable(currentPrinterIp())) {
     if (snapshot.read().values.ink.cartridges.some(c => c.level !== null)) throw new Error("Printer offline");
     return { ...emptyInk(), updated_at: new Date().toISOString(), message: "Supplies will update when the printer reconnects." };
    }
    const ink = await printerDeviceService.ink(currentPrinterIp());
    if (!ink.ok && snapshot.read().values.ink.cartridges.some(c => c.level !== null)) throw new Error("Supplies check unavailable");
    return ink;
   },
   reachable: () => currentPrinterIp() ? cachedPrinterReachable(currentPrinterIp()) : Promise.resolve(false),
   printer: () => currentPrinterIp() ? cachedCupsPrinterStatus(currentPrinterName()) : Promise.resolve({ ok: false, state: "setup_required", detail: "" }),
   scanner: async (): Promise<Awaited<ReturnType<typeof scannerStatus>>> => {
    if (deps.scannerBusy?.()) return { ...snapshot.read().values.scanner, ok: true, state: "scanning", detail: "A scan is in progress" };
    return currentPrinterIp() ? scannerStatus(currentPrinterIp()) : { ok: false, state: "setup_required", detail: "", backend: null, device: null, open_source: false };
   },
   queue: () => currentPrinterIp() ? cachedListJobs(currentPrinterName()) : Promise.resolve([]),
   device: () => printerDeviceService.status(currentPrinterIp(), currentPrinterName()),
   capabilities: () => printerDeviceService.capabilities(currentPrinterIp()),
  },
 });
 function response(c: any) {
  const printerIp = currentPrinterIp(), printerName = currentPrinterName();
  const { values, metadata } = snapshot.read();
  let scans: string[] = []; try { scans = recentScans(10).map(s => s.name); } catch {}
  return c.json({
   build_number: buildInfo.number, build: buildInfo, recovery: deps.recovery?.() ?? null,
   printer_ip: printerIp, printer_ip_managed: true,
   client_setup: clientSetup(printerName, c.req.header("host") || new URL(c.req.url).host),
   printer_name: printerName, display_name: currentDisplayName(), network_sharing: networkSharingEnabledSync(),
   reachable: values.reachable, printer: values.printer, scanner: values.scanner, queue: values.queue, device: values.device,
   printer_capabilities: values.capabilities.capabilities, maintenance: values.capabilities.maintenance,
   status_meta: { parts: metadata, refreshing: Object.values(metadata).some(p => p.refreshing), cached: c.req.query("cached") === "1" || c.req.method === "POST" },
   recent_prints: (() => { try { return listPrintHistory(10); } catch { return []; } })(), scans,
   ink: printerIp ? values.ink : null,
   printer_network: printerIp ? printerNetworkHint(printerIp, localIPv4s(), values.reachable) : null,
   max_upload_mb: limits().upload, max_scan_files: limits().scans,
  });
 }
 app.get("/api/status", async c => {
  const auth = requireAuth(c); if (auth) return auth;
  c.header("Cache-Control", "no-store");
  if (c.req.query("cached") === "1") snapshot.background();
  else await snapshot.refresh(false, ["reachable", "printer", "scanner", "queue", "device"]); // Keep HA's initial/fresh-check semantics.
  return response(c);
 });

 app.post("/api/status/refresh", async c => {
  const auth = requireAuth(c); if (auth) return auth;
  const body = await deps.readBody(c);
  if (!deps.csrf(c, body)) return c.text("Invalid or missing CSRF token", 400);
  snapshot.background(true);
  c.header("Cache-Control", "no-store");
  return response(c);
 });

app.get("/api/ink", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const printerIp=currentPrinterIp();
  if(!printerIp) return c.json({ ok:false, source:"none", cartridges:[], message:"Set up the printer first." }, 400);
  const force = c.req.query("refresh") === "1";
  try{
    if (force) {
      const { clearInkCache } = await import("../ink.ts");
      clearInkCache();
    }
    const ink = await printerDeviceService.ink(printerIp);
    if (ink.ok || !snapshot.read().values.ink.cartridges.some(c => c.level !== null)) snapshot.set("ink", ink);
    else snapshot.failed("ink");
    return c.json(ink);
  }catch(e:any){
    return c.json({ ok:false, source:"none", cartridges:[], message:String(e?.message||e) }, 502);
  }
});

app.get("/api/discover", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  try{
    const { discoverPrinters } = await import("../discover.ts");
    return c.json(await discoverPrinters({ refresh: c.req.query("refresh") === "1" }));
  }catch(e:any){
    return c.json({ ok:false, printers:[], subnets:[], scanned_at:new Date().toISOString(), message:String(e?.message||e) }, 502);
  }
});

app.get("/api/history", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  let limit=100;
  try{limit=Number.parseInt(c.req.query("limit")||"100",10);}catch{limit=100;}
  if(Number.isNaN(limit)) limit=100;
  try {
    return c.json({ history: listPrintHistory(limit) });
  } catch (error) {
    console.error("[history] Could not read print history", error);
    return c.json({ ok: false, error: "Print history is temporarily unavailable. Try again shortly." }, 503);
  }
});

// Cache health probe 10s — Docker HEALTHCHECK + frontend both hit this
let _healthCache: { at: number; p: Promise<any> } | null = null;
app.get("/api/health", async(c)=>{
  const now = Date.now();
  if (!_healthCache || now - _healthCache.at > 10_000) {
    _healthCache = {
      at: now,
      p: runCommand(["lpstat","-r"],3000).catch(() => ({ ok: false, stdout: "", stderr: "lpstat failed" }) as any),
    };
  }
  const result:any=await _healthCache.p;
  return c.json({ok:result.ok, service:"epson-printer-ha", build_number: buildInfo.number, build: buildInfo, cups:result.stdout||result.stderr}, result.ok?200:503);
});


 return { reset() { snapshot.stop(); snapshot.invalidate(); }, invalidate: snapshot.invalidate, refresh: () => snapshot.background(true), start() {
  snapshot.background(true);
  const timer = setInterval(() => snapshot.background(), 5000); timer.unref?.();
  return () => { clearInterval(timer); snapshot.stop(); };
 } };

}
