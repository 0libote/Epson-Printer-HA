import { createDeviceRecovery, identityOf } from "./device/recovery.ts";
import { arpIdentity, cachedDiscoveredPrinter, discoverAdvertisedPrinters, discoverPrinters, identifyPrinter } from "./discover.ts";
import { registerStatusApi } from "./api/status.ts";
import { registerDeviceApi } from "./api/device.ts";
import { createPrinterDeviceService } from "./printer/manager.ts";
import { createOperationLocks } from "./system/process-lock.ts";
import { renderIndex as renderLegacyIndex } from "./api/legacy-view.ts";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { join, basename, extname } from "node:path";
import { mkdirSync, readdirSync, statSync, unlinkSync, rmSync, linkSync, renameSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { registerPrintingApi } from "./api/printing.ts";
import { createScanLibrary, scanRetentionPolicy, ScanStorageError, type ScanReservation } from "./scanning/library.ts";
import { createScanJobStore, isActiveScan, type ScanJob } from "./scanning/jobs.ts";
export type { ScanJob, ScanJobState } from "./scanning/jobs.ts";
import { registerLibraryApi } from "./api/library.ts";
import {
  onStatusInvalidated,
  cupsBackend,
  scannerManager,
  cachedCupsPrinterStatus,
  cachedListJobs,
  cachedPrinterReachable,
  cancelJob,
  clearStatusCaches,
  cupsPrinterStatus,
  localIPv4s,
  printerNetworkHint,
  runCommand,
  scanDocument,
  scannerStatus,
  submitPrint,
  warmDeviceCache,
} from "./core.ts";
import { listPrintHistory } from "./history.ts";
import { getCachedInkLevels, getInkLevels } from "./ink.ts";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export let APP_DIR = process.env.APP_DATA || "/data";
export let SCAN_DIR = join(APP_DIR, "scans");
export let SETTINGS_FILE = join(APP_DIR, "settings.json");
// Printer details are owned 100% by the WebUI (settings.json under APP_DATA).
// Environment variables are intentionally NOT consulted here: env overrides
// used to silently win over dashboard changes, which made edits appear to be
// ignored. Fresh defaults below apply until the user saves real values.
export let DEFAULT_PRINTER_NAME = "Home_Epson_XP2200";
export let DEFAULT_DISPLAY_NAME = "Home Epson XP-2200";
export let DEFAULT_SHARE_PRINTER = true;
export let MAX_UPLOAD_MB = Math.max(1, parsePositiveInt(process.env.MAX_UPLOAD_MB, 128));
export let MAX_SCAN_FILES = Math.max(1, parsePositiveInt(process.env.MAX_SCAN_FILES, 100));
export const SCAN_RETENTION_POLICY = scanRetentionPolicy(process.env.SCAN_RETENTION_POLICY);
const scanLibrary = createScanLibrary({ directory: () => SCAN_DIR, limit: () => MAX_SCAN_FILES, policy: SCAN_RETENTION_POLICY });
const scanReservations = new Map<string, ScanReservation>();
export let CLIENT_HOST_RAW = (process.env.CLIENT_HOST || "").trim();
// CLIENT_HOST is shown to phones/computers in the generated IPP instructions,
// so it must be a bare host — never "host:port" (which would render as
// ipp://host:port:631/...). Normalise defensively: users paste browser bars.
function normalizeClientHost(raw: string): string {
  let v = raw.trim();
  if (!v) return "";
  v = v.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  v = v.split("/")[0].split("?")[0].split("#")[0].trim();
  if (!v) return "";
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    return end > 0 ? v.slice(0, end + 1) : v;
  }
  // Unbracketed IPv6 holds several colons — a port suffix would be ambiguous,
  // so keep it untouched rather than corrupt the address.
  if ((v.match(/:/g) || []).length > 1) return v;
  const m = v.match(/^(.*):(\d{1,5})$/);
  return m ? m[1] : v;
}
export let CLIENT_HOST = normalizeClientHost(CLIENT_HOST_RAW);
export let WEB_USERNAME = process.env.WEB_USERNAME || "";
export let WEB_PASSWORD = process.env.WEB_PASSWORD || "";
// NOTE: there is no session secret in this app — dashboard auth is HTTP Basic
// sent with every request, so no signed cookies/sessions exist to protect.
export let SESSION_COOKIE_SECURE = ["1", "true", "yes", "on"].includes((process.env.SESSION_COOKIE_SECURE || "false").trim().toLowerCase());

export function _setAppDirForTest(dir: string) {
  dashboardStatus?.reset();
  _settingsCache = null;
  _recentScansCache = null;
  scanLibrary.invalidate();
  for (const reservation of scanReservations.values()) reservation.release();
  scanReservations.clear();
  APP_DIR = dir;
  SCAN_DIR = join(dir, "scans");
  SETTINGS_FILE = join(dir, "settings.json");
  try { mkdirSync(APP_DIR, { recursive: true }); } catch {}
  try { mkdirSync(SCAN_DIR, { recursive: true }); } catch {}
}
export function _setAuthForTest(user: string, pass: string) {
  WEB_USERNAME = user;
  WEB_PASSWORD = pass;
}
export function _setClientHostForTest(host: string) { CLIENT_HOST_RAW = host; CLIENT_HOST = normalizeClientHost(host); }
export function _setMaxUploadForTest(mb: number) { MAX_UPLOAD_MB = mb; }

if (Boolean(WEB_USERNAME) !== Boolean(WEB_PASSWORD)) {
  throw new Error("WEB_USERNAME and WEB_PASSWORD must either both be set or both be blank");
}

mkdirSync(APP_DIR, { recursive: true });
mkdirSync(SCAN_DIR, { recursive: true });
// Cleanup stale operation locks from previous crash.
// The scanner lock must always be cleared on boot: in-memory scan jobs do not
// survive a restart, so any leftover .scanner.lock can only be stale
// and would otherwise block scans with "already in progress" for up to 5 min.
// NOTE: legacy Python builds used a *file* lock (fcntl) at the same path while
// Bun uses a *directory* lock (mkdir). Either form — or a crashed mkdir — must
// be removed here with rmSync (handles files and dirs); rmdirSync alone leaves
// a legacy file lock behind and blocks every future scan.
for (const lockName of ["cups-config", "scanner"]) {
  const lockPath = join(APP_DIR, `.${lockName}.lock`);
  try {
    const st = statSync(lockPath);
    if (lockName === "scanner" || Date.now() - st.mtimeMs > 5 * 60 * 1000) {
      try { rmSync(lockPath, { recursive: true, force: true }); } catch {}
    }
  } catch {}
}
// Cleanup orphaned print upload workdirs from crashed requests.
// /print creates uploads/print-<hex>/ per request and removes it in finally,
// but a SIGKILL between mkdir and cleanup leaks the dir (with the uploaded
// file inside). Reap anything older than 1h on boot; active uploads are
// always younger.
try {
  const uploadsDir = join(APP_DIR, "uploads");
  mkdirSync(uploadsDir, { recursive: true });
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const entry of readdirSync(uploadsDir)) {
    if (!entry.startsWith("print-")) continue;
    const p = join(uploadsDir, entry);
    try {
      const st = statSync(p);
      if (st.mtimeMs < cutoff) {
        rmSync(p, { recursive: true, force: true });
      }
    } catch {}
  }
} catch {}

/** Truncate verbose subprocess stderr before it reaches UI/JSON (scanimage
 * can dump MBs of SANE debug — never send that to a browser). */
function truncateErrorText(s: string, max = 800): string {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + "…";
}

const AUTH_FAILURE_LIMIT = 10;
const AUTH_FAILURE_WINDOW_SECONDS = 60;
export const _authFailures = new Map<string, number[]>();
export const AUTH_FAILURE_WINDOW_SECONDS_EXPORT = AUTH_FAILURE_WINDOW_SECONDS;
export const AUTH_FAILURE_LIMIT_EXPORT = AUTH_FAILURE_LIMIT;

function validateIPv4(value: string): string {
  value = value.trim();
  const parts = value.split(".");
  if (parts.length !== 4) throw new Error("Use the printer's normal IPv4 address");
  for (const p of parts) {
    if (!/^\d+$/.test(p)) throw new Error("Use the printer's normal IPv4 address");
    const n = Number.parseInt(p, 10);
    if (n < 0 || n > 255) throw new Error("Use the printer's normal IPv4 address");
  }
  const ip = parts.join(".");
  const first = Number.parseInt(parts[0], 10);
  const last = Number.parseInt(parts[3], 10);
  if (ip === "0.0.0.0" || ip === "127.0.0.1" || ip === "255.255.255.255") throw new Error("Use the printer's normal IPv4 address");
  if (first === 0 || first === 127 || first === 255 || (first >= 224 && first <= 239)) throw new Error("Use the printer's normal IPv4 address");
  if (last === 0 || last === 255) throw new Error("Use the printer's normal IPv4 address");
  return ip;
}

function validateQueueName(value: string): string {
  value = value.trim();
  if (!/^[A-Za-z0-9._-]{1,127}$/.test(value) || value === "." || value === "..") throw new Error("Queue name may only contain letters, numbers, dot, dash and underscore");
  return value;
}

function validateDisplayName(value: string): string {
  value = value.trim().replace(/\s+/g, " ");
  if (!value || value.length > 80) throw new Error("Display name must be between 1 and 80 characters");
  return value;
}

// Cache settings in memory (1s TTL + mtime check) — avoids 4x readFileSync+JSON.parse per request
let _settingsCache: { mtimeMs: number; at: number; data: Record<string, any> } | null = null;
function savedSettingsSync(): Record<string, any> {
  try {
    const st = statSync(SETTINGS_FILE);
    const now = Date.now();
    if (_settingsCache && _settingsCache.mtimeMs === st.mtimeMs && now - _settingsCache.at < 2000) {
      return _settingsCache.data;
    }
    const txt = readFileSync(SETTINGS_FILE, "utf-8");
    const data = JSON.parse(txt);
    const obj = typeof data === "object" && data !== null ? data : {};
    _settingsCache = { mtimeMs: st.mtimeMs, at: now, data: obj };
    return obj;
  } catch {
    // file missing: return cached empty briefly to avoid hot stat failures
    if (_settingsCache && Date.now() - _settingsCache.at < 2000) return _settingsCache.data;
    return {};
  }
}
function _invalidateSettingsCache() { _settingsCache = null; }

function saveSettingsSync(data: Record<string, any>) {
  const tmp = join(APP_DIR, `.settings.${randomBytes(6).toString("hex")}`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  try { renameSync(tmp, SETTINGS_FILE); } catch (e) { try { unlinkSync(tmp); } catch {} throw e; }
  _invalidateSettingsCache();
}

const { operationLocks, clearForTest: _clearOperationLockForTest, removeOperationLockFs, withOperationLock: acquireOperationLock } = createOperationLocks(() => APP_DIR);
async function withOperationLock<T>(name: string, fn: () => Promise<T>) {
 if ((name === "cups-config" && (operationLocks.has("scanner") || operationLocks.has("device"))) || ((name === "scanner" || name === "device") && operationLocks.has("cups-config"))) return { acquired: false } as { acquired: boolean; result?: T };
 if (name === "scanner" && operationLocks.has("device")) return { acquired: false } as { acquired: boolean; result?: T };
 return acquireOperationLock(name, fn);
}
export { _clearOperationLockForTest };

function secureFilename(name: string): string {
  name = basename(name).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!name || name === "." || name === "..") name = "file";
  return name;
}

function validateUploadBuffer(buf: ArrayBuffer, size: number, suffix: string): string | null {
  try {
    const byteLength = (buf as ArrayBuffer).byteLength ?? 0;
    if (size === 0 && byteLength === 0) return "The selected file is empty.";
    if (size === 0 || byteLength === 0) return "The selected file is empty.";
    const prefix = new Uint8Array(buf.slice(0, 16));
    // PDFs must start with %PDF- at offset 0, but some generators prepend a
    // BOM or whitespace. Per spec the header lives within the first 1024
    // bytes, so scan a small window instead of rejecting such files outright.
    if (suffix === ".pdf") {
      const window = new Uint8Array(buf.slice(0, Math.min(byteLength, 1024)));
      const needle = new TextEncoder().encode("%PDF-");
      let found = false;
      outer: for (let i = 0; i + needle.length <= window.length; i++) {
        for (let k = 0; k < needle.length; k++) {
          if (window[i + k] !== needle[k]) continue outer;
        }
        found = true;
        break;
      }
      if (!found) return "That file does not appear to be a valid PDF.";
    }
    if (suffix === ".png" && !startsWith(prefix, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "That file does not appear to be a valid PNG image.";
    if ((suffix === ".jpg" || suffix === ".jpeg") && !(prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff)) return "That file does not appear to be a valid JPEG image.";
    if (suffix === ".txt") {
      const sample = new Uint8Array(buf.slice(0, 65536));
      if (sample.includes(0x00)) return "That file does not appear to be plain text.";
      try { new TextDecoder("utf-8", { fatal: true }).decode(sample); } catch { return "The uploaded file could not be read in the expected format."; }
    }
  } catch { return "The uploaded file could not be read in the expected format."; }
  return null;
}
function startsWith(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length < b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function currentPrinterIp(): string {
  const v = String(savedSettingsSync().printer_ip ?? "").trim();
  if (!v) return "";
  try { return validateIPv4(v); } catch { return ""; }
}
function formatBytes(bytes:number):string{
  if(bytes<1024) return `${bytes} B`;
  if(bytes<1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}
function formatRelativeTime(mtimeMs:number):string{
  const diff = Date.now() - mtimeMs;
  const s = Math.floor(diff/1000);
  if(s<45) return "just now";
  if(s<90) return "a minute ago";
  if(s<45*60) return `${Math.floor(s/60)} min ago`;
  if(s<90*60) return "an hour ago";
  if(s<22*3600) return `${Math.floor(s/3600)} hrs ago`;
  if(s<36*3600) return "a day ago";
  if(s<25*86400) return `${Math.floor(s/86400)} days ago`;
  const d=new Date(mtimeMs); const pad=(n:number)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function scanLibraryChanged() {
  _recentScansCache = null; scanLibrary.invalidate();
  dashboardStatus.refreshScanStorage();
}
export function currentPrinterName(): string {
  const v = String(savedSettingsSync().printer_name ?? DEFAULT_PRINTER_NAME).trim();
  try { return validateQueueName(v); } catch { return DEFAULT_PRINTER_NAME; }
}
export function currentDisplayName(): string {
  const v = String(savedSettingsSync().display_name ?? DEFAULT_DISPLAY_NAME).trim();
  try { return validateDisplayName(v); } catch { return DEFAULT_DISPLAY_NAME; }
}
function networkSharingEnabledSync(): boolean {
  const v = savedSettingsSync().share_printer;
  if (typeof v === "boolean") return v;
  const s = String(v ?? (DEFAULT_SHARE_PRINTER ? "true" : "false")).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(s);
}
function savePrinterIp(ip:string){ const data={...savedSettingsSync()}; if(data.printer_ip !== ip) delete data.printer_identity; data.printer_ip=ip; saveSettingsSync(data); }
async function configureCups(printerIp:string, opts:{printerName?:string|null;displayName?:string|null;sharePrinter?:boolean|null;oldPrinterName?:string}={}):Promise<[boolean,string]> {
 return cupsBackend.configureQueue(printerIp, { printerName: opts.printerName || currentPrinterName(), displayName: opts.displayName || currentDisplayName(),
 sharePrinter: opts.sharePrinter ?? networkSharingEnabledSync(), oldPrinterName: opts.oldPrinterName });
}
// recentScans with mtime cache (5s) — /api/status polls this constantly
let _recentScansCache: { at: number; value: Array<{name:string;path:string}> } | null = null;
function recentScans(limit=10):Array<{name:string;path:string}>{
  const now = Date.now();
  if (_recentScansCache && now - _recentScansCache.at < 5000) return _recentScansCache.value.slice(0, limit);
  try{
    const out=scanLibrary.entries().map(file=>({name:file.name, path:file.path}));
    _recentScansCache={ at: now, value: out };
    return out.slice(0,limit);
  }catch{return [];}
}
export type ScanMeta = { name:string; path:string; size:number; sizeDisplay:string; mtime:number; mtimeMs:number; mtimeRel:string; mtimeIso:string; ext:string; dpiHint?:string };
function listScansDetailed(limit=100):ScanMeta[]{
    const files=scanLibrary.entries().map(file => ({...file, mtime:Math.floor(file.mtimeMs/1000)}));
    const slice=files.slice(0, Math.max(1,limit));
    return slice.map(f=>{
      const d=new Date(f.mtimeMs); const pad=(n:number)=>String(n).padStart(2,"0");
      const iso=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      return { name:f.name, path:f.path, size:f.size, sizeDisplay:formatBytes(f.size), mtime:f.mtime, mtimeMs:f.mtimeMs, mtimeRel:formatRelativeTime(f.mtimeMs), mtimeIso:iso, ext:extname(f.name).toLowerCase() };
    });
}
function validateScanFilename(name:string):string{
  const safe=basename(name).trim();
  if(!safe || safe.startsWith(".") || safe.includes("..") || safe.includes("/") || safe.includes("\\")) throw new Error("Invalid filename");
  if(safe.length>150) throw new Error("Filename too long");
  // allow letters numbers _ - . and space, but not control chars
    if(/[<>:"|?*\x00-\x1F]/.test(safe)) throw new Error("Filename contains invalid characters");
  const ext=extname(safe).toLowerCase();
  if(![".pdf",".png",".jpg",".jpeg"].includes(ext)) throw new Error("Extension must be pdf, png, jpg or jpeg");
  return safe;
}
function sanitizeRename(name:string, originalExt:string):string{
  let s=name.trim().replace(/\s+/g," ").slice(0,100);
  if(!s) throw new Error("Name cannot be empty");
  // strip extension if provided, we will re-add
  const ext=extname(s).toLowerCase();
  let base = s;
  if(ext && [".pdf",".png",".jpg",".jpeg"].includes(ext)) base=s.slice(0, -ext.length);
  else if(ext) throw new Error("Extension must be pdf, png, jpg or jpeg");
  // sanitize base: allow alphanum space _ - dot
    base=base.replace(/[^A-Za-z0-9 _.-]/g,"_").trim();
  if(!base || base==="." || base==="..") base="scan";
  // collapse underscores
  base=base.replace(/_+/g,"_");
  const final=base+originalExt;
  if(final.length>150) throw new Error("Filename too long");
  if(final.startsWith(".")) throw new Error("Invalid filename");
  return validateScanFilename(final);
}

// Scan acquisition stays serialized; only bounded metadata survives restarts.
const scanJobStore = createScanJobStore(() => APP_DIR);
let scanJobs = scanJobStore.getJobs();
let acceptingScans = true;
let activeScanJobId: string | null = null;

export function _getScanJobsForTest(){ scanJobs = scanJobStore.getJobs(); return scanJobs; }
export function _resetScanJobsForTest(){ scanJobs = scanJobStore.getJobs(); scanJobs.clear(); activeScanJobId=null; acceptingScans=true; operationLocks.delete("scanner"); }
// A scan (incl. 600dpi retry + conversion) takes at most ~6-7 min. Anything
// active longer than this is hung/crashed — reap it so one stuck job doesn't
// block all future scans with "already in progress" forever.
export const SCAN_JOB_STALE_MS = 8 * 60 * 1000;
function isScanJobActive(j: ScanJob): boolean {
  return isActiveScan(j);
}
function reapStaleScanJobs(): void {
  scanJobs = scanJobStore.getJobs();
  const now = Date.now();
  let changed = false;
  for (const j of scanJobs.values()) {
    if (!isScanJobActive(j)) continue;
    const age = now - (j.startedAt ?? j.createdAt);
    if (age > SCAN_JOB_STALE_MS && !j.cancelRequested) {
      j.cancelRequested = true;
      try { j.cancelProcess?.(); } catch {}
      j.error = "Scan timed out. Check the printer before trying again.";
      if (activeScanJobId === j.id) {
        // Retain ownership until the acquisition promise/process has settled.
        j.progress = "Stopping timed-out scan";
      } else {
        j.state = "error"; j.progress = "Failed"; j.finishedAt = now;
      }
      changed = true;
    }
  }
  if (changed) scanJobStore.checkpoint();
  // activeScanJobId must never point at a finished/missing job, or every new
  // scan would be rejected as "already in progress".
  if (activeScanJobId) {
    const active = scanJobs.get(activeScanJobId);
    if (!active || !isScanJobActive(active)) activeScanJobId = null;
  }
}
function findActiveScanJob(): ScanJob | null {
  reapStaleScanJobs();
  for (const j of scanJobs.values()) {
    if (isScanJobActive(j)) return j;
  }
  if (activeScanJobId) {
    const active = scanJobs.get(activeScanJobId);
    if (active && isScanJobActive(active)) return active;
  }
  return null;
}
function scannerLockPath(): string {
  // Single canonical path for the scanner mutex. (Older code spelled it as
  // join(SCAN_DIR, "..", ".scanner.lock") in some places — same inode, but
  // one spelling avoids confusion and missed cleanups.)
  return join(APP_DIR, ".scanner.lock");
}
function clearStaleScannerFsLock(): void {
  if (activeScanJobId || operationLocks.has("scanner")) return;
  const lockPath = scannerLockPath();
  try {
    const st = statSync(lockPath);
    if (Date.now() - st.mtimeMs > SCAN_JOB_STALE_MS) {
      removeOperationLockFs(lockPath);
    }
  } catch {}
}
function createScanJob(printerIp:string, dpi:number, mode:string, fmt:string, requestKey?:string):ScanJob{
  scanJobs = scanJobStore.getJobs();
  const id=randomBytes(6).toString("hex");
  const job:ScanJob={ id, state:"queued", printerIp, dpi, mode, fmt, createdAt:Date.now(), cancelRequested:false, progress:"Queued", requestKey };
  scanJobs.set(id, job);
  try { scanJobStore.save(); } catch (error) { scanJobs.delete(id); throw error; }
  return job;
}
export function shutdownScans() {
  acceptingScans = false;
  scanJobs = scanJobStore.getJobs();
  for (const job of scanJobs.values()) {
    if (!isScanJobActive(job)) continue;
    job.cancelRequested = true;
    job.progress = "Stopping for a hub restart";
    try { job.cancelProcess?.(); } catch {}
    if (job.state === "queued") { job.state = "cancelled"; job.error = "Scan stopped because the hub is restarting."; job.finishedAt = Date.now(); }
  }
  scanJobStore.checkpoint();
}
async function executeScanJob(job:ScanJob){
  if (job.cancelRequested || job.state !== "queued") return;
  if(activeScanJobId && activeScanJobId!==job.id){
    job.state="error"; job.error="A scan is already in progress. Wait for it to finish before starting another."; job.finishedAt=Date.now(); return;
  }
  activeScanJobId=job.id;
  job.state="scanning"; job.startedAt=Date.now(); job.progress="Contacting scanner";
  scanJobStore.checkpoint();
  try {
    // warm cache first for speed
    await warmDeviceCache(job.printerIp).catch(()=>{});
    if (job.cancelRequested) {
      job.state=job.error ? "error" : "cancelled"; job.error ||= "Scan cancelled."; job.progress=job.state === "error" ? "Failed" : "Cancelled"; job.finishedAt=Date.now();
      return;
    }
    const lock=await withOperationLock("scanner", async()=>{
      job.progress="Scanning the document"; scanJobStore.checkpoint();
      const [result, path]=await scanDocument(job.printerIp, SCAN_DIR, {dpi:job.dpi, mode:job.mode, fmt:job.fmt, control:{
        isCancelled:()=>job.cancelRequested,
        registerProcess:(process)=>{ job.cancelProcess=()=>{ try{ process.kill(); }catch{} }; if (job.cancelRequested) job.cancelProcess(); },
        clearProcess:()=>{ job.cancelProcess=undefined; },
        setProgress:(progress)=>{ job.state="converting"; job.progress=progress; scanJobStore.checkpoint(); },
      }});
      clearStatusCaches();
      if(job.cancelRequested || result.stderr === "scan_cancelled"){
        job.state=job.error ? "error" : "cancelled"; job.error ||= "Scan cancelled."; job.progress=job.state === "error" ? "Failed" : "Cancelled"; job.finishedAt=Date.now();
        return result;
      }
      if(result.ok && path){
        scanReservations.get(job.id)?.commit(basename(path));
        scanLibraryChanged();
        job.state="done"; job.resultPath=path; job.resultName=basename(path); job.progress="Done"; job.finishedAt=Date.now();
        // clear thumb cache for new file
      } else {
        job.state="error"; job.error=truncateErrorText(result.stderr)||"Scan failed."; job.progress="Failed"; job.finishedAt=Date.now();
      }
      return result;
    });
    if(!lock.acquired){
      job.state="error"; job.error="A scan is already in progress. Wait for it to finish before starting another."; job.finishedAt=Date.now();
    }
  } catch(e:any){
    job.state=job.cancelRequested && !job.error ? "cancelled" : "error";
    job.error ||= job.cancelRequested ? "Scan cancelled." : truncateErrorText(String(e?.message||e)) || "Scan failed.";
    job.progress=job.state === "cancelled" ? "Cancelled" : "Failed";
    job.finishedAt=Date.now();
  } finally {
    job.cancelProcess=undefined;
    if(activeScanJobId===job.id) activeScanJobId=null;
    scanJobStore.checkpoint();
  }
}
function clientSetup(printerName:string, hostHeader:string){
  let host=CLIENT_HOST||hostHeader;
  if(!CLIENT_HOST){
    if(host.startsWith("[")) host=host.split("]")[0]+"]";
    else host=host.split(":")[0];
  }
  const queue_path=`printers/${printerName}`;
  return {host, ipp_uri:`ipp://${host}:631/${queue_path}`, http_uri:`http://${host}:631/${queue_path}`, queue_path};
}
function getFlash(c:any):Array<{category:string;message:string}>{
  const raw=getCookie(c,"flash");
  if(!raw) return [];
  try{return JSON.parse(Buffer.from(raw,"base64").toString("utf-8"));}catch{return [];}
}
function setFlash(c:any, category:string, message:string){
  const existing=getFlash(c);
  existing.push({category,message});
  const encoded=Buffer.from(JSON.stringify(existing)).toString("base64");
  setCookie(c,"flash",encoded,{path:"/", httpOnly:false, sameSite:"Lax", secure: SESSION_COOKIE_SECURE});
}
function consumeFlash(c:any):Array<{category:string;message:string}>{
  const msgs=getFlash(c);
  if(msgs.length) deleteCookie(c,"flash",{path:"/"});
  return msgs;
}
function getCsrfToken(c:any):string{
  let token=getCookie(c,"csrf_token");
  // Double-submit pattern: JS must read the token (api.ts ensureCsrf) so the
  // cookie is intentionally readable (httpOnly:false, SameSite=Lax). The
  // server still validates token === cookie on every mutation.
  if(!token){ token=randomBytes(32).toString("hex"); setCookie(c,"csrf_token",token,{path:"/", httpOnly:false, sameSite:"Lax", secure:SESSION_COOKIE_SECURE});}
  return token;
}
function wantsJson(c:any):boolean{
  const accept=c.req.header("accept")||"";
  const xhr=c.req.header("x-requested-with")||"";
  return accept.includes("application/json") || xhr.toLowerCase()==="xmlhttprequest";
}
function isCsrfValid(c:any, body:any):boolean{
  const token=String(body?.["_csrf_token"]||c.req.header("x-csrf-token")||c.req.header("X-CSRF-Token")||"");
  const expected=getCookie(c,"csrf_token")||"";
  return !!expected && token===expected;
}
// Mutation endpoints accept dashboard FormData as well as JSON clients.
// parseBody() throws on a JSON content-type and req.json() throws on an empty
// form post, so pick by header and never let a body quirk become a 500.
async function readMutationBody(c:any):Promise<any>{
  const ct=c.req.header("content-type")||"";
  if(ct.includes("application/json")){
    try{
      const j=await c.req.json();
      return (j && typeof j === "object" && !Array.isArray(j)) ? j : {};
    }catch{ return {}; }
  }
  try{ return await c.req.parseBody(); }catch{ return {}; }
}
// Cache SPA shell by mtime — avoids re-reading index.html on every GET /
let _spaCache: { path: string; mtimeMs: number; html: string } | null = null;
async function tryServeSpa(c:any):Promise<Response|null>{
  const candidates=[join(process.cwd(),"public","index.html"), join(process.cwd(),"dist","index.html")];
  for(const cand of candidates){
    try{
      const f=Bun.file(cand);
      if(await f.exists()){
        let html: string;
        try {
          const st = statSync(cand);
          if (_spaCache && _spaCache.path === cand && _spaCache.mtimeMs === st.mtimeMs) {
            html = _spaCache.html;
          } else {
            html = await f.text();
            _spaCache = { path: cand, mtimeMs: st.mtimeMs, html };
          }
        } catch { html = await f.text(); }
        let csrf: string;
        try{ csrf=(c as any).get("csrf_token_tmp") || getCookie(c,"csrf_token") || getCsrfToken(c); }catch{ csrf=getCsrfToken(c); }
        // inject csrf for legacy tests if missing
        if(!html.includes('name="_csrf_token"')){
          html=html.replace("</body>", `<input type="hidden" name="_csrf_token" value="${escapeHtml(csrf)}" hidden /></body>`);
          if(html.includes("</head>")) html=html.replace("</head>", `<meta name="csrf-token" content="${escapeHtml(csrf)}" /></head>`);
        } else {
          html=html.replace(/name="_csrf_token" value="[^"]*"/, `name="_csrf_token" value="${escapeHtml(csrf)}"`);
        }
        const printerIp=currentPrinterIp();
        if(printerIp && !html.includes("data-printer-ip")){
          html=html.replace("<body", `<body data-printer-ip="${escapeHtml(printerIp)}" data-poll-interval="3000"`);
        }
        // Inject flash messages for legacy POST-redirect-GET tests (and for SPA error visibility)
        const flashes=consumeFlash(c);
        if(flashes.length){
          const flashHtml=flashes.map(f=>`<div class="notice ${escapeHtml(f.category)}" role="status"><span class="notice-icon" aria-hidden="true">${f.category==="success"?"✓":"!"}</span><span>${escapeHtml(f.message)}</span></div>`).join("");
          // place flashes right after <div id="root"> so tests can find substring
          if(html.includes('<div id="root"></div>')){
            html=html.replace('<div id="root"></div>', `<div id="root"></div><div id="flash-root">${flashHtml}</div>`);
          } else {
            html=html.replace("</body>", `${flashHtml}</body>`);
          }
        }
        return c.html(html);
      }
    }catch{}
  }
  return null;
}
function authRequired():boolean{ return Boolean(WEB_USERNAME); }
function authValid(c:any):boolean{
  const header=c.req.header("authorization")||"";
  if(!header.startsWith("Basic ")) return false;
  try{
    const decoded=Buffer.from(header.slice(6),"base64").toString("utf-8");
    const idx=decoded.indexOf(":");
    const user=idx>=0?decoded.slice(0,idx):decoded;
    const pass=idx>=0?decoded.slice(idx+1):"";
    return user===WEB_USERNAME && pass===WEB_PASSWORD;
  }catch{return false;}
}
// Header stamped by server.ts from the TCP socket (Bun server.requestIP).
// The wrapper overwrites any client-sent value, so unlike X-Forwarded-For
// this cannot be spoofed to dodge (or trigger) auth throttling.
export const SERVER_CLIENT_IP_HEADER = "x-epson-client-ip";
function clientIp(c:any):string{
  const direct=String(c.req.header(SERVER_CLIENT_IP_HEADER)||"").trim();
  if(direct) return direct.split(",")[0].trim() || "unknown";
  // Fallback for reverse-proxy deployments and direct app.fetch callers
  // (tests): first entry only, so a spoofed chain can't smuggle extra keys.
  const fwd=c.req.header("x-forwarded-for")||c.req.header("x-real-ip")||"unknown";
  return String(fwd).split(",")[0].trim()||"unknown";
}
function authFailureState(c:any, recordFailure=false):boolean{
  const ip=clientIp(c);
  const now=Date.now()/1000;
  const cutoff=now - AUTH_FAILURE_WINDOW_SECONDS;
  let recent=( _authFailures.get(ip)||[] ).filter(t=>t>=cutoff);
  if(recordFailure) recent.push(now);
  if(recent.length) {
    _authFailures.set(ip,recent);
    // bound map: evict oldest entry when too many distinct IPs (prevents leak)
    if (_authFailures.size > 500) {
      const oldest = _authFailures.keys().next().value;
      if (oldest !== undefined && oldest !== ip) _authFailures.delete(oldest);
    }
  } else _authFailures.delete(ip);
  return recent.length>=AUTH_FAILURE_LIMIT;
}
export const app=new Hono();
app.use("*", async(c,next)=>{
  const start = Date.now();
  if(c.req.method==="GET"){
    const t=getCsrfToken(c);
    try{ (c as any).set("csrf_token_tmp", t); }catch{}
  }
  if (c.req.path.startsWith("/api/") || c.req.path === "/") c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  await next();
  // Slow-request log: the hub should stay <1s for cached polls; anything
  // slower usually means CUPS/scanimage is wedged — surface it in docker logs.
  try {
    const ms = Date.now() - start;
    if (ms > 2000) {
      console.warn(`[web] slow request ${c.req.method} ${c.req.path} ${ms}ms`);
    }
  } catch {}
});

function requireAuth(c:any):Response|null{
  if(!authRequired()) return null;
  if(authFailureState(c)) return new Response("Too many authentication attempts",{status:429, headers:{"Retry-After":String(AUTH_FAILURE_WINDOW_SECONDS)}});
  if(!authValid(c)){ authFailureState(c,true); return new Response("Authentication required",{status:401, headers:{"WWW-Authenticate":'Basic realm="Epson Hub"'}});}
  _authFailures.delete(clientIp(c));
  return null;
}
function escapeHtml(s:string):string{ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;");}

async function renderIndex(c:any):Promise<string> {
 return renderLegacyIndex(c, { currentPrinterIp, currentPrinterName, currentDisplayName, networkSharingEnabledSync,
 recentScans, clientSetup, getCsrfToken, consumeFlash, escapeHtml, MAX_UPLOAD_MB });
}

app.get("/api/csrf", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  // Reuse the middleware-issued token when present: calling getCsrfToken()
  // again would mint a second token and emit two Set-Cookie headers with
  // different values, leaving strict clients with a mismatched pair.
  let token: string;
  try { token=(c as any).get("csrf_token_tmp") || getCookie(c,"csrf_token") || getCsrfToken(c); }catch{ token=getCsrfToken(c); }
  return c.json({ csrf_token: token });
});

app.get("/", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  // Try to serve Vite SPA if built (public/index.html) – inject csrf for legacy compat
  const spa=await tryServeSpa(c);
  if(spa) return spa;
  const html=await renderIndex(c);
  return c.html(html);
});

app.post("/setup", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const body=await c.req.parseBody();
  if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  const rawIp=String((body as any)["printer_ip"]||"");
  let printerIp:string;
  try{ printerIp=validateIPv4(rawIp);}catch(e:any){
    const msg=(e as any).message;
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 400);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  let setupOk=false; let setupMsg="";
  const lock=await withOperationLock("cups-config", async()=>{
    const [ok,log]=await configureCups(printerIp);
    if(ok){ savePrinterIp(printerIp); const selected = cachedDiscoveredPrinter(printerIp); if(selected) { const data = savedSettingsSync(); data.printer_identity = identityOf({ ...selected, mac: selected.mac || arpIdentity(printerIp) }); saveSettingsSync(data); } clearStatusCaches(); setupOk=true; setupMsg=`Printer saved at ${printerIp}. CUPS is configured.`; if(!wantsJson(c)) setFlash(c,"success",setupMsg); }
    else { setupOk=false; setupMsg=`CUPS setup failed; the previous printer setting was kept: ${(log||"unknown error").slice(-800)}`; if(!wantsJson(c)) setFlash(c,"error",setupMsg); }
  });
  if(!lock.acquired){
    const msg="Printer settings are already being changed. Wait for that operation to finish.";
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 409);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  if(wantsJson(c)) return c.json({ ok: setupOk, message: setupMsg }, setupOk?200:500);
  return c.redirect("/",302);
});

app.post("/client-settings", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const printerIp=currentPrinterIp();
  if(!printerIp){
    const msg="Set up the physical printer first.";
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 400);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  const body=await c.req.parseBody();
  if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  let printerName:string, displayName:string;
  try{
    printerName=validateQueueName(String((body as any)["printer_name"]||""));
    displayName=validateDisplayName(String((body as any)["display_name"]||""));
  }catch(e:any){
    const msg=(e as any).message;
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 400);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  const sharePrinter=(body as any)["share_printer"]==="on";
  let okResult=false; let msgResult="";
  const lock=await withOperationLock("cups-config", async()=>{
    const oldName=currentPrinterName();
    const [ok,log]=await configureCups(printerIp,{printerName, displayName, sharePrinter, oldPrinterName:oldName});
    if(!ok){ okResult=false; msgResult=`Network printing settings were not applied: ${(log||"unknown error").slice(-800)}`; if(!wantsJson(c)) setFlash(c,"error",msgResult); return; }
    const data=savedSettingsSync();
    data.printer_name=printerName;
    data.display_name=displayName;
    data.share_printer=sharePrinter;
    saveSettingsSync(data);
    clearStatusCaches();
    okResult=true; msgResult="Network printing settings applied.";
    if(!wantsJson(c)) setFlash(c,"success",msgResult);
  });
  if(!lock.acquired){
    const msg="Printer settings are already being changed. Wait for that operation to finish.";
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 409);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  if(wantsJson(c)) return c.json({ ok: okResult, message: msgResult, error: okResult?undefined:msgResult }, okResult?200:500);
  return c.redirect("/",302);
});

registerPrintingApi(app, {
  auth: requireAuth, ip: currentPrinterIp, queue: currentPrinterName, dataDir: () => APP_DIR,
  uploadLimit: () => MAX_UPLOAD_MB, csrf: isCsrfValid, readBody: readMutationBody, wantsJson, flash: setFlash,
  filename: secureFilename, validateUpload: validateUploadBuffer,
  queueStatus: (...args) => cupsPrinterStatus(...args), submit: (...args) => submitPrint(...args),
  resume: queue => cupsBackend.resumeQueue(queue),
  lock: action => withOperationLock("device", action), invalidate: clearStatusCaches,
});

app.post("/scan", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  if (!acceptingScans) return c.json({ok:false,error:"The hub is restarting. Try again shortly."},503);
  const printerIp=currentPrinterIp();
  if(!printerIp){
    const msg="Set up the printer first.";
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 400);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  const body=await c.req.parseBody();
  if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  let dpi=Number.parseInt(String((body as any)["dpi"]||"300"),10);
  if(![150,200,300,600].includes(dpi)){
    const msg="DPI must be 150, 200, 300 or 600.";
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 400);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  if (findActiveScanJob()) {
    const error="A scan is already in progress. Wait for it to finish before starting another.";
    if(wantsJson(c)) return c.json({ok:false,error},409);
    setFlash(c,"error",error); return c.redirect("/",302);
  }
  let scanOk=false; let scanMsg=""; let scanPath:string|null=null;
  let reservation: ScanReservation;
  try { reservation = scanLibrary.reserve(true); }
  catch (error) {
    const message=error instanceof ScanStorageError ? error.message : "Scan storage is unavailable.";
    if(wantsJson(c)) return c.json({ok:false,error:message}, error instanceof ScanStorageError ? error.status : 503);
    setFlash(c,"error",message); return c.redirect("/",302);
  }
  let lock;
  try { lock=await withOperationLock("scanner", async()=>{
    const [result, path]=await scanDocument(printerIp, SCAN_DIR, {dpi, mode:String((body as any)["mode"]||"Color"), fmt:String((body as any)["format"]||"pdf")});
    clearStatusCaches();
    scanPath=path;
    if(result.ok && path){ reservation.commit(basename(path)); scanOk=true; scanMsg=truncateErrorText(result.stderr)||`Scan saved as ${basename(path)}.`; if(!wantsJson(c)) setFlash(c,"success", scanMsg); }
    else { scanOk=false; scanMsg=truncateErrorText(result.stderr)||"Scan failed."; if(!wantsJson(c)) setFlash(c,"error", scanMsg); }
  }); } finally { reservation.release(); scanLibraryChanged(); }
  if(!lock.acquired){
    const msg="A scan is already in progress. Wait for it to finish before starting another.";
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 409);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  if(wantsJson(c)) return c.json({ ok: scanOk, message: scanMsg, path: scanPath, error: scanOk?undefined:scanMsg }, scanOk?200:500);
  return c.redirect("/",302);
});

app.post("/jobs/:job_id/cancel", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const body=await c.req.parseBody();
  if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  const jobId=c.req.param("job_id");
  const result=await cancelJob(jobId);
  clearStatusCaches();
  if(wantsJson(c)) return c.json({ ok: result.ok, message: result.ok?"Job cancelled.":result.stderr||"Could not cancel job.", error: result.ok?undefined:(result.stderr||"Could not cancel job.") }, result.ok?200:500);
  setFlash(c, result.ok?"success":"error", result.ok?"Job cancelled.":result.stderr||"Could not cancel job.");
  return c.redirect("/",302);
});

app.get("/scans/:filename", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const filename=c.req.param("filename");
  const safe=basename(filename);
  if(!safe || safe.startsWith(".") || safe.includes("..")) return c.text("Not found",404);
  const path=join(SCAN_DIR, safe);
  const file=Bun.file(path);
  if(!(await file.exists())) return c.text("Not found",404);
  const ext=extname(safe).toLowerCase();
  const mimeMap:Record<string,string>={".pdf":"application/pdf", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg"};
  const contentType=mimeMap[ext] || (file as any).type || "application/octet-stream";
  const inline=c.req.query("preview")==="1" || c.req.query("inline")==="1";
  // Never interpolate a raw filename into Content-Disposition: strip quotes,
  // backslashes and control characters (header injection) and offer an
  // RFC 5987 encoded fallback for non-ASCII names.
  const cleanName=basename(safe).replace(/[\x00-\x1F\x7F"\\]/g, "_").slice(0, 150) || "scan";
  const encodedName=encodeURIComponent(safe).replace(/'/g, "%27");
  const disp=`${inline?"inline":"attachment"}; filename="${cleanName}"; filename*=UTF-8''${encodedName}`;
  return new Response(file.stream(), {headers:{"Content-Disposition":disp, "Content-Type": contentType, "Cache-Control":"private, max-age=60"}});
});

// ── new scan library API ──
registerLibraryApi(app, {
  auth: requireAuth, csrf: isCsrfValid, readBody: readMutationBody,
  directory: () => SCAN_DIR, outputName: sanitizeRename,
  reserve: () => scanLibrary.reserve(),
  lock: action => withOperationLock("scan-library", action),
  invalidate: scanLibraryChanged,
});

app.get("/api/scans", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  let limit=100;
  try{limit=Number.parseInt(c.req.query("limit")||"100",10);}catch{limit=100;}
  if(Number.isNaN(limit)) limit=100;
  limit=Math.max(1, Math.min(limit, 500));
  try {
    const allScans = listScansDetailed(Number.MAX_SAFE_INTEGER);
    const search = (c.req.query("q") || "").slice(0, 200).trim().toLowerCase();
    const sort = c.req.query("sort") || "newest";
    const filtered = allScans.filter(scan => !search || scan.name.toLowerCase().includes(search));
    const order = (a: ScanMeta,b: ScanMeta) => a.name.localeCompare(b.name);
    if (sort === "oldest") filtered.sort((a,b) => a.mtimeMs-b.mtimeMs || order(a,b));
    else if (sort === "name") filtered.sort(order);
    else if (sort === "size") filtered.sort((a,b) => b.size-a.size || order(a,b));
    else if (sort !== "newest") return c.json({ok:false,error:"Invalid scan sort order."},400);
    const offsetText = c.req.query("offset") || "0";
    if (!/^\d+$/.test(offsetText) || !Number.isSafeInteger(Number(offsetText))) return c.json({ok:false,error:"Invalid scan offset."},400);
    const offset = Number(offsetText);
    const page = filtered.slice(offset, offset + limit);
    return c.json({ scans: page, total: allScans.length, matched: filtered.length, limit, offset,
      next_offset: offset + page.length < filtered.length ? offset + page.length : null,
      max: MAX_SCAN_FILES, storage: scanLibrary.usage() });
  } catch (error) {
    console.error("[scans] Could not read saved scans", error);
    return c.json({ok:false,error:"Saved scans are temporarily unavailable. Check the hub's data volume and try again."},503);
  }
});

app.get("/api/scans/:filename/thumb", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const filename=c.req.param("filename");
  const safe=basename(filename);
  if(!safe || safe.startsWith(".") || safe.includes("..")) return c.text("Not found",404);
  const ext=extname(safe).toLowerCase();
  if(ext===".pdf") return c.text("No thumbnail for PDF",404);
  const path=join(SCAN_DIR, safe);
  const file=Bun.file(path);
  if(!(await file.exists())) return c.text("Not found",404);
  // on-demand thumb cache .thumb-name.webp
  const thumbName=`.thumb-${safe}.webp`;
  const thumbPath=join(SCAN_DIR, thumbName);
  try{
    const thumbFile=Bun.file(thumbPath);
    if(await thumbFile.exists()){
      const st=statSync(thumbPath); const srcSt=statSync(path);
      if(st.mtimeMs >= srcSt.mtimeMs){
        return new Response(thumbFile.stream(),{headers:{"Content-Type":"image/webp","Cache-Control":"private, max-age=3600"}});
      }
    }
  }catch{}
  try{
    // try Bun.Image resize (may not be available in test env)
    const srcBytes=await file.arrayBuffer();
    // quick check: if file too small skip
    if(srcBytes.byteLength>0){
      const img=new (Bun as any).Image(srcBytes);
      // Bun.Image.resize takes positional width (resize(180)), not an object.
      await img.resize(180).webp({ quality: 70 }).write(thumbPath);
      const thumbFile=Bun.file(thumbPath);
      if(await thumbFile.exists()){
        return new Response(thumbFile.stream(),{headers:{"Content-Type":"image/webp","Cache-Control":"private, max-age=3600"}});
      }
    }
  }catch(e){
    // fallback: serve original with resize header (client will scale)
  }
  // fallback: redirect to original with inline preview
  const mimeMap:Record<string,string>={".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp"};
  const ct=mimeMap[ext]||"image/png";
  return new Response(file.stream(),{headers:{"Content-Type": ct, "Cache-Control":"private, max-age=300"}});
});

app.delete("/api/scans/:filename", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  // CSRF via header for JSON DELETE
  const csrfHeader=c.req.header("x-csrf-token")||c.req.header("X-CSRF-Token")||"";
  const expected=getCookie(c,"csrf_token")||"";
  if(!expected || csrfHeader!==expected){
    // also allow body token via query? For DELETE we require header
    return c.text("Invalid or missing CSRF token",400);
  }
  const filename=c.req.param("filename");
  let safe:string;
  try{ safe=validateScanFilename(filename);}catch(e:any){ return c.json({ok:false, error:e.message},400);}
  const path=join(SCAN_DIR, safe);
  try{
    unlinkSync(path);
  }catch(e:any){
    if(e?.code === "ENOENT") return c.json({ok:false, error:"File not found"},404);
    return c.json({ok:false, error:String(e)},500);
  }
  try{ unlinkSync(join(SCAN_DIR, `.thumb-${safe}.webp`)); }catch{}
  scanLibraryChanged();
  return c.json({ok:true, message:`Deleted ${safe}`});
});

app.post("/api/scans/:filename/rename", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const filename=c.req.param("filename");
  let safe:string;
  try{ safe=validateScanFilename(filename);}catch(e:any){ return c.json({ok:false, error:e.message},400);}
  const oldPath=join(SCAN_DIR, safe);
  let body:any={};
  const ct=c.req.header("content-type")||"";
  if(ct.includes("application/json")){
    try{ body=await c.req.json(); }catch{ body={};}
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ok:false, error:"Expected a JSON object"},400);
    if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  } else {
    body=await c.req.parseBody();
    if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  }
  const newNameRaw=String(body["name"]||body["newName"]||"").trim();
  if(!newNameRaw) return c.json({ok:false, error:"New name is required"},400);
  const origExt=extname(safe).toLowerCase();
  let newSafe:string;
  try{ newSafe=sanitizeRename(newNameRaw, origExt);}catch(e:any){ return c.json({ok:false, error:e.message},400);}
  if(newSafe===safe) return c.json({ok:true, name:newSafe, message:"Name unchanged"});
  const newPath=join(SCAN_DIR, newSafe);
  try{
    linkSync(oldPath, newPath);
    unlinkSync(oldPath);
    // move thumb if exists
    try{ renameSync(join(SCAN_DIR, `.thumb-${safe}.webp`), join(SCAN_DIR, `.thumb-${newSafe}.webp`)); }catch(e:any){ if(e?.code !== "ENOENT") throw e; }
  }catch(e:any){
    if(e?.code === "EEXIST") return c.json({ok:false, error:"A file with that name already exists"},409);
    if(e?.code === "ENOENT") return c.json({ok:false, error:"File not found"},404);
    return c.json({ok:false, error:String(e)},500);
  }
  scanLibraryChanged();
  scanJobStore.renameResult(safe, newSafe);
  return c.json({ok:true, name:newSafe, oldName:safe});
});

// legacy form handlers for rename/delete (non-JS fallback)
app.post("/scans/:filename/delete", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const body=await c.req.parseBody();
  if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  const filename=c.req.param("filename");
  let safe:string;
  try{ safe=validateScanFilename(filename);}catch(e:any){ if(wantsJson(c)) return c.json({ok:false, error:(e as any).message},400); setFlash(c,"error",(e as any).message); return c.redirect("/",302); }
  const path=join(SCAN_DIR, safe);
  try{ unlinkSync(path); try{ unlinkSync(join(SCAN_DIR, `.thumb-${safe}.webp`)); }catch{} }catch(e:any){
    const msg=String(e);
    if(e?.code === "ENOENT"){
      if(wantsJson(c)) return c.json({ok:false, error:"File not found"},404);
      setFlash(c,"error","File not found"); return c.redirect("/",302);
    }
    if(wantsJson(c)) return c.json({ok:false, error:msg},500);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  scanLibraryChanged();
  const msg=`Deleted ${safe}`;
  if(wantsJson(c)) return c.json({ok:true, message:msg});
  setFlash(c,"success",msg); return c.redirect("/",302);
});
app.post("/scans/:filename/rename", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const body=await c.req.parseBody();
  if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  const filename=c.req.param("filename");
  let safe:string;
  try{ safe=validateScanFilename(filename);}catch(e:any){ if(wantsJson(c)) return c.json({ok:false, error:(e as any).message},400); setFlash(c,"error",(e as any).message); return c.redirect("/",302); }
  const newNameRaw=String((body as any)["name"]||"").trim();
  if(!newNameRaw){
    const msg="New name is required";
    if(wantsJson(c)) return c.json({ok:false, error:msg},400);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  const origExt=extname(safe).toLowerCase();
  let newSafe:string;
  try{ newSafe=sanitizeRename(newNameRaw, origExt);}catch(e:any){ if(wantsJson(c)) return c.json({ok:false, error:(e as any).message},400); setFlash(c,"error",(e as any).message); return c.redirect("/",302); }
  const newPath=join(SCAN_DIR, newSafe);
  try{
    linkSync(join(SCAN_DIR,safe), newPath);
    unlinkSync(join(SCAN_DIR,safe));
    const oldThumb=join(SCAN_DIR, `.thumb-${safe}.webp`);
    const newThumb=join(SCAN_DIR, `.thumb-${newSafe}.webp`);
    try{ renameSync(oldThumb, newThumb); }catch(e:any){ if(e?.code !== "ENOENT") throw e; }
  }catch(e:any){
    const msg=String(e);
    if(e?.code === "EEXIST"){
      if(wantsJson(c)) return c.json({ok:false, error:"A file with that name already exists"},409);
      setFlash(c,"error","A file with that name already exists"); return c.redirect("/",302);
    }
    if(e?.code === "ENOENT"){
      if(wantsJson(c)) return c.json({ok:false, error:"File not found"},404);
      setFlash(c,"error","File not found"); return c.redirect("/",302);
    }
    if(wantsJson(c)) return c.json({ok:false, error:msg},500);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  scanJobStore.renameResult(safe, newSafe);
  scanLibraryChanged();
  const msg=`Renamed to ${newSafe}`;
  if(wantsJson(c)) return c.json({ok:true, name:newSafe});
  setFlash(c,"success",msg); return c.redirect("/",302);
});

// ── async scan job API ──
app.post("/api/scan", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  if (!acceptingScans) return c.json({ok:false, error:"The hub is restarting. Try again shortly."},503);
  const printerIp=currentPrinterIp();
  if(!printerIp){
    const msg="Set up the printer first.";
    return c.json({ ok:false, error: msg }, 400);
  }
  // CSRF check: support JSON + form
  const ct=c.req.header("content-type")||"";
  let body:any={};
  if(ct.includes("application/json")){
    try{ body=await c.req.json(); }catch{ body={};}
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ok:false, error:"Expected a JSON object"},400);
    if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  } else {
    body=await c.req.parseBody();
    if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  }
  const dpi=Number(body["dpi"] ?? 300);
  let mode=String(body["mode"]||"Color");
  let fmt=String(body["format"]||body["fmt"]||"pdf");
  if(![150,200,300,600].includes(dpi)){
    return c.json({ ok:false, error:"DPI must be 150, 200, 300 or 600." }, 400);
  }
  if(!["Color","Gray","Lineart"].includes(mode)) return c.json({ ok:false, error:"Invalid scan mode" }, 400);
  fmt=fmt.toLowerCase(); if(!["pdf","png","jpg","jpeg"].includes(fmt)) return c.json({ ok:false, error:"Invalid scan format" }, 400);
  const requestKey = String(body.submission_id ?? "");
  if (requestKey && !/^[A-Za-z0-9_-]{16,80}$/.test(requestKey)) return c.json({ok:false,error:"Invalid submission ID."},400);
  scanJobs = scanJobStore.getJobs();
  if (requestKey) {
    const previous = [...scanJobs.values()].find(job => job.requestKey === requestKey);
    if (previous) {
      if (previous.printerIp !== printerIp || previous.dpi !== dpi || previous.mode !== mode || previous.fmt !== fmt) return c.json({ok:false,error:"This submission ID belongs to a scan with different settings."},409);
      return c.json({ok:true,jobId:previous.id,state:previous.state,replayed:true,pollUrl:`/api/scan/jobs/${previous.id}`},202);
    }
  }
  // Drop hung jobs (see SCAN_JOB_STALE_MS) and clear a dangling activeScanJobId
  // so one crashed scan can't block everything forever.
  reapStaleScanJobs();
  clearStaleScannerFsLock();
  const force = String((body as any)["force"] ?? c.req.query("force") ?? "").toLowerCase() === "true" || String((body as any)["force"] ?? "") === "1" || c.req.query("force") === "1";
  let blocker = findActiveScanJob();
  if (blocker && force) {
    blocker.cancelRequested = true;
    blocker.progress = "Cancelling";
    try { blocker.cancelProcess?.(); } catch {}
    if (blocker.state === "queued") {
      blocker.state = "cancelled";
      blocker.finishedAt = Date.now();
      blocker = null;
    }
    scanJobStore.checkpoint();
    // Running jobs retain the hardware lock until their process exits.
  }
  if(blocker){
    const elapsedS = Math.floor((Date.now() - (blocker.startedAt ?? blocker.createdAt)) / 1000);
    return c.json({ ok:false, error:"A scan is already in progress. Wait for it to finish before starting another.", jobId:blocker.id, state:blocker.state, elapsed:elapsedS }, 409);
  }
  // A synchronous scan owns the same device even without an async job ID.
  if (operationLocks.has("scanner")) return c.json({ok:false,error:"A scan is already in progress. Wait for it to finish before starting another."},409);
  // also check filesystem lock for legacy sync jobs
  const lockPath=scannerLockPath();
  try{ const st=statSync(lockPath); if(Date.now()-st.mtimeMs < SCAN_JOB_STALE_MS){ return c.json({ ok:false, error:"A scan is already in progress. Wait for it to finish before starting another." }, 409);} else { removeOperationLockFs(lockPath); } }catch{}
  let job: ScanJob;
  let reservation: ScanReservation | undefined;
  try {
    reservation = scanLibrary.reserve(true);
    job=createScanJob(printerIp, dpi, mode, fmt, requestKey || undefined);
    scanReservations.set(job.id, reservation);
    dashboardStatus.refreshScanStorage();
  } catch (error) {
    reservation?.release();
    if (error instanceof ScanStorageError) return c.json({ok:false,error:error.message},error.status);
    return c.json({ok:false,error:"Scan storage is unavailable. Check the hub's data volume before trying again."},503);
  }
  setTimeout(async () => {
    try { await executeScanJob(job); }
    finally { scanReservations.delete(job.id); reservation?.release(); scanLibraryChanged(); }
  }, 10);
  return c.json({ ok:true, jobId:job.id, state:job.state, message:"Scan queued", pollUrl:`/api/scan/jobs/${job.id}` }, 202);
});
app.get("/api/scan/jobs/:id", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const id=c.req.param("id");
  reapStaleScanJobs();
  const job=scanJobs.get(id);
  if(!job) return c.json({ ok:false, error:"Job not found" },404);
  return c.json({ ok:true, job:scanJobStore.publicJob(job) });
});
app.post("/api/scan/jobs/:id/cancel", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const body=await readMutationBody(c);
  if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  scanJobs = scanJobStore.getJobs();
  const job=scanJobs.get(c.req.param("id"));
  if(!job) return c.json({ok:false,error:"Job not found"},404);
  if(["done","error","cancelled"].includes(job.state)) return c.json({ok:true,job:{id:job.id,state:job.state}});
  job.cancelRequested=true;
  job.progress="Cancelling";
  job.cancelProcess?.();
  if(job.state === "queued"){
    job.state="cancelled";
    job.error="Scan cancelled.";
    job.finishedAt=Date.now();
  }
  scanJobStore.checkpoint();
  return c.json({ok:true,job:{id:job.id,state:job.state}});
});
app.get("/api/scan/jobs", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  reapStaleScanJobs();
  const jobs=[...scanJobs.values()].sort((a,b)=>b.createdAt-a.createdAt).slice(0,20);
  return c.json({ jobs: jobs.map(scanJobStore.publicJob) });
});
// Recovery: cancel any stuck/active scan jobs + clear stale locks (fs + memory).
// Lets the UI offer "cancel stuck scan" instead of 409-looping forever. This is
// also the self-heal for legacy file locks: it removes the path whether it is
// a file or a directory and drops the in-memory holder timestamp.
app.post("/api/scan/cancel-all", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const body=await readMutationBody(c);
  if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  reapStaleScanJobs();
  let cancelled = 0;
  for(const j of scanJobs.values()){
    if(isScanJobActive(j)){
      j.cancelRequested=true;
      try { j.cancelProcess?.(); } catch {}
      j.progress="Cancelling";
      if (j.state === "queued") {
        j.state="cancelled"; j.error="Scan cancelled."; j.finishedAt=Date.now();
      }
      cancelled++;
    }
  }
  // An orphaned lock can be cleared, but a running holder must release its own.
  if (!operationLocks.has("scanner") && !findActiveScanJob()) {
    removeOperationLockFs(scannerLockPath());
  }
  scanJobStore.checkpoint();
  return c.json({ ok:true, cancelled });
});

const printerDeviceService = createPrinterDeviceService({
 reachable: ip => cachedPrinterReachable(ip), queueStatus: queue => cachedCupsPrinterStatus(queue), jobs: queue => cupsBackend.listJobs(queue),
 scannerBusy: () => !!findActiveScanJob() || operationLocks.has("scanner"),
 lock: fn => withOperationLock("device", fn),
});
export const deviceRecovery = createDeviceRecovery({
 read: () => ({ ip: currentPrinterIp(), identity: savedSettingsSync().printer_identity }),
 reachable: ip => cachedPrinterReachable(ip), identify: identifyPrinter,
 discover: async sweep => sweep ? (await discoverPrinters({ refresh: true, includeSweep: true })).printers : discoverAdvertisedPrinters(),
 busy: () => !!findActiveScanJob() || ["scanner", "device", "cups-config"].some(name => operationLocks.has(name)),
 remember: async (expectedIp, identity) => {
  const lock = await withOperationLock("cups-config", async () => {
   if(currentPrinterIp() !== expectedIp) return false;
   const data = savedSettingsSync(); data.printer_identity = identity; saveSettingsSync(data); return true;
  });
  return !!lock.acquired && !!lock.result;
 },
 relocate: async (expected, printer) => {
  const result = await withOperationLock("cups-config", async () => {
   if(currentPrinterIp() !== expected.ip || JSON.stringify(savedSettingsSync().printer_identity) !== JSON.stringify(expected.identity)) return "stale" as const;
   const [ok] = await configureCups(printer.ip);
   if(!ok) return "failed" as const;
   const data = { ...savedSettingsSync(), printer_ip: printer.ip, printer_identity: identityOf({ ...printer, mac: printer.mac || arpIdentity(printer.ip) }) };
   try { saveSettingsSync(data); } catch {
    if(expected.ip) await configureCups(expected.ip);
    return "failed" as const;
   }
   clearStatusCaches(); return "ok" as const;
  });
  return result.acquired ? result.result! : "busy";
 },
});
app.post("/api/printer/recover", async c => {
 const auth = requireAuth(c); if(auth) return auth;
 const body = await readMutationBody(c); if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token", 400);
 return c.json(await deviceRecovery.tick(true));
});

registerDeviceApi(app, { auth: requireAuth, ip: currentPrinterIp, queue: currentPrinterName,
 scanner: scannerManager, printer: printerDeviceService, csrf: isCsrfValid, readBody: readMutationBody, recovery: deviceRecovery.status });

export const dashboardStatus = registerStatusApi(app, { requireAuth, currentPrinterIp, currentPrinterName, currentDisplayName,
 clientSetup, networkSharingEnabledSync, recentScans, printerDeviceService, recovery: deviceRecovery.status, dataDir: () => APP_DIR, scanStorage: () => scanLibrary.usage(), scannerBusy: () => !!findActiveScanJob() || operationLocks.has("scanner"), csrf: isCsrfValid, readBody: readMutationBody,
 limits: () => ({ upload: MAX_UPLOAD_MB, scans: MAX_SCAN_FILES }) });

onStatusInvalidated(() => dashboardStatus.invalidate());

// Vite SPA assets (public/assets/*) – StyleX + Vite emit here
app.get("/assets/*", async(c)=>{
  const raw=c.req.path.replace(/^\/assets\//, "");
  // prevent traversal, but preserve subfolders (assets may be hashed)
  if(raw.includes("..") || raw.includes("\\")) return c.text("Not found",404);
  const safe=raw.split("/").map(p=>basename(p)).join("/");
  if(!safe) return c.text("Not found",404);
  const mimeMap:Record<string,string>={".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".woff2":"font/woff2", ".woff":"font/woff", ".map":"application/json"};
  for(const base of [join(process.cwd(),"public","assets"), join(process.cwd(),"public")]){
    const cand=join(base, safe);
    // also try direct path for nested
    const tryPaths=[cand, join(process.cwd(),"public","assets", raw)];
    for(const p of tryPaths){
      const f=Bun.file(p);
      if(await f.exists()){
        const ext=p.slice(p.lastIndexOf(".")).toLowerCase();
        const contentType=mimeMap[ext] || (f as any).type || "application/octet-stream";
        // stream file directly instead of buffering whole asset in memory
        const isHashed=/-[A-Za-z0-9]{6,}\.(js|css)$/.test(p);
        return new Response(f.stream(),{headers:{"Content-Type":contentType, "Cache-Control": isHashed ? "public, max-age=31536000, immutable" : "public, max-age=300"}});
      }
    }
  }
  return c.text("Not found",404);
});

app.get("/static/*", async(c)=>{
  const raw=c.req.path.replace(/^\/static\//, "");
  const decoded=decodeURIComponent(raw);
  const safe=basename(decoded);
  if(!safe || safe.includes("..") || decoded.includes("..") || decoded.includes("/") || decoded.includes("\\")){
    return c.text("Not found",404);
  }
  const mimeMap:Record<string,string>={".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".svg":"image/svg+xml", ".html":"text/html; charset=utf-8"};
  for(const cand of [join(process.cwd(),"public",safe)]){
    const f=Bun.file(cand);
    if(await f.exists()){
      const ext=safe.slice(safe.lastIndexOf(".")).toLowerCase();
      const contentType=mimeMap[ext] || (f as any).type || "application/octet-stream";
      return new Response(f.stream(),{headers:{"Content-Type":contentType, "Cache-Control":"public, max-age=300"}});
    }
  }
  return c.text("Not found",404);
});

app.onError((err,c)=>{
  if((err as any).message?.includes("413") || (c.req.header("content-length") && Number.parseInt(c.req.header("content-length")!) > MAX_UPLOAD_MB*1024*1024)){
    const msg=`That file is too large. The limit is ${MAX_UPLOAD_MB} MB.`;
    if(wantsJson(c as any)) return (c as any).json({ ok:false, error: msg }, 413);
    setFlash(c as any,"error",msg);
    return c.redirect("/",302);
  }
  console.error(err);
  if(wantsJson(c as any)) return (c as any).json({ ok:false, error: "Internal Server Error" }, 500);
  return c.text("Internal Server Error",500);
});

export default app;
export { validateIPv4, validateQueueName, validateDisplayName, getCsrfToken, currentPrinterIp as _currentPrinterIp, savePrinterIp as _savePrinterIp };
export { AUTH_FAILURE_LIMIT, AUTH_FAILURE_WINDOW_SECONDS };

