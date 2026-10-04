import { finishScan } from "./output.ts";
import { commandResult, readCommandStream, runCommand as defaultRunner } from "../system/commands.ts";
import type { CommandResult } from "../system/commands.ts";
import type { ScanControl } from "./types.ts";
import { tcpOpen as defaultTcp } from "../system/network.ts";
import { ttlCached } from "../system/cache.ts";
export function parseSaneDevices(output: string, printerIp = ""): Array<{ rank: number; device: string; backend: string }> {
  type Candidate = [number, string, string];
  const candidates: Candidate[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/device [`']([^`']+)[`']/);
    if (!match) continue;
    const device = match[1];
    const lower = `${device} ${line}`.toLowerCase();
    

    const isBridge = device.startsWith("net:127.0.0.1:") || device.startsWith("net:localhost:");
    const matchesIp = Boolean(printerIp && new RegExp(`(?<![\\d.])${escapeRegExp(printerIp)}(?![\\d.])`).test(lower));
    if (printerIp && !(matchesIp || isBridge)) continue;

    if (device.startsWith("airscan:") || lower.includes("escl") || lower.includes("wsd")) {
      candidates.push([0, device, "AirScan/WSD"]);
    } else if (isBridge && lower.includes("epson")) {
      candidates.push([1, device, "Epson compatibility bridge"]);
    } else if (lower.includes("epsonscan2") && (matchesIp || !printerIp)) {
      candidates.push([1, device, "Epson compatibility bridge"]);
    } else {
      candidates.push([2, device, "Open-source SANE"]);
    }
  }
  return candidates.sort((a,b) => a[0]-b[0]).map(([rank, device, backend]) => ({rank, device, backend}));
}
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createSaneService(runCommand = defaultRunner, tcpOpen = defaultTcp) {
const candidatesByIp = new Map<string, ReturnType<typeof parseSaneDevices>>();
async function detectSaneDevice(printerIp = ""): Promise<[string | null, string | null]> {
  // A dozing printer can take ~16s to answer SANE probes; cutting off at 12s
  // made detection (and therefore every scan) impossible while it naps.
  const result = await runCommand(["scanimage", "-L"], 30_000);
  if (!result.ok) { candidatesByIp.set(printerIp, []); return [null, null]; }

  const found = parseSaneDevices(result.stdout, printerIp);
  candidatesByIp.set(printerIp, found);
  return found.length ? [found[0].device, found[0].backend] : [null, null];
}

const deviceCache = new Map<string, { device: string | null; backend: string | null; ts: number }>();
const DEVICE_CACHE_TTL_MS = 45_000;

const deviceInflight = new Map<string, Promise<[string | null, string | null]>>();
function refreshDeviceCache(key: string, printerIp: string): Promise<[string | null, string | null]> {
  // In-flight probes are shared, never duplicated: a forced refresh joins the
  // running probe instead of clobbering another caller's slot.
  const ongoing = deviceInflight.get(key);
  if (ongoing) return ongoing;
  const p = detectSaneDevice(printerIp).then((res) => {
    if (deviceCache.size > 32) {
      const oldest = deviceCache.keys().next().value;
      if (oldest !== undefined) deviceCache.delete(oldest);
    }
    deviceCache.set(key, { device: res[0], backend: res[1], ts: Date.now() });
    // also prime generic key if printerIp specific missed but generic has result
    if (res[0] && !deviceCache.has("__any__")) {
      deviceCache.set("__any__", { device: res[0], backend: res[1], ts: Date.now() });
    }
    if (deviceInflight.get(key) === p) deviceInflight.delete(key);
    return res;
  }, (e) => {
    if (deviceInflight.get(key) === p) deviceInflight.delete(key);
    throw e;
  });
  deviceInflight.set(key, p);
  return p;
}
async function detectSaneDeviceCached(printerIp = "", forceRefresh = false): Promise<[string | null, string | null]> {
  const key = printerIp || "__any__";
  const now = Date.now();
  const cached = deviceCache.get(key);
  if (!forceRefresh && cached && now - cached.ts < DEVICE_CACHE_TTL_MS) {
    return [cached.device, cached.backend];
  }
  // Stale-while-revalidate: a slow probe (sleeping printer answers in ~16s)
  // must not stall /api/status polls. Serve the last-known answer immediately
  // and refresh in the background — except when the caller explicitly needs a
  // fresh answer (scan jobs force-refresh and wait) or nothing is known yet.
  if (!forceRefresh && cached) {
    refreshDeviceCache(key, printerIp).catch(() => {});
    return [cached.device, cached.backend];
  }
  return refreshDeviceCache(key, printerIp);
}

function clearDeviceCache() {
  deviceCache.clear();
  candidatesByIp.clear();
  scannerCache.clear();
}

async function warmDeviceCache(printerIp = "", forceRefresh = false): Promise<void> {
  try { await detectSaneDeviceCached(printerIp, forceRefresh); } catch {}
}

const scannerCache = new Map<string, { exp: number; value: any }>();
const scannerInflight = new Map<string, Promise<any>>();
async function scannerStatus(printerIp: string): Promise<{ ok: boolean; state: string; detail: string; backend: string | null; device: string | null; open_source: boolean }> {
  return ttlCached(scannerCache, scannerInflight, printerIp || "__none__", 15_000, async () => {
    if (!printerIp) {
      return { ok: false, state: "setup_required", detail: "Add the printer IP below", backend: null, device: null, open_source: false };
    }
    // Cheap: bridge TCP check + cached SANE device (no forced scanimage spawn here).
    // detectSaneDeviceCached is itself TTL-cached (45s) so this stays fast under polling.
    const [device, backend] = await detectSaneDeviceCached(printerIp).catch((): [null, null] => [null, null]);
    if (device) {
      const openSource = backend === "AirScan/WSD" || backend === "Open-source SANE";
      return { ok: true, state: "ready", detail: openSource ? `Ready via ${backend}` : `Ready via ${backend ?? "SANE"}`, backend, device, open_source: openSource };
    }
    const hasBridge = await tcpOpen("127.0.0.1", 6566, 200);
    if (hasBridge) {
      return { ok: false, state: "not_detected", detail: "The compatibility bridge is online, but no scanner was detected. Check that the printer is awake and its address is correct.", backend: "Epson compatibility bridge", device: null, open_source: false };
    }
    return { ok: false, state: "not_detected", detail: "No scanner detected. Check the printer address and connection. If setup just finished, allow the scanner service a moment to start.", backend: null, device: null, open_source: false };
  });
}

// scanDocument with Bun.Image for conversion (Bun 1.4 native) — now cached device + timeout + DPI-correct PDF
async function scanDocument(
  printerIp: string,
  outputDir: string,
  opts: { dpi?: number; mode?: string; fmt?: string; control?: ScanControl; device?: string; source?: string } = {}
): Promise<[CommandResult, string | null]> {
  let dpi = opts.dpi ?? 300;
  if (![150, 200, 300, 600].includes(dpi)) dpi = 300;
  let mode = opts.mode ?? "Color";
  if (!["Color", "Gray", "Lineart"].includes(mode)) mode = "Color";
  let fmt = (opts.fmt ?? "pdf").toLowerCase();
  if (!["pdf", "png", "jpg", "jpeg"].includes(fmt)) fmt = "pdf";

  if (opts.control?.isCancelled()) return [commandResult(false, "", "scan_cancelled", 130), null];

  // Use cached device (fast) but force refresh on miss
  let device = opts.device ?? (await detectSaneDeviceCached(printerIp))[0];
  if (!device) {
    // retry once with force refresh (bridge may have just become ready)
    [device] = await detectSaneDeviceCached(printerIp, true);
  }
  if (!device) {
    return [commandResult(false, "", "No network scanner detected. The hub checked AirScan/WSD and the localhost SANE compatibility bridge."), null];
  }

  const { mkdirSync, unlinkSync } = await import("node:fs");
  try { mkdirSync(outputDir, { recursive: true }); } catch {}
  const safeUnlink = (p: string) => { try { unlinkSync(p); } catch {} };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, -5) + `_${String(Date.now()).slice(-6)}`;
  const pngPath = `${outputDir}/.scan_${stamp}.png`;
  const args = ["scanimage", "--device-name", device, "--mode", mode, "--resolution", String(dpi), "-x", "210", "-y", "297", "--format=png"];

  if (opts.source) args.push("--source", opts.source);

  // DPI-aware timeout (higher DPI = larger + slower)
  const timeoutMsMap: Record<number, number> = { 150: 55_000, 200: 75_000, 300: 110_000, 600: 180_000 };
  const scanTimeout = timeoutMsMap[dpi] ?? 110_000;

  let lastExc: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let proc: any = null;
    let timeoutId: any = null;
    try {
      proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
      opts.control?.registerProcess(proc);
      if (opts.control?.isCancelled()) {
        try { proc.kill(); } catch {}
        return [commandResult(false, "", "scan_cancelled", 130), null];
      }
      const stdoutPromise = new Response(proc.stdout).arrayBuffer();
      const stderrPromise = readCommandStream(proc.stderr);
      const exitPromise = proc.exited;

      // timeout guard — kills proc if it hangs (e.g., device asleep 5-10m)
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          try { proc.kill(); } catch {}
          reject(new Error(`scan_timeout:${scanTimeout}`));
        }, scanTimeout);
      });

      const [stdout, stderr, exitCode] = await Promise.race([
        Promise.all([stdoutPromise, stderrPromise, exitPromise]) as Promise<[ArrayBuffer, string, number]>,
        timeoutPromise as Promise<never>,
      ]);
      if (timeoutId) clearTimeout(timeoutId);

      if (exitCode === 0) {
        if (opts.control?.isCancelled()) {
          safeUnlink(pngPath);
          return [commandResult(false, "", "scan_cancelled", 130), null];
        }
        await Bun.write(pngPath, stdout);
        break;
      }
      const errText = (stderr || "").trim();
      safeUnlink(pngPath);
      const isBusy = errText.toLowerCase().includes("busy");
      const isNoDev = errText.toLowerCase().includes("no scanners") || errText.toLowerCase().includes("inval");
      if (isBusy && attempt === 0) {
        clearDeviceCache();
        await Bun.sleep(2000);
        continue;
      }
      if (isBusy) {
        return [commandResult(false, "", "Scanner is still finishing the previous job. Wait a few seconds and try again.", exitCode), null];
      }
      if (isNoDev && attempt === 0) {
        // device may have changed — invalidate cache and retry once
        clearDeviceCache();
        const [fresh] = await detectSaneDeviceCached(printerIp, true);
        if (fresh && fresh !== device) {
          args[2] = fresh; // replace device-name
          await Bun.sleep(500);
          continue;
        }
      }
      const hint = (errText || `scanimage exited ${exitCode}`).slice(0, 800);
      return [commandResult(false, "", hint, exitCode), null];
    } catch (exc: any) {
      if (timeoutId) clearTimeout(timeoutId);
      const msg = String(exc?.message || exc);
      if (opts.control?.isCancelled()) {
        safeUnlink(pngPath);
        return [commandResult(false, "", "scan_cancelled", 130), null];
      }
      if (msg.startsWith("scan_timeout:")) {
        safeUnlink(pngPath);
        return [commandResult(false, "", `Scanner did not respond within ${Math.round(scanTimeout/1000)}s. Check the printer is awake, paper is on glass, then try again.`, 1), null];
      }
      lastExc = exc;
      safeUnlink(pngPath);
      if (attempt === 0) {
        await Bun.sleep(1500);
        continue;
      }
      return [commandResult(false, "", String(exc), 1), null];
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (proc && proc.exitCode === null) {
        try { proc.kill(); } catch {}
        await Promise.race([proc.exited, Bun.sleep(1500)]);
        if (proc.exitCode === null) { try { proc.kill(9); } catch {} await proc.exited; }
      }
      opts.control?.clearProcess();
    }
  }

  return finishScan(pngPath, outputDir, stamp, dpi, fmt, opts);
}

async function listCandidates(ip: string, refresh = false) {
 await detectSaneDeviceCached(ip, refresh);
 return candidatesByIp.get(ip) ?? [];
}
return { listCandidates, detectSaneDevice, detectSaneDeviceCached, clearDeviceCache, warmDeviceCache, scannerStatus, scanDocument,
 clearStatusCache() { scannerCache.clear(); scannerInflight.clear(); } };
}
