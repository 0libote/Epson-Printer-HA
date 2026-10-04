import { commandResult, runCommand as defaultRunner } from "../system/commands.ts";
import { validatePrinterAddress } from "../system/validation.ts";
import { AirScanBackend, SaneBackend } from "./airscan.ts";
import { EpsonScan2Backend } from "./epson-scan2.ts";
import type { createSaneService } from "./sane.ts";
import type { ScannerBackend, ScannerCapabilities, ScanOptions, ScanResult } from "./types.ts";

type ScannerSummary = { selected: string | null; backends: Array<{ id: string; name: string; capabilities: ScannerCapabilities; lastError: string | null }>; capabilities: ScannerCapabilities | null };
export function supportsOptions(caps: Awaited<ReturnType<ScannerBackend["getCapabilities"]>>, options: ScanOptions) {
 const fmt = options.fmt === "jpeg" ? "jpg" : options.fmt ?? "pdf";
 const combinations = (caps as { combinations?: Array<{ dpi: number; mode: string }> }).combinations;
 return caps.sources.includes("flatbed") && caps.formats.includes(fmt) && (combinations
  ? combinations.some(p => p.dpi === (options.dpi ?? 300) && p.mode === (options.mode ?? "Color"))
  : caps.resolutions.includes(options.dpi ?? 300) && caps.modes.includes(options.mode ?? "Color"));
}

export function createScannerManager(sane: ReturnType<typeof createSaneService>, runner = defaultRunner, epson = new EpsonScan2Backend()) {
 const cache = new Map<string, { until: number; value: ScannerBackend[] }>();
 const inflight = new Map<string, Promise<ScannerBackend[]>>();
 const rejected = new Map<string, { until: number; error: string }>();
 const summaries = new Map<string, { until: number; value: ScannerSummary }>();
 const summaryInflight = new Map<string, Promise<ScannerSummary>>();
 const active = new Map<string, string>();
 function invalidate(ip?: string) { if (ip) { cache.delete(ip); summaries.delete(ip); active.delete(ip); } else { cache.clear(); summaries.clear(); active.clear(); } sane.clearDeviceCache(); epson.invalidate(); }
 async function backends(ip: string, refresh = false): Promise<ScannerBackend[]> {
  if (!ip) return [];
  validatePrinterAddress(ip);
  if (refresh) invalidate(ip);
  const hit = cache.get(ip);
  if (hit && hit.until > Date.now()) return hit.value;
  if (inflight.has(ip)) return inflight.get(ip)!;
  const pending = (async () => {
   const devices = await sane.listCandidates(ip, refresh);
   const result: ScannerBackend[] = devices.map(d => d.rank === 0 ? new AirScanBackend(d.device, sane, runner)
    : new SaneBackend(d.rank === 1 ? "epson-sane-bridge" : "sane", d.backend, d.device, sane, runner));
   if (await epson.available(ip)) {
    const firstFallback = result.findIndex(b => b.id !== "airscan");
    result.splice(firstFallback < 0 ? result.length : firstFallback, 0, epson);
   }
   if (cache.size >= 32) cache.delete(cache.keys().next().value!);
   cache.set(ip, { until: Date.now() + 60_000, value: result });
   return result;
  })();
  inflight.set(ip, pending);
  try { return await pending; } finally { if (inflight.get(ip) === pending) inflight.delete(ip); }
 }
 async function select(ip: string, options: ScanOptions): Promise<ScannerBackend | null> {
  let unverified: ScannerBackend | null = null;
  for (const backend of await backends(ip)) {
   if ((rejected.get(`${ip}:${backend.id}`)?.until ?? 0) > Date.now()) continue;
   try {
    const caps = await backend.getCapabilities(ip);
    if (!caps.verified && backend.id !== "epsonscan2") { unverified ??= backend; continue; }
    if (supportsOptions(caps, options)) return backend;
   } catch { /* An unavailable capability probe must not hide other adapters. */ }
  }
  // Preserve existing SANE operation when an old backend cannot describe options.
  return unverified;
 }
 async function scan(ip: string, outputDir: string, options: ScanOptions): Promise<ScanResult> {
  if (options.control?.isCancelled()) return [commandResult(false, "", "scan_cancelled", 130), null];
  const backend = await select(ip, options);
  if (!backend) return [commandResult(false, "", "No scanner supports these settings", 2), null];
  active.set(ip, backend.id);
  let result: ScanResult;
  try { result = await backend.scan(ip, outputDir, options); }
  catch { result = [commandResult(false, "", "Scanner backend failed; rediscover before trying again", 1), null]; }
  if (!result[0].ok && result[0].returncode !== 130) {
   const error = result[0].stderr.slice(0, 200);
   rejected.set(`${ip}:${backend.id}`, { until: Date.now() + 60_000, error });
   if (rejected.size > 64) rejected.delete(rejected.keys().next().value!);
   console.warn(`[scanner:${backend.id}] ${error}`);
   cache.delete(ip); active.delete(ip); sane.clearDeviceCache();
  }
  summaries.delete(ip);
  // Never automatically repeat an acquisition on another backend.
  return result;
 }
 async function loadSummary(ip: string, refresh = false): Promise<ScannerSummary> {
  const available = await backends(ip, refresh);
  const summary = await Promise.all(available.map(async b => {
   try { return { id: b.id, name: b.name, capabilities: await b.getCapabilities(ip), lastError: rejected.get(`${ip}:${b.id}`)?.error ?? null }; }
   catch { return { id: b.id, name: b.name, capabilities: { resolutions: [], modes: [], sources: [], formats: [], verified: false }, lastError: "Backend capability probe failed" }; }
  }));
  const eligible = summary.filter(b => (rejected.get(`${ip}:${b.id}`)?.until ?? 0) <= Date.now());
  const previous = active.get(ip);
  const selected = (previous && summary.some(b => b.id === previous) ? previous : null)
    ?? eligible.find(b => b.capabilities.verified && supportsOptions(b.capabilities, {}))?.id
    ?? eligible.find(b => b.capabilities.verified && b.capabilities.sources.includes("flatbed"))?.id
    ?? eligible.find(b => !b.capabilities.verified && b.id !== "epsonscan2")?.id ?? null;
  return { selected, backends: summary, capabilities: summary.find(b => b.id === selected)?.capabilities ?? null };
 }
 async function capabilities(ip: string, refresh = false): Promise<ScannerSummary> {
  if (refresh) invalidate(ip);
  const hit = summaries.get(ip);
  if (!refresh && hit && hit.until > Date.now()) return hit.value;
  const ongoing = summaryInflight.get(ip);
  if (ongoing) return ongoing;
  const pending = loadSummary(ip, refresh);
  summaryInflight.set(ip, pending);
  try {
   const value = await pending;
   if (summaries.size >= 32) summaries.delete(summaries.keys().next().value!);
   summaries.set(ip, { until: Date.now() + 60_000, value });
   return value;
  } finally { if (summaryInflight.get(ip) === pending) summaryInflight.delete(ip); }
 }
 function peekCapabilities(ip: string): ScannerSummary | null {
  const hit = summaries.get(ip);
  if (!hit || hit.until < Date.now()) void capabilities(ip).catch(() => {});
  return hit?.value ?? null;
 }
 return { backends, select, scan, capabilities, peekCapabilities, invalidate, epson };
}
