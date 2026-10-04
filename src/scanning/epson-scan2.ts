import { mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { commandResult } from "../system/commands.ts";
import { validatePrinterAddress } from "../system/validation.ts";
import { finishScan } from "./output.ts";
import type { ScannerBackend, ScannerCapabilities, ScanOptions, ScanResult } from "./types.ts";

export type EpsonHealth = { ok: boolean; version: string; printerAddress: string | null; capabilities: ScannerCapabilities & { combinations: Array<{ dpi: number; mode: string }> }; lastError: string | null };
type RequestFn = (path: string, body?: object) => Promise<Response>;
const MAX_SCAN_BYTES = 96 * 1024 * 1024;

export class EpsonScan2Backend implements ScannerBackend {
 readonly id = "epsonscan2";
 readonly name = "Epson Scan 2";
 private healthCache: { until: number; value: EpsonHealth } | null = null;
 private inflight: Promise<EpsonHealth> | null = null;
 private statuses = new Map<string, { until: number; value: { ok: boolean; state: string; error?: string } }>();
 private statusInflight = new Map<string, Promise<{ ok: boolean; state: string; error?: string }>>();
 lastError: string | null = null;
 constructor(private request: RequestFn = (path, body) => fetch(`http://scanner${path}`, {
   unix: process.env.EPSON_SCANNER_SOCKET || "/run/epson-scanner/api.sock",
   method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {},
   body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25_000),
   redirect: "error",
 })) {}
 private async call(path: string, body?: object): Promise<Response> {
  try { return await this.request(path, body); }
  catch { throw new Error("Scanner sidecar unavailable; the scanner may still be running"); }
 }
 invalidate() { this.healthCache = null; this.statuses.clear(); }
 async health(): Promise<EpsonHealth> {
  if (this.healthCache && this.healthCache.until > Date.now()) return this.healthCache.value;
  if (this.inflight) return this.inflight;
  const pending = (async () => {
   const response = await this.call("/health");
   if (!response.ok) throw new Error("Scanner sidecar unavailable");
   const health = await response.json() as EpsonHealth;
   if (!health.ok || !Array.isArray(health.capabilities?.combinations)) throw new Error("Invalid scanner sidecar response");
   this.healthCache = { until: Date.now() + 60_000, value: health };
   return health;
  })();
  this.inflight = pending;
  try { return await pending; } catch {
   this.lastError = "Epson Scan 2 sidecar unavailable";
   throw new Error(this.lastError);
  } finally { if (this.inflight === pending) this.inflight = null; }
 }
 async available(ip: string) { try { const health = await this.health(); return health.printerAddress === ip && health.capabilities.combinations.length > 0; } catch { return false; } }
 async getCapabilities(_ip: string) { const caps = (await this.health()).capabilities; return { ...caps, formats: ["png", "jpg", "pdf"] }; }
 async status(ip: string) {
  validatePrinterAddress(ip);
  const cached = this.statuses.get(ip);
  if (cached && cached.until > Date.now()) return cached.value;
  if (this.statusInflight.has(ip)) return this.statusInflight.get(ip)!;
  const pending = (async () => {
   const response = await this.call("/status", { ip });
   if (!response.ok) throw new Error("Scanner status unavailable");
   const value = await response.json() as { ok: boolean; state: string; error?: string };
   if (this.statuses.size >= 32) this.statuses.delete(this.statuses.keys().next().value!);
   this.statuses.set(ip, { until: Date.now() + 60_000, value });
   return value;
  })();
  this.statusInflight.set(ip, pending);
  try { return await pending; } finally { if (this.statusInflight.get(ip) === pending) this.statusInflight.delete(ip); }
 }
 peekStatus(ip: string) {
  const hit = this.statuses.get(ip);
  if (!hit || hit.until < Date.now()) void this.status(ip).catch(() => {
   this.statuses.set(ip, { until: Date.now() + 15_000, value: { ok: false, state: "unknown" } });
  });
  return hit?.value ?? null;
 }
 async supports(ip: string, options: ScanOptions) {
  if (!(await this.available(ip))) return false;
  const caps = await this.getCapabilities(ip);
  return caps.combinations.some(p => p.dpi === (options.dpi ?? 300) && p.mode === (options.mode ?? "Color"));
 }
 async scan(ip: string, outputDir: string, options: ScanOptions): Promise<ScanResult> {
  validatePrinterAddress(ip);
  let id: string | null = null;
  const control = options.control;
  let cancelSent: Promise<Response> | null = null;
  const cancel = () => {
   if (id && !cancelSent) cancelSent = this.call(`/jobs/${id}/cancel`, {}).catch(() => new Response(null, { status: 503 }));
  };
  try {
   if (control?.isCancelled()) return [commandResult(false, "", "scan_cancelled", 130), null];
   if (!(await this.supports(ip, options))) return [commandResult(false, "", "No validated Epson profile for these settings", 2), null];
   const response = await this.call("/scan", { ip, dpi: options.dpi ?? 300, mode: options.mode ?? "Color", format: "png" });
   if (!response.ok) throw new Error(response.status === 409 ? "Scanner busy" : "Epson Scan 2 could not start the scan");
   const started = await response.json() as { id: string };
   if (!/^[a-f0-9]{32}$/.test(started.id)) throw new Error("Invalid Epson scan job response");
   id = started.id;
   control?.registerProcess({ kill: cancel });
   const deadline = Date.now() + 280_000;
   while (Date.now() < deadline) {
    if (control?.isCancelled()) cancel();
    const poll = await this.call(`/jobs/${id}`);
    if (!poll.ok) throw new Error("Lost contact with Epson scanner; it may still be running");
    const job = await poll.json() as { state: string };
    if (job.state === "cancelled") return [commandResult(false, "", "scan_cancelled", 130), null];
    if (job.state === "error") throw new Error("Epson scan failed; check the printer and validated profile");
    if (job.state === "done") {
     if (control?.isCancelled()) return [commandResult(false, "", "scan_cancelled", 130), null];
     const file = await this.call(`/jobs/${id}/file`);
     if (!file.ok || file.headers.get("content-type") !== "image/png") throw new Error("Invalid Epson scan output");
     const length = Number(file.headers.get("content-length"));
     if (!Number.isSafeInteger(length) || length <= 8 || length > MAX_SCAN_BYTES) throw new Error("Invalid Epson scan output size");
     mkdirSync(outputDir, { recursive: true });
     const stamp = crypto.randomUUID();
     const path = join(outputDir, `.scan_${stamp}.png`);
     try {
      // Reject chunked/oversized data before buffering a complete image.
      const reader = file.body?.getReader();
      if (!reader) throw new Error("Missing scan output");
      const writer = Bun.file(path).writer();
      let size = 0;
      try {
       while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > length || control?.isCancelled()) { await reader.cancel(); throw new Error("Invalid or cancelled scan output"); }
        writer.write(value);
       }
      } finally { await writer.end(); }
      const signature = new Uint8Array(await Bun.file(path).slice(0, 8).arrayBuffer());
      if (size !== length || signature.join() !== "137,80,78,71,13,10,26,10") throw new Error("Invalid Epson image");
      return await finishScan(path, outputDir, stamp, options.dpi ?? 300, options.fmt ?? "pdf", options);
     } finally { try { unlinkSync(path); } catch {} }
    }
    await Bun.sleep(250);
   }
   throw new Error("Epson scan timed out; cancellation requested");
  } catch (error) {
   cancel();
   this.invalidate();
   this.lastError = error instanceof Error ? error.message : "Epson Scan 2 failed";
   return [commandResult(false, "", control?.isCancelled() ? "scan_cancelled" : this.lastError, control?.isCancelled() ? 130 : 1), null];
  } finally {
   if (cancelSent) await cancelSent;
   this.statuses.delete(ip);
   control?.clearProcess();
  }
 }
}
