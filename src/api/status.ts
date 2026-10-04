import type { Hono } from "hono";
import { cachedPrinterReachable, cachedCupsPrinterStatus, scannerStatus, cachedListJobs, localIPv4s, printerNetworkHint, runCommand } from "../core.ts";
import { listPrintHistory } from "../history.ts";
import { getCachedInkLevels } from "../ink.ts";
import type { createPrinterDeviceService } from "../printer/manager.ts";
export function registerStatusApi(app: Hono, deps: {
 requireAuth: (c: any) => Response | null;
 currentPrinterIp: () => string; currentPrinterName: () => string; currentDisplayName: () => string;
 clientSetup: (name: string, host: string) => any; networkSharingEnabledSync: () => boolean;
 recentScans: (limit: number) => Array<{ name: string; path: string }>;
 printerDeviceService: ReturnType<typeof createPrinterDeviceService>;
 limits: () => { upload: number; scans: number };
}) {
 const { requireAuth, currentPrinterIp, currentPrinterName, currentDisplayName, clientSetup, networkSharingEnabledSync, recentScans, printerDeviceService, limits } = deps;
// In-flight dedup for /api/status: concurrent dashboard polls share one backend fan-out
let _statusInflight: Promise<any> | null = null;
let _statusInflightKey = "";
app.get("/api/status", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const printerIp=currentPrinterIp();
  const printerName=currentPrinterName();
  const client = clientSetup(printerName, c.req.header("host") || new URL(c.req.url).host);
  const key = `${printerIp}:${printerName}:${client.host}`;
  if (_statusInflight && _statusInflightKey === key) {
    try { return c.json(await _statusInflight); } catch {}
  }
  const p = (async () => {
    let scans:string[]=[];
    try{scans=recentScans(10).map(s=>s.name);}catch{scans=[];}
    const [reachable, printer, scanner, queue] = printerIp
      ? await Promise.all([
          cachedPrinterReachable(printerIp),
          cachedCupsPrinterStatus(printerName),
          scannerStatus(printerIp),
          cachedListJobs(printerName),
        ])
      : [false, {ok:false, state:"setup_required"}, {ok:false, state:"setup_required"}, []];
    return {
      printer_ip:printerIp,
      printer_ip_managed: false,
      client_setup: client,
      printer_name:printerName,
      display_name:currentDisplayName(),
      network_sharing:networkSharingEnabledSync(),
      reachable,
      printer,
      device: await printerDeviceService.status(printerIp, printerName),
      scanner,
      queue,
      recent_prints: (()=>{try{return listPrintHistory(10);}catch{return [];}})(),
      scans,
      ink: printerIp ? getCachedInkLevels(printerIp) : null,
      printer_network: printerIp ? printerNetworkHint(printerIp, localIPv4s(), reachable) : null,
      max_upload_mb: limits().upload,
      max_scan_files: limits().scans,
    };
  })();
  _statusInflight = p; _statusInflightKey = key;
  try {
    const data = await p;
    return c.json(data);
  } finally {
    if (_statusInflight === p) { _statusInflight = null; _statusInflightKey = ""; }
  }
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
    return c.json(await printerDeviceService.ink(printerIp));
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
  return c.json({ok:result.ok, service:"epson-printer-ha", cups:result.stdout||result.stderr}, result.ok?200:503);
});


}
