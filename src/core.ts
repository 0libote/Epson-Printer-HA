import { createConnection } from "node:net";
import { PDFDocument } from "pdf-lib";

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  returncode: number;
}

export interface ScanControl {
  isCancelled: () => boolean;
  registerProcess: (process: { kill: () => void }) => void;
  clearProcess: () => void;
  setProgress?: (progress: string) => void;
}

export function commandResult(ok: boolean, stdout = "", stderr = "", returncode = 0): CommandResult {
  return { ok, stdout, stderr, returncode };
}

// Bun.spawn based runCommand with timeout (no listener leaks, no zombie procs)
export async function runCommand(args: string[], timeout = 30_000, cwd?: string): Promise<CommandResult> {
  let proc: any;
  let timer: any = null;
  try {
    proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      cwd,
    });
    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();
    const exitPromise = proc.exited;

    let timedOut = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        try { proc.kill(); } catch {}
        reject(new Error("timeout"));
      }, timeout);
    });

    try {
      const [out, err, code] = (await Promise.race([
        Promise.all([stdoutPromise, stderrPromise, exitPromise]),
        timeoutPromise,
      ])) as [string, string, number];
      return commandResult(code === 0, out.trim(), err.trim(), code);
    } catch (exc: any) {
      if (timedOut || exc?.message === "timeout") {
        try { await Promise.race([proc.exited, Bun.sleep(1500)]); } catch {}
        try { proc.kill(9); } catch {}
        return commandResult(false, "", "timeout", 1);
      }
      throw exc;
    }
  } catch (exc: any) {
    if (exc?.message === "timeout") {
      try { proc?.kill(); } catch {}
      return commandResult(false, "", "timeout", 1);
    }
    return commandResult(false, "", String(exc?.message ?? exc), 1);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Generic TTL cache with in-flight dedup: concurrent callers share one promise,
// avoiding spawn storms when many dashboard clients poll at once.
function ttlCached<T>(cache: Map<string, { exp: number; value: T }>, inflight: Map<string, Promise<T>>, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return Promise.resolve(hit.value);
  const ongoing = inflight.get(key);
  if (ongoing) return ongoing;
  const p = fn().then(
    (v) => {
      if (cache.size > 128) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { exp: Date.now() + ttlMs, value: v });
      inflight.delete(key);
      return v;
    },
    (e) => {
      inflight.delete(key);
      throw e;
    }
  );
  inflight.set(key, p);
  return p;
}

// sync-ish version for quick calls where async not needed - uses Bun.spawnSync
export function runCommandSync(args: string[], timeout = 5000): CommandResult {
  try {
    const proc = Bun.spawnSync(args, { timeout });
    const stdout = proc.stdout ? Buffer.from(proc.stdout).toString("utf-8").trim() : "";
    const stderr = proc.stderr ? Buffer.from(proc.stderr).toString("utf-8").trim() : "";
    return commandResult(proc.exitCode === 0, stdout, stderr, proc.exitCode ?? 1);
  } catch (exc: any) {
    return commandResult(false, "", String(exc), 1);
  }
}

export function tcpOpen(host: string, port: number, timeout = 1000): Promise<boolean> {
  if (!host) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (v: boolean) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(v);
    };
    const socket = createConnection({ host, port, timeout }, () => {
      try { socket.end(); } catch {}
      done(true);
    });
    socket.on("error", () => done(false));
    socket.on("timeout", () => done(false));
    // hard fallback so a hung kernel connect can never leak the socket
    setTimeout(() => done(false), timeout + 500).unref?.();
  });
}

export async function printerReachable(host: string): Promise<boolean> {
  // tighter timeout per port 0.35s keeps offline under 1.2s
  for (const port of [631, 9100, 515] as const) {
    if (await tcpOpen(host, port, 350)) return true;
  }
  return false;
}

// TTL caches with in-flight dedup (no bucket churn, bounded size)
const reachableCache = new Map<string, { exp: number; value: boolean }>();
const reachableInflight = new Map<string, Promise<boolean>>();
export async function cachedPrinterReachable(host: string): Promise<boolean> {
  return ttlCached(reachableCache, reachableInflight, host, 10_000, () => printerReachable(host));
}

export async function cupsPrinterStatus(printerName: string): Promise<{ ok: boolean; state: string; detail: string }> {
  const result = await runCommand(["lpstat", "-p", printerName, "-l"], 5000);
  const text = (result.stdout || result.stderr).trim();
  if (result.ok) {
    const lower = text.toLowerCase();
    let state = "ready";
    if (lower.includes("disabled")) state = "disabled";
    else if (lower.includes("printing")) state = "printing";
    return { ok: true, state, detail: text };
  }
  return { ok: false, state: "unconfigured", detail: text || "CUPS queue not configured" };
}

const cupsStatusCache = new Map<string, { exp: number; value: any }>();
const cupsStatusInflight = new Map<string, Promise<any>>();
export async function cachedCupsPrinterStatus(printerName: string) {
  return ttlCached(cupsStatusCache, cupsStatusInflight, printerName, 8_000, () => cupsPrinterStatus(printerName));
}

export async function listJobs(printerName: string): Promise<Array<{ id: string; owner: string; size: string; raw: string }>> {
  const result = await runCommand(["lpstat", "-o", printerName], 5000);
  if (!result.ok || !result.stdout) return [];
  const jobs: Array<{ id: string; owner: string; size: string; raw: string }> = [];
  for (const line of result.stdout.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (!parts[0]) continue;
    const jobId = parts[0];
    const owner = parts[1] ?? "";
    const size = parts[2] ?? "";
    jobs.push({ id: jobId, owner, size, raw: line });
  }
  return jobs;
}

const jobsCache = new Map<string, { exp: number; value: any }>();
const jobsInflight = new Map<string, Promise<any>>();
export async function cachedListJobs(printerName: string) {
  return ttlCached(jobsCache, jobsInflight, printerName, 4_000, () => listJobs(printerName));
}

export async function submitPrint(printerName: string, path: string, opts: { copies?: number; grayscale?: boolean; title?: string } = {}): Promise<CommandResult> {
  const copies = Math.max(1, Math.min(opts.copies ?? 1, 99));
  const title = (opts.title ?? path.split("/").pop() ?? "WebUI print").slice(0, 255) || "WebUI print";
  const args = ["lp", "-U", "epson", "-d", printerName, "-t", title, "-n", String(copies)];
  if (opts.grayscale) args.push("-o", "Ink=MONO");
  args.push(path);
  return runCommand(args, 60_000);
}

export async function cancelJob(jobId: string): Promise<CommandResult> {
  if (!/^[A-Za-z0-9_.-]+-\d+$/.test(jobId)) {
    return commandResult(false, "", "Invalid job id", 2);
  }
  return runCommand(["cancel", jobId], 10_000);
}

export async function detectSaneDevice(printerIp = ""): Promise<[string | null, string | null]> {
  const result = await runCommand(["scanimage", "-L"], 12_000);
  if (!result.ok) return [null, null];

  type Candidate = [number, string, string];
  const candidates: Candidate[] = [];
  for (const line of result.stdout.split("\n")) {
    const match = line.match(/device [`']([^`']+)[`']/);
    if (!match) continue;
    const device = match[1];
    const lower = `${device} ${line}`.toLowerCase();
    if (!lower.includes("epson")) continue;

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
  if (!candidates.length) return [null, null];
  candidates.sort((a, b) => a[0] - b[0]);
  const [, device, backend] = candidates[0];
  return [device, backend];
}

const deviceCache = new Map<string, { device: string | null; backend: string | null; ts: number }>();
const DEVICE_CACHE_TTL_MS = 45_000;

const deviceInflight = new Map<string, Promise<[string | null, string | null]>>();
export async function detectSaneDeviceCached(printerIp = "", forceRefresh = false): Promise<[string | null, string | null]> {
  const key = printerIp || "__any__";
  const now = Date.now();
  const cached = deviceCache.get(key);
  if (!forceRefresh && cached && now - cached.ts < DEVICE_CACHE_TTL_MS) {
    return [cached.device, cached.backend];
  }
  const ongoing = deviceInflight.get(key);
  if (ongoing && !forceRefresh) return ongoing;
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
    deviceInflight.delete(key);
    return res;
  }, (e) => {
    deviceInflight.delete(key);
    throw e;
  });
  deviceInflight.set(key, p);
  return p;
}

export function clearDeviceCache() {
  deviceCache.clear();
}

export async function warmDeviceCache(printerIp = "", forceRefresh = false): Promise<void> {
  try { await detectSaneDeviceCached(printerIp, forceRefresh); } catch {}
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function jpegQualityForDpi(dpi: number): number {
  if (dpi >= 600) return 92;
  if (dpi >= 300) return 90;
  return 88;
}

const scannerCache = new Map<string, { exp: number; value: any }>();
const scannerInflight = new Map<string, Promise<any>>();
export async function scannerStatus(printerIp: string): Promise<{ ok: boolean; state: string; detail: string; backend: string | null; device: string | null; open_source: boolean }> {
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
      return { ok: true, state: "ready", detail: "Epson compatibility bridge is online", backend: "Epson compatibility bridge", device: null, open_source: false };
    }
    return { ok: false, state: "starting", detail: "The automatic scanner service is still starting.", backend: null, device: null, open_source: false };
  });
}

export function clearStatusCaches() {
  reachableCache.clear();
  cupsStatusCache.clear();
  jobsCache.clear();
  scannerCache.clear();
  reachableInflight.clear();
  cupsStatusInflight.clear();
  jobsInflight.clear();
  scannerInflight.clear();
  // device cache kept intentionally for perf, but caller can clearDeviceCache() after config change
}

// scanDocument with Bun.Image for conversion (Bun 1.4 native) — now cached device + timeout + DPI-correct PDF
export async function scanDocument(
  printerIp: string,
  outputDir: string,
  opts: { dpi?: number; mode?: string; fmt?: string; control?: ScanControl } = {}
): Promise<[CommandResult, string | null]> {
  let dpi = opts.dpi ?? 300;
  if (![150, 200, 300, 600].includes(dpi)) dpi = 300;
  let mode = opts.mode ?? "Color";
  if (!["Color", "Gray", "Lineart"].includes(mode)) mode = "Color";
  let fmt = (opts.fmt ?? "pdf").toLowerCase();
  if (!["pdf", "png", "jpg", "jpeg"].includes(fmt)) fmt = "pdf";

  // Use cached device (fast) but force refresh on miss
  let [device] = await detectSaneDeviceCached(printerIp);
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
  const pngPath = `${outputDir}/scan_${stamp}.png`;
  const args = ["scanimage", "--device-name", device, "--mode", mode, "--resolution", String(dpi), "-x", "210", "-y", "297", "--format=png"];

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
      const stderrPromise = new Response(proc.stderr).text();
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
      const hint = errText || `scanimage exited ${exitCode}`;
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
      opts.control?.clearProcess();
    }
  }

  const pngFile = Bun.file(pngPath);
  if (!(await pngFile.exists())) {
    if (lastExc) return [commandResult(false, "", String(lastExc), 1), null];
    return [commandResult(false, "", "Scan failed without output", 1), null];
  }

  if (fmt === "png") {
    return [commandResult(true, pngPath), pngPath];
  }

  try {
    opts.control?.setProgress?.("Converting scan");
    if (fmt === "jpg" || fmt === "jpeg") {
      const outPath = `${outputDir}/scan_${stamp}.jpg`;
      const img = (Bun.file(pngPath) as any).image();
      await img.jpeg({ quality: jpegQualityForDpi(dpi) }).write(outPath);
      safeUnlink(pngPath);
      return [commandResult(true, outPath), outPath];
    } else {
      const outPath = `${outputDir}/scan_${stamp}.pdf`;
      const pngBytes = await Bun.file(pngPath).arrayBuffer();
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595.28, 841.89]);
      let image;
      try {
        image = await pdfDoc.embedPng(pngBytes);
      } catch {
        const tmpJpg = `${outputDir}/.tmp_${stamp}.jpg`;
        const img = new (Bun as any).Image(pngBytes);
        await img.jpeg({ quality: jpegQualityForDpi(dpi) }).write(tmpJpg);
        const jpgBytes = await Bun.file(tmpJpg).arrayBuffer();
        image = await pdfDoc.embedJpg(jpgBytes);
        safeUnlink(tmpJpg);
      }
      const { width, height } = image.scale(1);
      // DPI-correct display size: pixels -> points at target dpi
      const displayW = (width * 72) / dpi;
      const displayH = (height * 72) / dpi;
      // If embed gave points already shrunk (pdf-lib sometimes returns points at 72dpi), fallback uses min
      const srcW = Math.min(width, displayW);
      const srcH = Math.min(height, displayH);
      const maxW = page.getWidth() - 20;
      const maxH = page.getHeight() - 20;
      const fit = Math.min(maxW / srcW, maxH / srcH, 1);
      const drawW = srcW * fit;
      const drawH = srcH * fit;
      const x = (page.getWidth() - drawW) / 2;
      const y = (page.getHeight() - drawH) / 2;
      page.drawImage(image, { x, y, width: drawW, height: drawH });
      const pdfBytes = await pdfDoc.save();
      await Bun.write(outPath, pdfBytes);
      safeUnlink(pngPath);
      return [commandResult(true, outPath), outPath];
    }
  } catch (exc: any) {
    return [commandResult(true, pngPath, `Conversion failed; saved PNG instead: ${exc}`), pngPath];
  }
}
