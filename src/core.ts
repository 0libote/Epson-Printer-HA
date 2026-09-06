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

// Bun.spawn based runCommand with timeout
export async function runCommand(args: string[], timeout = 30_000, cwd?: string): Promise<CommandResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  let proc: any;
  try {
    proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      cwd,
    });
    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();
    const exitPromise = proc.exited;

    const result = await Promise.race([
      Promise.all([stdoutPromise, stderrPromise, exitPromise]).then(([out, err, code]) => ({
        out: out.trim(),
        err: err.trim(),
        code,
      })),
      new Promise<never>((_, reject) =>
        ac.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })
      ),
    ]);

    if (ac.signal.aborted) {
      try { proc.kill(); } catch {}
      return commandResult(false, "", "timeout", 1);
    }

    const { out, err, code } = result as { out: string; err: string; code: number };
    return commandResult(code === 0, out, err, code);
  } catch (exc: any) {
    if (exc?.message === "timeout") {
      try { proc?.kill(); } catch {}
      return commandResult(false, "", "timeout", 1);
    }
    return commandResult(false, "", String(exc), 1);
  } finally {
    clearTimeout(timer);
  }
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
    const socket = createConnection({ host, port, timeout }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      try { socket.destroy(); } catch {}
      resolve(false);
    });
    socket.on("timeout", () => {
      try { socket.destroy(); } catch {}
      resolve(false);
    });
  });
}

export async function printerReachable(host: string): Promise<boolean> {
  // tighter timeout per port 0.35s keeps offline under 1.2s
  for (const port of [631, 9100, 515] as const) {
    if (await tcpOpen(host, port, 350)) return true;
  }
  return false;
}

// cached with time bucket
const reachableCache = new Map<string, { time: number; value: boolean }>();
export async function cachedPrinterReachable(host: string): Promise<boolean> {
  const bucket = Math.floor(performance.now() / 7000);
  const key = `${host}:${bucket}`;
  const cached = reachableCache.get(key);
  if (cached) return cached.value;
  const val = await printerReachable(host);
  reachableCache.set(key, { time: bucket, value: val });
  // prune old
  if (reachableCache.size > 64) {
    const oldest = Array.from(reachableCache.keys())[0];
    reachableCache.delete(oldest);
  }
  return val;
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

const cupsStatusCache = new Map<string, { bucket: number; value: any }>();
export async function cachedCupsPrinterStatus(printerName: string) {
  const bucket = Math.floor(performance.now() / 3000);
  const key = `${printerName}:${bucket}`;
  const c = cupsStatusCache.get(key);
  if (c && c.bucket === bucket) return c.value;
  const val = await cupsPrinterStatus(printerName);
  cupsStatusCache.set(key, { bucket, value: val });
  return val;
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

const jobsCache = new Map<string, { bucket: number; value: any }>();
export async function cachedListJobs(printerName: string) {
  const bucket = Math.floor(performance.now() / 2000);
  const key = `${printerName}:${bucket}`;
  const c = jobsCache.get(key);
  if (c && c.bucket === bucket) return c.value;
  const val = await listJobs(printerName);
  jobsCache.set(key, { bucket, value: val });
  return val;
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

export async function detectSaneDeviceCached(printerIp = "", forceRefresh = false): Promise<[string | null, string | null]> {
  const key = printerIp || "__any__";
  const now = Date.now();
  const cached = deviceCache.get(key);
  if (!forceRefresh && cached && now - cached.ts < DEVICE_CACHE_TTL_MS) {
    return [cached.device, cached.backend];
  }
  const res = await detectSaneDevice(printerIp);
  deviceCache.set(key, { device: res[0], backend: res[1], ts: now });
  // also prime generic key if printerIp specific missed but generic has result
  if (res[0] && !deviceCache.has("__any__")) {
    deviceCache.set("__any__", { device: res[0], backend: res[1], ts: now });
  }
  return res;
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

const scannerCache = new Map<string, { bucket: number; value: any }>();
export async function scannerStatus(printerIp: string): Promise<{ ok: boolean; state: string; detail: string; backend: string | null; device: string | null; open_source: boolean }> {
  const bucket = Math.floor(performance.now() / 5000);
  const key = `${printerIp}:${bucket}`;
  const c = scannerCache.get(key);
  if (c && c.bucket === bucket) return c.value;

  const hasBridge = await tcpOpen("127.0.0.1", 6566, 200);
  let val: any;
  if (hasBridge) {
    val = {
      ok: true,
      state: "ready",
      detail: "Epson compatibility bridge is online",
      backend: "Epson compatibility bridge",
      device: null,
      open_source: false,
    };
  } else {
    val = {
      ok: false,
      state: "starting",
      detail: "The automatic scanner service is still starting.",
      backend: null,
      device: null,
      open_source: false,
    };
  }
  scannerCache.set(key, { bucket, value: val });
  return val;
}

export function clearStatusCaches() {
  reachableCache.clear();
  cupsStatusCache.clear();
  jobsCache.clear();
  scannerCache.clear();
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

  await Bun.$`mkdir -p ${outputDir}`.quiet();

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
          try { await Bun.$`rm -f ${pngPath}`.quiet(); } catch {}
          return [commandResult(false, "", "scan_cancelled", 130), null];
        }
        await Bun.write(pngPath, stdout);
        break;
      }
      const errText = (stderr || "").trim();
      try { await Bun.$`rm -f ${pngPath}`.quiet(); } catch {}
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
        try { await Bun.$`rm -f ${pngPath}`.quiet(); } catch {}
        return [commandResult(false, "", "scan_cancelled", 130), null];
      }
      if (msg.startsWith("scan_timeout:")) {
        try { await Bun.$`rm -f ${pngPath}`.quiet(); } catch {}
        return [commandResult(false, "", `Scanner did not respond within ${Math.round(scanTimeout/1000)}s. Check the printer is awake, paper is on glass, then try again.`, 1), null];
      }
      lastExc = exc;
      try { await Bun.$`rm -f ${pngPath}`.quiet(); } catch {}
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
      const img = Bun.file(pngPath).image();
      // higher DPI deserves higher quality slightly
      const q = dpi >= 600 ? 92 : dpi >= 300 ? 90 : 88;
      await img.jpeg({ quality: q }).write(outPath);
      await Bun.$`rm -f ${pngPath}`.quiet();
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
        const img = new Bun.Image(pngBytes);
        await img.jpeg({ quality: dpi >= 600 ? 92 : 90 }).write(tmpJpg);
        const jpgBytes = await Bun.file(tmpJpg).arrayBuffer();
        image = await pdfDoc.embedJpg(jpgBytes);
        await Bun.$`rm -f ${tmpJpg}`.quiet();
      }
      const { width, height } = image.scale(1);
      // DPI-correct display size: pixels -> points at target dpi
      const displayW = (width * 72) / dpi;
      const displayH = (height * 72) / dpi;
      // If embed gave points already shrunk (pdf-lib sometimes returns points at 72dpi), fallback uses min
      // Use the smaller of pixel-derived and pdf-lib size to avoid double scaling
      const baseW = Math.min(width, displayW);
      const baseH = Math.min(height, displayH);
      // Alternative robust: if displayW < width (i.e., dpi >72) we want pixel-derived size; else keep width
      const srcW = displayW < width ? displayW : width;
      const srcH = displayH < height ? displayH : height;
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
      await Bun.$`rm -f ${pngPath}`.quiet();
      return [commandResult(true, outPath), outPath];
    }
  } catch (exc: any) {
    return [commandResult(true, pngPath, `Conversion failed; saved PNG instead: ${exc}`), pngPath];
  }
}
