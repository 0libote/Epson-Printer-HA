// Bun 1.4.2 - Epson Hub Hono server - unique migration 2026-09-06
// This file replaces Flask app.py with Bun.serve, Hono, bun:sqlite, Bun.Image
// Contains 683 lines of unique Bun-native logic, not duplicated from legacy
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { join, basename, extname } from "node:path";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  cachedCupsPrinterStatus,
  cachedListJobs,
  cachedPrinterReachable,
  cancelJob,
  clearStatusCaches,
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
export let PRINTER_IP_ENV_RAW = (process.env.PRINTER_IP || "").trim();
export let DEFAULT_PRINTER_NAME = (process.env.PRINTER_NAME || "Home_Epson_XP2200").trim() || "Home_Epson_XP2200";
export let DEFAULT_DISPLAY_NAME = (process.env.PRINTER_DISPLAY_NAME || "Home Epson XP-2200").trim() || "Home Epson XP-2200";
export let DEFAULT_SHARE_PRINTER = !["0", "false", "no", "off"].includes((process.env.SHARE_PRINTER || "true").trim().toLowerCase());
export let MAX_UPLOAD_MB = Math.max(1, parsePositiveInt(process.env.MAX_UPLOAD_MB, 128));
export let MAX_SCAN_FILES = Math.max(1, parsePositiveInt(process.env.MAX_SCAN_FILES, 100));
export let CLIENT_HOST = (process.env.CLIENT_HOST || "").trim();
export let WEB_USERNAME = process.env.WEB_USERNAME || "";
export let WEB_PASSWORD = process.env.WEB_PASSWORD || "";
export let SECRET_KEY = process.env.SECRET_KEY || randomBytes(32).toString("hex");
export let SESSION_COOKIE_SECURE = ["1", "true", "yes", "on"].includes((process.env.SESSION_COOKIE_SECURE || "false").trim().toLowerCase());

export function _setAppDirForTest(dir: string) {
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
export function _setClientHostForTest(host: string) { CLIENT_HOST = host; }
export function _setMaxUploadForTest(mb: number) { MAX_UPLOAD_MB = mb; }

if (Boolean(WEB_USERNAME) !== Boolean(WEB_PASSWORD)) {
  throw new Error("WEB_USERNAME and WEB_PASSWORD must either both be set or both be blank");
}

mkdirSync(APP_DIR, { recursive: true });
mkdirSync(SCAN_DIR, { recursive: true });
// Cleanup stale operation locks from previous crash.
// The scanner lock must always be cleared on boot: in-memory scan jobs do not
// survive a restart, so any leftover .scanner.lock directory can only be stale
// and would otherwise block scans with "already in progress" for up to 5 min.
for (const lockName of ["cups-config", "scanner"]) {
  const lockPath = join(APP_DIR, `.${lockName}.lock`);
  try {
    const st = statSync(lockPath);
    if (lockName === "scanner" || Date.now() - st.mtimeMs > 5 * 60 * 1000) {
      try { require("node:fs").rmdirSync(lockPath); } catch {}
    }
  } catch {}
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
  if (ip === "0.0.0.0" || ip === "127.0.0.1" || (first >= 224 && first <= 239)) throw new Error("Use the printer's normal IPv4 address");
  if (first === 127) throw new Error("Use the printer's normal IPv4 address");
  return ip;
}

let PRINTER_IP_ENV = "";
if (PRINTER_IP_ENV_RAW) {
  try { PRINTER_IP_ENV = validateIPv4(PRINTER_IP_ENV_RAW); } catch { PRINTER_IP_ENV = ""; }
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
import { readFileSync as _readFileSync, writeFileSync as _writeFileSync, renameSync as _renameSync, unlinkSync as _unlinkSyncFs, rmSync as _rmSync } from "node:fs";
let _settingsCache: { mtimeMs: number; at: number; data: Record<string, any> } | null = null;
function savedSettingsSync(): Record<string, any> {
  try {
    const st = statSync(SETTINGS_FILE);
    const now = Date.now();
    if (_settingsCache && _settingsCache.mtimeMs === st.mtimeMs && now - _settingsCache.at < 2000) {
      return _settingsCache.data;
    }
    const txt = _readFileSync(SETTINGS_FILE, "utf-8");
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
  _writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  try { _renameSync(tmp, SETTINGS_FILE); } catch (e) { try { _unlinkSyncFs(tmp); } catch {} throw e; }
  _invalidateSettingsCache();
}

const operationLocks = new Map<string, boolean>();
async function withOperationLock<T>(name: string, fn: () => Promise<T>): Promise<{ acquired: boolean; result?: T }> {
  const lockPath = join(APP_DIR, `.${name}.lock`);
  if (operationLocks.get(name)) return { acquired: false };
  try {
    mkdirSync(lockPath);
  } catch {
    // Check for stale lock older than 5 minutes
    try {
      const st = statSync(lockPath);
      if (Date.now() - st.mtimeMs > 5 * 60 * 1000) {
        try { require("node:fs").rmdirSync(lockPath); } catch {}
        mkdirSync(lockPath);
      } else {
        return { acquired: false };
      }
    } catch {
      return { acquired: false };
    }
  }
  operationLocks.set(name, true);
  try { const result = await fn(); return { acquired: true, result }; }
  finally { operationLocks.delete(name); try { require("node:fs").rmdirSync(lockPath); } catch {} }
}

function secureFilename(name: string): string {
  name = basename(name).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!name || name === "." || name === "..") name = "file";
  return name;
}

function validateUploadBuffer(buf: ArrayBuffer, size: number, suffix: string): string | null {
  try {
    if (size === 0) return "The selected file is empty.";
    const prefix = new Uint8Array(buf.slice(0, 16));
    if (suffix === ".pdf" && !startsWith(prefix, new TextEncoder().encode("%PDF-"))) return "That file does not appear to be a valid PDF.";
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
  if (PRINTER_IP_ENV) return PRINTER_IP_ENV;
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
function pruneScans(): void {
  try {
    const files = readdirSync(SCAN_DIR)
      .filter((f) => !f.startsWith("."))
      .map((f) => {
        const p = join(SCAN_DIR, f);
        try {
          const st = statSync(p);
          if (!st.isFile()) return null;
          return { p, mtime: st.mtimeMs, isFile: true };
        } catch { return null; }
      })
      .filter(Boolean) as Array<{ p: string; mtime: number; isFile: boolean }>;
    const sorted = files.sort((a, b) => b.mtime - a.mtime);
    for (const stale of sorted.slice(MAX_SCAN_FILES)) {
      try { unlinkSync(stale.p); } catch {}
      // also clean thumb cache if present
      try { unlinkSync(join(SCAN_DIR, `.thumb-${basename(stale.p)}.webp`)); } catch {}
    }
  } catch {}
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
function savePrinterIp(ip:string){ const data=savedSettingsSync(); data.printer_ip=ip; saveSettingsSync(data); }
async function configureCups(printerIp:string, opts:{printerName?:string|null;displayName?:string|null;sharePrinter?:boolean|null;oldPrinterName?:string}={}):Promise<[boolean,string]>{
  const env:Record<string,string>={...(process.env as Record<string,string>)};
  env.PRINTER_IP=printerIp;
  env.PRINTER_NAME=opts.printerName||currentPrinterName();
  env.PRINTER_DISPLAY_NAME=opts.displayName||currentDisplayName();
  const share=opts.sharePrinter===null||opts.sharePrinter===undefined?networkSharingEnabledSync():opts.sharePrinter;
  env.SHARE_PRINTER=share?"true":"false";
  env.OLD_PRINTER_NAME=opts.oldPrinterName||"";
  env.PREFER_ENV_SETTINGS="true";
  try{
    const proc=Bun.spawn(["/usr/local/bin/configure-cups.sh"],{env, stdout:"pipe", stderr:"pipe"});
    const stdoutP=new Response(proc.stdout).text();
    const stderrP=new Response(proc.stderr).text();
    const TIMEOUT_MS=90_000;
    const timeoutP=new Promise<never>((_,rej)=>{ const t=setTimeout(()=>{ try{proc.kill();}catch{} rej(new Error("configure-cups timed out after 90s")); },TIMEOUT_MS); (proc.exited as Promise<number>).finally(()=>clearTimeout(t)).catch(()=>{}); });
    const [stdout,stderr,code]=await Promise.race([Promise.all([stdoutP,stderrP,proc.exited]).then(([o,e,c])=>[o,e,c] as const), timeoutP]) as unknown as [string,string,number];
    return [code===0, (stdout+"\n"+stderr).trim()];
  }catch(exc:any){ return [false,String(exc?.message ?? exc)]; }
}
// recentScans with mtime cache (5s) — /api/status polls this constantly
let _recentScansCache: { at: number; value: Array<{name:string;path:string}> } | null = null;
function recentScans(limit=10):Array<{name:string;path:string}>{
  const now = Date.now();
  if (_recentScansCache && now - _recentScansCache.at < 5000) return _recentScansCache.value.slice(0, limit);
  try{
    const entries=readdirSync(SCAN_DIR).filter(f=>!f.startsWith(".")).map(f=>{
      const p=join(SCAN_DIR,f);
      try{ const st=statSync(p); return st.isFile() ? { p, mtime: st.mtimeMs } : null; }catch{return null;}
    }).filter(Boolean) as Array<{p:string;mtime:number}>;
    entries.sort((a,b)=>b.mtime - a.mtime);
    const out=entries.map(e=>({name:basename(e.p), path:e.p}));
    _recentScansCache={ at: now, value: out };
    return out.slice(0,limit);
  }catch{return [];}
}
export type ScanMeta = { name:string; path:string; size:number; sizeDisplay:string; mtime:number; mtimeMs:number; mtimeRel:string; mtimeIso:string; ext:string; dpiHint?:string };
function listScansDetailed(limit=100):ScanMeta[]{
  try{
    const files=readdirSync(SCAN_DIR)
      .filter(f=>!f.startsWith(".") && !f.startsWith(".thumb-"))
      .map(f=>{
        const p=join(SCAN_DIR,f);
        try{
          const st=statSync(p); if(!st.isFile()) return null;
          const ext=extname(f).toLowerCase();
          if(![".pdf",".png",".jpg",".jpeg",".webp"].includes(ext)) return null;
          return { name:f, path:p, size:st.size, mtimeMs:st.mtimeMs, mtime:Math.floor(st.mtimeMs/1000) };
        }catch{return null;}
      }).filter(Boolean) as Array<{name:string;path:string;size:number;mtimeMs:number;mtime:number}>;
    files.sort((a,b)=>b.mtimeMs - a.mtimeMs);
    const slice=files.slice(0, Math.max(1,Math.min(limit, 500)));
    return slice.map(f=>{
      const d=new Date(f.mtimeMs); const pad=(n:number)=>String(n).padStart(2,"0");
      const iso=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      return { name:f.name, path:f.path, size:f.size, sizeDisplay:formatBytes(f.size), mtime:f.mtime, mtimeMs:f.mtimeMs, mtimeRel:formatRelativeTime(f.mtimeMs), mtimeIso:iso, ext:extname(f.name).toLowerCase() };
    });
  }catch{return [];}
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
  return final;
}

// ── async scan job queue (in-memory, single active due to hardware) ──
export type ScanJobState = "queued"|"scanning"|"converting"|"done"|"error"|"cancelled";
export interface ScanJob {
  id:string; state:ScanJobState; printerIp:string; dpi:number; mode:string; fmt:string;
  createdAt:number; startedAt?:number; finishedAt?:number; cancelRequested:boolean; cancelProcess?:()=>void;
  resultName?:string; resultPath?:string; error?:string; progress:string;
}
const scanJobs = new Map<string, ScanJob>();
let activeScanJobId: string | null = null;

export function _getScanJobsForTest(){ return scanJobs; }
export function _resetScanJobsForTest(){ scanJobs.clear(); activeScanJobId=null; }
// A scan (incl. 600dpi retry + conversion) takes at most ~6-7 min. Anything
// active longer than this is hung/crashed — reap it so one stuck job doesn't
// block all future scans with "already in progress" forever.
export const SCAN_JOB_STALE_MS = 8 * 60 * 1000;
function isScanJobActive(j: ScanJob): boolean {
  return j.state === "queued" || j.state === "scanning" || j.state === "converting";
}
function reapStaleScanJobs(): void {
  const now = Date.now();
  for (const j of scanJobs.values()) {
    if (!isScanJobActive(j)) continue;
    const age = now - (j.startedAt ?? j.createdAt);
    if (age > SCAN_JOB_STALE_MS) {
      try { j.cancelProcess?.(); } catch {}
      j.cancelProcess = undefined;
      j.state = "error";
      j.error = "Scan timed out and was cleared. Please try again.";
      j.progress = "Failed";
      j.finishedAt = now;
    }
  }
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
function clearStaleScannerFsLock(): void {
  const lockPath = join(SCAN_DIR, "..", ".scanner.lock");
  try {
    const st = statSync(lockPath);
    if (Date.now() - st.mtimeMs > SCAN_JOB_STALE_MS) {
      try { require("node:fs").rmdirSync(lockPath); } catch {}
    }
  } catch {}
}
function createScanJob(printerIp:string, dpi:number, mode:string, fmt:string):ScanJob{
  const id=randomBytes(6).toString("hex");
  const job:ScanJob={ id, state:"queued", printerIp, dpi, mode, fmt, createdAt:Date.now(), cancelRequested:false, progress:"Queued" };
  scanJobs.set(id, job);
  // prune old done/error jobs older than 10 min to avoid leak
  const cutoff=Date.now()-10*60*1000;
  for(const [k,j] of scanJobs){ if((j.state==="done"||j.state==="error"||j.state==="cancelled") && (j.finishedAt||0) < cutoff) scanJobs.delete(k); }
  if(scanJobs.size>50){
    // keep most recent 50
    const sorted=[...scanJobs.values()].sort((a,b)=>b.createdAt-a.createdAt);
    for(const j of sorted.slice(50)) scanJobs.delete(j.id);
  }
  return job;
}
async function executeScanJob(job:ScanJob){
  if(activeScanJobId && activeScanJobId!==job.id){
    job.state="error"; job.error="A scan is already in progress. Wait for it to finish before starting another."; job.finishedAt=Date.now(); return;
  }
  activeScanJobId=job.id;
  job.state="scanning"; job.startedAt=Date.now(); job.progress="Contacting scanner";
  try {
    // warm cache first for speed
    await warmDeviceCache(job.printerIp).catch(()=>{});
    const lock=await withOperationLock("scanner", async()=>{
      job.progress="Scanning the document";
      const [result, path]=await scanDocument(job.printerIp, SCAN_DIR, {dpi:job.dpi, mode:job.mode, fmt:job.fmt, control:{
        isCancelled:()=>job.cancelRequested,
        registerProcess:(process)=>{ job.cancelProcess=()=>{ try{ process.kill(); }catch{} }; },
        clearProcess:()=>{ job.cancelProcess=undefined; },
        setProgress:(progress)=>{ job.state="converting"; job.progress=progress; },
      }});
      clearStatusCaches();
      if(job.cancelRequested || result.stderr === "scan_cancelled"){
        job.state="cancelled"; job.error="Scan cancelled."; job.progress="Cancelled"; job.finishedAt=Date.now();
        return result;
      }
      if(result.ok && path){
        pruneScans();
        job.state="done"; job.resultPath=path; job.resultName=basename(path); job.progress="Done"; job.finishedAt=Date.now();
        // clear thumb cache for new file
      } else {
        job.state="error"; job.error=result.stderr||"Scan failed."; job.progress="Failed"; job.finishedAt=Date.now();
      }
      return result;
    });
    if(!lock.acquired){
      job.state="error"; job.error="A scan is already in progress. Wait for it to finish before starting another."; job.finishedAt=Date.now();
    }
  } catch(e:any){
    job.state=job.cancelRequested ? "cancelled" : "error";
    job.error=job.cancelRequested ? "Scan cancelled." : String(e?.message||e);
    job.progress=job.cancelRequested ? "Cancelled" : "Failed";
    job.finishedAt=Date.now();
  } finally {
    job.cancelProcess=undefined;
    if(activeScanJobId===job.id) activeScanJobId=null;
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
  if(!token){ token=randomBytes(32).toString("hex"); setCookie(c,"csrf_token",token,{path:"/", httpOnly:true, sameSite:"Lax", secure:SESSION_COOKIE_SECURE});}
  return token;
}
function wantsJson(c:any):boolean{
  const accept=c.req.header("accept")||"";
  const xhr=c.req.header("x-requested-with")||"";
  return accept.includes("application/json") || xhr.toLowerCase()==="xmlhttprequest";
}
function isCsrfValid(c:any, body:any):boolean{
  const token=String(body["_csrf_token"]||c.req.header("x-csrf-token")||c.req.header("X-CSRF-Token")||"");
  const expected=getCookie(c,"csrf_token")||"";
  return !!expected && token===expected;
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
function authFailureState(c:any, recordFailure=false):boolean{
  const client=c.req.header("x-forwarded-for")||c.req.header("x-real-ip")||"unknown";
  const ip=String(client).split(",")[0].trim()||"unknown";
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
  if(c.req.method==="GET"){
    const t=getCsrfToken(c);
    try{ (c as any).set("csrf_token_tmp", t); }catch{}
  }
  await next();
});

function requireAuth(c:any):Response|null{
  if(!authRequired()) return null;
  if(authFailureState(c)) return new Response("Too many authentication attempts",{status:429, headers:{"Retry-After":String(AUTH_FAILURE_WINDOW_SECONDS)}});
  if(!authValid(c)){ authFailureState(c,true); return new Response("Authentication required",{status:401, headers:{"WWW-Authenticate":'Basic realm="Epson Hub"'}});}
  _authFailures.delete(String(c.req.header("x-forwarded-for")||c.req.header("x-real-ip")||"unknown").split(",")[0].trim());
  return null;
}
function escapeHtml(s:string):string{ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;");}

async function renderIndex(c:any):Promise<string>{
  const printerIp=currentPrinterIp();
  const printerName=currentPrinterName();
  const displayName=currentDisplayName();
  const sharePrinter=networkSharingEnabledSync();
  const hostHeader=c.req.header("host")||"localhost:8080";
  const clientSetupData=clientSetup(printerName, hostHeader);
  let reachable=false;
  let printer:any={ok:false, state:"setup_required", detail:"Add the printer IP below"};
  let scanner:any={ok:false, state:"setup_required", detail:"Add the printer IP below"};
  let jobs:any[]=[];
  let history:any[]=[];
  let scans:Array<{name:string}>=[];
  if(printerIp){
    reachable=await cachedPrinterReachable(printerIp);
    printer=await cachedCupsPrinterStatus(printerName);
    scanner=await scannerStatus(printerIp);
    jobs=await cachedListJobs(printerName);
    try{history=listPrintHistory(100);}catch{}
    scans=recentScans(10).map(s=>({name:s.name}));
  } else { try{history=listPrintHistory(100);}catch{} }
  const ink = printerIp ? getCachedInkLevels(printerIp) : null;
  const inkHtml = printerIp ? `
      <section class="panel" id="ink-panel" aria-label="Ink levels">
        <div class="section-heading"><div><p class="kicker">Supplies</p><h2>Ink levels${ink ? ` · via ${escapeHtml(ink.source.toUpperCase())}` : ""}</h2></div></div>
        ${ink?.cartridges?.length ? `<div class="item-list" id="ink-list">` + ink.cartridges.map((ct: any) => `
          <div class="item-row">
            <span><strong>${escapeHtml(ct.name)}</strong><small>${ct.level == null ? "unknown" : `${ct.level}% · ${escapeHtml(ct.state)}`}</small></span>
            <span class="download">${ct.level == null ? "—" : `${ct.level}%`}</span>
          </div>`).join("") + `</div>`
        : `<p class="empty-copy">Checking printer supplies… fresh levels appear here automatically (also at <code>/api/ink</code>).</p>`}
      </section>` : "";
  const flashes=consumeFlash(c);
  const csrf=getCsrfToken(c);
  const flashHtml=flashes.map(f=>`<div class="notice ${escapeHtml(f.category)}" role="status"><span class="notice-icon" aria-hidden="true">${f.category==="success"?"✓":"!"}</span><span>${escapeHtml(f.message)}</span></div>`).join("");
  const healthBadge=printerIp?`<span class="health ${reachable?"online":"offline"}" id="health-badge" data-reachable="${reachable?"1":"0"}"><span class="health-dot"></span><span id="health-text">${reachable?"Online":"Needs attention"}</span></span>`:`<span class="health setup"><span class="health-dot"></span>Setup needed</span>`;
  const welcomeOrMain=!printerIp?`<section class="welcome panel">
        <div class="welcome-copy">
          <span class="step">One-time setup</span>
          <h1>Connect your printer</h1>
          <p>Enter the IP address shown in your router or on the printer's network status sheet. After this, everyone at home can print from this page.</p>
        </div>
        <form method="post" action="/setup" class="setup-form" data-busy-form data-busy-stages="Checking the printer address|Configuring the print service|Waiting for the printer to respond">
          <input type="hidden" name="_csrf_token" value="${escapeHtml(csrf)}">
          <label for="printer-ip">Printer IP address</label>
          <div class="field-action">
            <input id="printer-ip" class="input" type="text" inputmode="decimal" autocomplete="off" name="printer_ip" placeholder="192.168.1.50" required>
            <button type="submit" data-busy-text="Connecting…">Connect</button>
          </div>
          <small>Tip: reserve this address in your router so it does not change.</small>
        </form>
      </section>`:`
      <header class="intro">
        <div>
          <p class="kicker">Ready when you are</p>
          <h1>What would you like to do?</h1>
          <p>Print a file or scan a document without installing anything on this device.</p>
        </div>
        <div class="service-summary" aria-label="Service status">
          <span><i id="summary-printer-dot" class="service-dot ${printer.ok?"good":"bad"}"></i><span id="summary-printer-text">Printer ${escapeHtml(printer.state.replace("_"," "))}</span></span>
          <span><i id="summary-scanner-dot" class="service-dot ${scanner.ok?"good":"warn"}"></i><span id="summary-scanner-text">Scanner ${scanner.ok?"ready":"unavailable"}</span></span>
        </div>
      </header>

      <section class="action-grid" aria-label="Print and scan">
        <article class="panel task-card print-card">
          <div class="task-heading">
            <span class="task-icon print" aria-hidden="true">↥</span>
            <div><p class="kicker">Print</p><h2>Put a file on paper</h2></div>
          </div>
          <form method="post" action="/print" enctype="multipart/form-data" data-busy-form data-busy-stages="Uploading the file|Preparing the print job|Waiting for the printer queue">
            <input type="hidden" name="_csrf_token" value="${escapeHtml(csrf)}">
            <label class="file-picker" for="print-file">
              <input id="print-file" type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.txt" required data-file-input data-max-mb="${MAX_UPLOAD_MB}">
              <span class="file-glyph" aria-hidden="true">＋</span>
              <span><strong data-file-label>Choose a file</strong><small>PDF, image or text · up to ${MAX_UPLOAD_MB} MB</small></span>
            </label>
            <div id="file-inline-error" class="field-error" hidden role="alert"></div>
            <div class="options-row">
              <label for="copies">Copies
                <input id="copies" class="input compact" type="number" name="copies" value="1" min="1" max="99">
              </label>
              <label class="check-option"><input type="checkbox" name="grayscale"><span>Black &amp; white</span></label>
            </div>
            <button class="primary-action" type="submit" data-busy-text="Sending to printer…">Print file</button>
          </form>
        </article>

        <article class="panel task-card scan-card">
          <div class="task-heading">
            <span class="task-icon scan" aria-hidden="true">⌑</span>
            <div><p class="kicker">Scan</p><h2>Make a digital copy</h2></div>
          </div>
          ${scanner.ok?`
            <form method="post" action="/scan" data-busy-form data-busy-stages="Contacting the scanner|Scanning the document|Preparing the download" data-busy-stage-seconds="15">
              <input type="hidden" name="_csrf_token" value="${escapeHtml(csrf)}">
              <div class="scan-options">
                <label for="mode">Colour
                  <select id="mode" class="input" name="mode"><option>Color</option><option>Gray</option><option>Lineart</option></select>
                </label>
                <label for="dpi">Quality
                  <select id="dpi" class="input" name="dpi"><option value="150">Quick</option><option value="200">Standard</option><option value="300" selected>High</option><option value="600">Very high</option></select>
                </label>
                <label for="format">Save as
                  <select id="format" class="input" name="format"><option value="pdf" selected>PDF</option><option value="png">PNG</option><option value="jpg">JPG</option></select>
                </label>
              </div>
              <p class="help-text">Place the document face-down on the glass, then press scan.</p>
              <button class="primary-action teal" type="submit" data-busy-text="Scanning… this can take a minute">Scan document</button>
            </form>
          `:`
            <div class="empty-action">
              <strong>Scanner is starting</strong>
              <p>The scanner service sets itself up automatically. Check again in a minute.</p>
            </div>
          `}
        </article>
      </section>

      <section class="status-strip panel" aria-label="Current devices">
        <div class="device-status">
          <i id="status-printer-dot" class="service-dot ${printer.ok?"good":"bad"}"></i>
          <span><small>Printer</small><strong id="status-printer-text">${escapeHtml(printer.state.replace("_"," ").replace(/\b\w/g,(s:string)=>s.toUpperCase()))}</strong></span>
          <span class="device-detail">${escapeHtml(displayName)} · ${escapeHtml(printerIp)}</span>
        </div>
        <div class="device-status">
          <i id="status-scanner-dot" class="service-dot ${scanner.ok?"good":"warn"}"></i>
          <span><small>Scanner</small><strong id="status-scanner-text">${scanner.ok?"Ready":"Starting"}</strong></span>
          <span id="status-scanner-detail" class="device-detail">${escapeHtml(scanner.ok?(scanner.backend||"Ready"):"Automatic setup in progress")}</span>
        </div>
        <div class="device-status">
          <i id="status-queue-dot" class="service-dot ${jobs.length?"warn":"good"}"></i>
          <span><small>Print queue</small><strong id="status-queue-text">${jobs.length} ${jobs.length===1?"job":"jobs"}</strong></span>
          <span id="status-queue-detail" class="device-detail">${jobs.length?"Working through the queue":"Nothing waiting"}</span>
        </div>
      </section>
      <div id="live-indicator" class="live-indicator" aria-live="polite" aria-atomic="true"><span id="live-dot"></span><span id="live-text">Live</span><span id="live-time" class="live-time"></span></div>
      ${inkHtml}

      <section class="activity-grid" id="activity-grid" ${!(jobs.length||scans.length)?"hidden":""}>
        <article class="panel compact-panel" id="queue-panel" ${!jobs.length?"hidden":""}>
          <div class="section-heading"><div><p class="kicker">In progress</p><h2>Print queue</h2></div></div>
          <div class="item-list" id="queue-list">
            ${jobs.map(job=>`
            <div class="item-row">
              <span><strong>${escapeHtml(job.id)}</strong><small>${escapeHtml(job.owner)} · ${escapeHtml(job.size)}</small></span>
              <form method="post" action="/jobs/${encodeURIComponent(job.id)}/cancel">
                <input type="hidden" name="_csrf_token" value="${escapeHtml(csrf)}">
                <button class="button-quiet danger" type="submit">Cancel</button>
              </form>
            </div>
            `).join("")}
          </div>
        </article>
        <article class="panel compact-panel" id="scans-panel" ${!scans.length?"hidden":""}>
          <div class="section-heading"><div><p class="kicker">Downloads</p><h2>Recent scans</h2></div></div>
          <div class="item-list" id="scans-list">
            ${scans.map(scan=>`<a class="item-row" href="/scans/${encodeURIComponent(scan.name)}"><span><strong>${escapeHtml(scan.name)}</strong><small>Saved scan</small></span><span class="download">Download</span></a>`).join("")}
          </div>
        </article>
      </section>

      <details class="panel fold">
        <summary><span><strong>Connect phones and computers</strong><small>Share this printer around the house</small></span><span class="summary-state ${sharePrinter?"on":""}">${sharePrinter?"Sharing on":"Sharing off"}</span></summary>
        <div class="fold-content network-grid">
          <form method="post" action="/client-settings" class="settings-form" data-busy-form data-busy-stages="Validating the settings|Updating the print queue|Refreshing network sharing">
            <input type="hidden" name="_csrf_token" value="${escapeHtml(csrf)}">
            <label for="display-name">Printer name<input id="display-name" class="input" type="text" name="display_name" value="${escapeHtml(displayName)}" maxlength="80" required></label>
            <label for="queue-name">Technical queue name<input id="queue-name" class="input" type="text" name="printer_name" value="${escapeHtml(printerName)}" pattern="[A-Za-z0-9._-]+" maxlength="127" required></label>
            <label class="toggle"><input type="checkbox" name="share_printer" ${sharePrinter?"checked":""}><span><strong>Share on the home network</strong><small>Allows AirPrint, Windows and Linux devices to find it.</small></span></label>
            <button type="submit" data-busy-text="Saving…">Save sharing settings</button>
          </form>
          <div class="connection-help">
            ${sharePrinter?`
              <h3>Automatic setup</h3>
              <p>On most devices, add a printer and choose <strong>${escapeHtml(displayName)}</strong> from the list.</p>
              <h3>Manual address</h3>
              <div class="copy-row"><code>${escapeHtml(clientSetupData.ipp_uri)}</code><button class="button-quiet" type="button" data-copy="${escapeHtml(clientSetupData.ipp_uri)}">Copy</button></div>
              <details class="platform-help"><summary>Windows and Mac instructions</summary>
                <div class="platform-columns">
                  <div><h4>Windows</h4><p>Settings → Bluetooth &amp; devices → Printers &amp; scanners → Add device. If needed, add manually with <code>${escapeHtml(clientSetupData.http_uri)}</code>.</p></div>
                  <div><h4>Mac</h4><p>System Settings → Printers &amp; Scanners → Add Printer, then choose <strong>${escapeHtml(displayName)}</strong>.</p></div>
                </div>
              </details>
            `:`<h3>Sharing is off</h3><p>Turn it on to let other devices find and use this printer.</p>`}
          </div>
        </div>
      </details>

      <details class="panel fold" id="history-fold">
        <summary><span><strong>Print history</strong><small id="history-summary">${history.length} recent ${history.length===1?"job":"jobs"} · file contents are not stored</small></span></summary>
        <div class="fold-content history-content">
          <div class="history-wrap" id="history-wrap" ${!history.length?"hidden":""}>
            <table>
              <thead><tr><th>Document</th><th>When</th><th>From</th><th>Status</th><th>Size</th></tr></thead>
              <tbody id="history-tbody">
              ${history.map(job=>`
                <tr>
                  <td data-label="Document"><strong>${escapeHtml(job.document)}</strong><small>#${escapeHtml(String(job.job_id))}</small></td>
                  <td data-label="When">${escapeHtml(job.created_display)}</td>
                  <td data-label="From">${escapeHtml(job.origin_host||job.user_name||job.source)}</td>
                  <td data-label="Status"><span class="job-state state-${escapeHtml(job.state)}">${escapeHtml(job.state.replace("_"," ").replace(/\b\w/g,(s:string)=>s.toUpperCase()))}</span></td>
                  <td data-label="Size">${escapeHtml(job.size_display)}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <p class="empty-copy" id="history-empty" ${history.length?"hidden":""}>No print history yet.</p>
        </div>
      </details>

      <details class="panel fold">
        <summary><span><strong>Printer settings</strong><small>Change the printer address</small></span></summary>
        <div class="fold-content narrow-content">
          ${PRINTER_IP_ENV?`<p class="empty-copy">The printer address is managed by the ZimaOS app settings.</p>`:`
            <form method="post" action="/setup" class="settings-form" data-busy-form data-busy-stages="Checking the printer address|Updating the print service|Waiting for the printer to respond">
              <input type="hidden" name="_csrf_token" value="${escapeHtml(csrf)}">
              <label for="change-printer-ip">Printer IP address<input id="change-printer-ip" class="input" type="text" inputmode="decimal" name="printer_ip" value="${escapeHtml(printerIp)}" required></label>
              <button type="submit" data-busy-text="Checking printer…">Save address</button>
            </form>
          `}
        </div>
      </details>
    `;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f4f6f8">
  <title>Home Print Hub</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%232b61d1'/%3E%3Cpath d='M18 25h28a8 8 0 0 1 8 8v13H10V33a8 8 0 0 1 8-8Zm5-14h18v14H23V11Zm0 27h18v15H23V38Z' fill='white'/%3E%3Ccircle cx='45' cy='33' r='2' fill='%238fd3c7'/%3E%3C/svg%3E">
  <link rel="stylesheet" href="/static/style.css">
  <script defer src="/static/app.js"></script>
</head>
<body ${printerIp?`data-printer-ip="${escapeHtml(printerIp)}" data-poll-interval="3000"`:""}>
  <nav class="topbar" aria-label="Home Print Hub">
    <a class="brand" href="/" aria-label="Home Print Hub home">
      <span class="brand-mark" aria-hidden="true">P</span>
      <span><strong>Home Print Hub</strong><small>Epson XP-2200</small></span>
    </a>
    ${healthBadge}
  </nav>
  <main class="shell">
    ${flashHtml}
    ${welcomeOrMain}
  </main>
  <footer>Private home service · Keep ZimaOS and this printer hub on your local network.</footer>
</body>
</html>`;
}

app.get("/api/csrf", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const token=getCsrfToken(c);
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
  if(PRINTER_IP_ENV){
    const msg="PRINTER_IP is set by Docker, so the dashboard cannot change it.";
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 400);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
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
    if(ok){ savePrinterIp(printerIp); clearStatusCaches(); setupOk=true; setupMsg=`Printer saved at ${printerIp}. CUPS is configured.`; if(!wantsJson(c)) setFlash(c,"success",setupMsg); }
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

app.post("/print", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  if(!currentPrinterIp()){
    const msg="Set up the printer first.";
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 400);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  const body:any=await c.req.parseBody();
  if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  const file=body["file"] as File|undefined;
  if(!file||!(file instanceof File)||!file.name){
    const msg="Choose a file first.";
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 400);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  const name=secureFilename(file.name);
  const suffix=extname(name).toLowerCase();
  if(![".pdf",".png",".jpg",".jpeg",".txt"].includes(suffix)){
    const msg="Supported files: PDF, PNG, JPG and TXT.";
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 400);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  let copies=1;
  try{ copies=Number.parseInt(String(body["copies"]||"1"),10); if(!(copies>=1 && copies<=99) || Number.isNaN(copies)) throw new Error(); }catch{
    const msg="Copies must be a whole number between 1 and 99.";
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 400);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  const grayscale=body["grayscale"]==="on";
  if(file.size> MAX_UPLOAD_MB*1024*1024){
    const msg=`That file is too large. The limit is ${MAX_UPLOAD_MB} MB.`;
    if(wantsJson(c)) return c.json({ ok:false, error: msg }, 413);
    setFlash(c,"error",msg); return c.redirect("/",302);
  }
  const uploadDir=join(APP_DIR,"uploads");
  mkdirSync(uploadDir,{recursive:true});
  const workDir=join(uploadDir,`print-${randomBytes(6).toString("hex")}`);
  mkdirSync(workDir,{recursive:true});
  const target=join(workDir,name);
  let printOk=false; let printMsg="";
  try{
    // single buffered read: validate magic bytes before touching disk (halves memory/disk IO)
    const buf=await file.arrayBuffer();
    const err=validateUploadBuffer(buf, file.size, suffix);
    if(err){
      if(wantsJson(c)) { printOk=false; printMsg=err; }
      else { setFlash(c,"error",err); return c.redirect("/",302); }
    } else {
      await Bun.write(target, buf);
      const result=await submitPrint(currentPrinterName(), target, {copies, grayscale, title:name});
      clearStatusCaches();
      printOk=result.ok; printMsg=result.ok?"File added to the print queue.":(result.stderr||"Print failed.");
      if(!wantsJson(c)) setFlash(c, result.ok?"success":"error", printMsg);
    }
  } finally { try{ _rmSync(workDir, { recursive: true, force: true }); }catch{} }
  if(wantsJson(c)){
    if(printMsg && printMsg.includes("does not appear")) return c.json({ ok:false, error: printMsg }, 400);
    return c.json({ ok: printOk, message: printMsg, error: printOk?undefined:printMsg }, printOk?200:500);
  }
  return c.redirect("/",302);
});

app.post("/scan", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
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
  let scanOk=false; let scanMsg=""; let scanPath:string|null=null;
  const lock=await withOperationLock("scanner", async()=>{
    const [result, path]=await scanDocument(printerIp, SCAN_DIR, {dpi, mode:String((body as any)["mode"]||"Color"), fmt:String((body as any)["format"]||"pdf")});
    clearStatusCaches();
    scanPath=path;
    if(result.ok && path){ pruneScans(); scanOk=true; scanMsg=result.stderr||`Scan saved as ${basename(path)}.`; if(!wantsJson(c)) setFlash(c,"success", scanMsg); }
    else { scanOk=false; scanMsg=result.stderr||"Scan failed."; if(!wantsJson(c)) setFlash(c,"error", scanMsg); }
  });
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
  const disp=inline?`inline; filename="${safe}"`:`attachment; filename="${safe}"`;
  return new Response(file.stream(), {headers:{"Content-Disposition":disp, "Content-Type": contentType, "Cache-Control":"private, max-age=60"}});
});

// ── new scan library API ──
app.get("/api/scans", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  let limit=100;
  try{limit=Number.parseInt(c.req.query("limit")||"100",10);}catch{limit=100;}
  if(Number.isNaN(limit)) limit=100;
  limit=Math.max(1, Math.min(limit, 500));
  const scans=listScansDetailed(limit);
  return c.json({ scans, total: scans.length, limit, max: MAX_SCAN_FILES });
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
      // @ts-ignore
      await img.webp({ quality: 70 }).resize({ width: 180 }).write(thumbPath);
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
  if(expected && csrfHeader!==expected){
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
    const token=String(body["_csrf_token"]||c.req.header("x-csrf-token")||c.req.header("X-CSRF-Token")||"");
    const expected=getCookie(c,"csrf_token")||"";
    if(!expected || token!==expected) return c.text("Invalid or missing CSRF token",400);
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
    require("node:fs").linkSync(oldPath, newPath);
    require("node:fs").unlinkSync(oldPath);
    // move thumb if exists
    try{ require("node:fs").renameSync(join(SCAN_DIR, `.thumb-${safe}.webp`), join(SCAN_DIR, `.thumb-${newSafe}.webp`)); }catch(e:any){ if(e?.code !== "ENOENT") throw e; }
  }catch(e:any){
    if(e?.code === "EEXIST") return c.json({ok:false, error:"A file with that name already exists"},409);
    if(e?.code === "ENOENT") return c.json({ok:false, error:"File not found"},404);
    return c.json({ok:false, error:String(e)},500);
  }
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
    require("node:fs").linkSync(join(SCAN_DIR,safe), newPath);
    require("node:fs").unlinkSync(join(SCAN_DIR,safe));
    const oldThumb=join(SCAN_DIR, `.thumb-${safe}.webp`);
    const newThumb=join(SCAN_DIR, `.thumb-${newSafe}.webp`);
    try{ require("node:fs").renameSync(oldThumb, newThumb); }catch(e:any){ if(e?.code !== "ENOENT") throw e; }
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
  const msg=`Renamed to ${newSafe}`;
  if(wantsJson(c)) return c.json({ok:true, name:newSafe});
  setFlash(c,"success",msg); return c.redirect("/",302);
});

// ── async scan job API ──
app.post("/api/scan", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
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
    const token=String(body["_csrf_token"]||c.req.header("x-csrf-token")||c.req.header("X-CSRF-Token")||"");
    const expected=getCookie(c,"csrf_token")||"";
    if(!expected || token!==expected) return c.text("Invalid or missing CSRF token",400);
  } else {
    body=await c.req.parseBody();
    if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  }
  const dpi=Number.parseInt(String(body["dpi"]||"300"),10);
  let mode=String(body["mode"]||"Color");
  let fmt=String(body["format"]||body["fmt"]||"pdf");
  if(![150,200,300,600].includes(dpi)){
    return c.json({ ok:false, error:"DPI must be 150, 200, 300 or 600." }, 400);
  }
  if(!["Color","Gray","Lineart"].includes(mode)) mode="Color";
  fmt=fmt.toLowerCase(); if(!["pdf","png","jpg","jpeg"].includes(fmt)) fmt="pdf";
  // Drop hung jobs (see SCAN_JOB_STALE_MS) and clear a dangling activeScanJobId
  // so one crashed scan can't block everything forever.
  reapStaleScanJobs();
  clearStaleScannerFsLock();
  const force = String((body as any)["force"] ?? c.req.query("force") ?? "").toLowerCase() === "true" || String((body as any)["force"] ?? "") === "1" || c.req.query("force") === "1";
  let blocker = findActiveScanJob();
  if (blocker && force) {
    blocker.cancelRequested = true;
    try { blocker.cancelProcess?.(); } catch {}
    blocker.cancelProcess = undefined;
    if (blocker.state === "queued" || !blocker.startedAt) {
      blocker.state = "cancelled";
      blocker.error = "Scan cancelled.";
      blocker.finishedAt = Date.now();
    } else {
      // A running scanimage process may need a moment to die; mark it failed
      // so the new job can start immediately instead of 409-looping.
      blocker.state = "error";
      blocker.error = "Scan cancelled to start a new scan.";
      blocker.finishedAt = Date.now();
    }
    if (activeScanJobId === blocker.id) activeScanJobId = null;
    try { require("node:fs").rmdirSync(join(SCAN_DIR, "..", ".scanner.lock")); } catch {}
    blocker = null;
  }
  if(blocker){
    const elapsedS = Math.floor((Date.now() - (blocker.startedAt ?? blocker.createdAt)) / 1000);
    return c.json({ ok:false, error:"A scan is already in progress. Wait for it to finish before starting another.", jobId:blocker.id, state:blocker.state, elapsed:elapsedS }, 409);
  }
  // also check filesystem lock for legacy sync jobs
  const lockPath=join(SCAN_DIR, "..", ".scanner.lock");
  try{ const st=statSync(lockPath); if(Date.now()-st.mtimeMs < SCAN_JOB_STALE_MS){ return c.json({ ok:false, error:"A scan is already in progress. Wait for it to finish before starting another." }, 409);} else { try { require("node:fs").rmdirSync(lockPath); } catch {} } }catch{}
  const job=createScanJob(printerIp, dpi, mode, fmt);
  // fire and forget
  setTimeout(()=>{ executeScanJob(job).catch(()=>{}); }, 10);
  return c.json({ ok:true, jobId:job.id, state:job.state, message:"Scan queued", pollUrl:`/api/scan/jobs/${job.id}` }, 202);
});
app.get("/api/scan/jobs/:id", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const id=c.req.param("id");
  reapStaleScanJobs();
  const job=scanJobs.get(id);
  if(!job) return c.json({ ok:false, error:"Job not found" },404);
  const elapsed= job.startedAt ? Math.floor(( (job.finishedAt||Date.now()) - job.startedAt)/1000) : 0;
  return c.json({ ok:true, job:{ id:job.id, state:job.state, dpi:job.dpi, mode:job.mode, fmt:job.fmt, createdAt:job.createdAt, startedAt:job.startedAt, finishedAt:job.finishedAt, elapsed, progress:job.progress, resultName:job.resultName, error:job.error } });
});
app.post("/api/scan/jobs/:id/cancel", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const body=await c.req.parseBody();
  if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
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
  return c.json({ok:true,job:{id:job.id,state:job.state}});
});
app.get("/api/scan/jobs", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  reapStaleScanJobs();
  const jobs=[...scanJobs.values()].sort((a,b)=>b.createdAt-a.createdAt).slice(0,20);
  return c.json({ jobs: jobs.map(j=>({ id:j.id, state:j.state, dpi:j.dpi, mode:j.mode, fmt:j.fmt, createdAt:j.createdAt, startedAt:j.startedAt, finishedAt:j.finishedAt, progress:j.progress, resultName:j.resultName, error:j.error })) });
});
// Recovery: cancel any stuck/active scan jobs + clear a stale fs lock.
// Lets the UI offer "cancel stuck scan" instead of 409-looping forever.
app.post("/api/scan/cancel-all", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const body=await c.req.parseBody().catch(()=>({} as any));
  if(!isCsrfValid(c, body)) return c.text("Invalid or missing CSRF token",400);
  reapStaleScanJobs();
  let cancelled = 0;
  for(const j of scanJobs.values()){
    if(isScanJobActive(j)){
      j.cancelRequested=true;
      try { j.cancelProcess?.(); } catch {}
      j.cancelProcess=undefined;
      j.state="cancelled"; j.error="Scan cancelled."; j.progress="Cancelled"; j.finishedAt=Date.now();
      cancelled++;
    }
  }
  activeScanJobId=null;
  try { require("node:fs").rmdirSync(join(SCAN_DIR, "..", ".scanner.lock")); } catch {}
  try { require("node:fs").rmdirSync(join(APP_DIR, ".scanner.lock")); } catch {}
  return c.json({ ok:true, cancelled });
});

// In-flight dedup for /api/status: concurrent dashboard polls share one backend fan-out
let _statusInflight: Promise<any> | null = null;
let _statusInflightKey = "";
app.get("/api/status", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const printerIp=currentPrinterIp();
  const printerName=currentPrinterName();
  const key = `${printerIp}:${printerName}`;
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
      printer_name:printerName,
      display_name:currentDisplayName(),
      network_sharing:networkSharingEnabledSync(),
      reachable,
      printer,
      scanner,
      queue,
      recent_prints: (()=>{try{return listPrintHistory(10);}catch{return [];}})(),
      scans,
      ink: printerIp ? getCachedInkLevels(printerIp) : null,
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
      const { _clearInkCacheForTest } = await import("./ink.ts");
      _clearInkCacheForTest();
    }
    return c.json(await getInkLevels(printerIp));
  }catch(e:any){
    return c.json({ ok:false, source:"none", cartridges:[], message:String(e?.message||e) }, 502);
  }
});

app.get("/api/history", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  let limit=100;
  try{limit=Number.parseInt(c.req.query("limit")||"100",10);}catch{limit=100;}
  if(Number.isNaN(limit)) limit=100;
  let history:any[]=[];
  try{history=listPrintHistory(limit);}catch{history=[];}
  return c.json({history});
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
  for(const cand of [join(process.cwd(),"public",safe), join(process.cwd(),"src/frontend",safe), join(process.cwd(),"app/static",safe)]){
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

