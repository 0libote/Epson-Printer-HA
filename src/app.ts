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
} from "./core.ts";
import { listPrintHistory } from "./history.ts";

export let APP_DIR = process.env.APP_DATA || "/data";
export let SCAN_DIR = join(APP_DIR, "scans");
export let SETTINGS_FILE = join(APP_DIR, "settings.json");
export let PRINTER_IP_ENV_RAW = (process.env.PRINTER_IP || "").trim();
export let DEFAULT_PRINTER_NAME = (process.env.PRINTER_NAME || "Home_Epson_XP2200").trim() || "Home_Epson_XP2200";
export let DEFAULT_DISPLAY_NAME = (process.env.PRINTER_DISPLAY_NAME || "Home Epson XP-2200").trim() || "Home Epson XP-2200";
export let DEFAULT_SHARE_PRINTER = !["0", "false", "no", "off"].includes((process.env.SHARE_PRINTER || "true").trim().toLowerCase());
export let MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || "128", 10);
export let MAX_SCAN_FILES = Math.max(1, parseInt(process.env.MAX_SCAN_FILES || "100", 10));
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
    const n = parseInt(p, 10);
    if (n < 0 || n > 255) throw new Error("Use the printer's normal IPv4 address");
  }
  const ip = parts.join(".");
  const first = parseInt(parts[0], 10);
  if (ip === "0.0.0.0" || ip === "127.0.0.1" || (first >= 224 && first <= 239)) throw new Error("Use the printer's normal IPv4 address");
  if (first === 127) throw new Error("Use the printer's normal IPv4 address");
  return ip;
}

let PRINTER_IP_ENV = "";
if (PRINTER_IP_ENV_RAW) {
  try { PRINTER_IP_ENV = validateIPv4(PRINTER_IP_ENV_RAW); } catch { PRINTER_IP_ENV = PRINTER_IP_ENV_RAW; }
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

function savedSettingsSync(): Record<string, any> {
  try {
    const txt = require("node:fs").readFileSync(SETTINGS_FILE, "utf-8");
    const data = JSON.parse(txt);
    return typeof data === "object" && data !== null ? data : {};
  } catch { return {}; }
}

function saveSettingsSync(data: Record<string, any>) {
  const tmp = join(APP_DIR, `.settings.${randomBytes(6).toString("hex")}`);
  require("node:fs").writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  try { require("node:fs").renameSync(tmp, SETTINGS_FILE); } finally { try { require("node:fs").unlinkSync(tmp); } catch {} }
}

const operationLocks = new Map<string, boolean>();
async function withOperationLock<T>(name: string, fn: () => Promise<T>): Promise<{ acquired: boolean; result?: T }> {
  const lockPath = join(APP_DIR, `.${name}.lock`);
  if (operationLocks.get(name)) return { acquired: false };
  try { mkdirSync(lockPath); } catch { return { acquired: false }; }
  operationLocks.set(name, true);
  try { const result = await fn(); return { acquired: true, result }; }
  finally { operationLocks.delete(name); try { require("node:fs").rmdirSync(lockPath); } catch {} }
}

function secureFilename(name: string): string {
  name = basename(name).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!name || name === "." || name === "..") name = "file";
  return name;
}

async function validateUpload(path: string, suffix: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (file.size === 0) return "The selected file is empty.";
    const bytes = await file.arrayBuffer();
    const prefix = new Uint8Array(bytes.slice(0, 16));
    if (suffix === ".pdf" && !startsWith(prefix, new TextEncoder().encode("%PDF-"))) return "That file does not appear to be a valid PDF.";
    if (suffix === ".png" && !startsWith(prefix, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "That file does not appear to be a valid PNG image.";
    if ((suffix === ".jpg" || suffix === ".jpeg") && !(prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff)) return "That file does not appear to be a valid JPEG image.";
    if (suffix === ".txt") {
      const sample = new Uint8Array(bytes.slice(0, 65536));
      if (sample.includes(0x00)) return "That file does not appear to be plain text.";
      try { new TextDecoder("utf-8", { fatal: true }).decode(sample); } catch { return "The uploaded file could not be read in the expected format."; }
    }
  } catch { return "The uploaded file could not be read in the expected format."; }
  return null;
}
function startsWith(a: Uint8Array, b: Uint8Array): boolean { if (a.length < b.length) return false; for (let i=0;i<b.length;i++) if(a[i]!==b[i]) return false; return true; }

export function currentPrinterIp(): string {
  if (PRINTER_IP_ENV) return PRINTER_IP_ENV;
  const v = String(savedSettingsSync().printer_ip ?? "").trim();
  if (!v) return "";
  try { return validateIPv4(v); } catch { return ""; }
}
function pruneScans(): void {
  try {
    const files = readdirSync(SCAN_DIR).filter(f=>!f.startsWith(".")).map(f=>{ const p=join(SCAN_DIR,f); try{return {p, mtime:statSync(p).mtimeMs, isFile:statSync(p).isFile()};}catch{return null;}}).filter(Boolean) as Array<{p:string;mtime:number;isFile:boolean}>;
    const sorted = files.filter(f=>f.isFile).sort((a,b)=>b.mtime-a.mtime);
    for(const stale of sorted.slice(MAX_SCAN_FILES)) try{unlinkSync(stale.p);}catch{}
  } catch {}
}
export function currentPrinterName(): string { const v=String(savedSettingsSync().printer_name ?? DEFAULT_PRINTER_NAME).trim(); try{return validateQueueName(v);}catch{return DEFAULT_PRINTER_NAME;}}
export function currentDisplayName(): string { const v=String(savedSettingsSync().display_name ?? DEFAULT_DISPLAY_NAME).trim(); try{return validateDisplayName(v);}catch{return DEFAULT_DISPLAY_NAME;}}
function networkSharingEnabledSync(): boolean { const v=savedSettingsSync().share_printer; if(typeof v==="boolean") return v; const s=String(v ?? (DEFAULT_SHARE_PRINTER?"true":"false")).trim().toLowerCase(); return ["1","true","yes","on"].includes(s); }
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
    const stdout=await new Response(proc.stdout).text();
    const stderr=await new Response(proc.stderr).text();
    const code=await proc.exited;
    return [code===0, (stdout+"\n"+stderr).trim()];
  }catch(exc:any){ return [false,String(exc)]; }
}
function recentScans(limit=10):Array<{name:string;path:string}>{
  try{
    const files=readdirSync(SCAN_DIR).filter(f=>!f.startsWith(".")).map(f=>join(SCAN_DIR,f)).filter(p=>{try{return statSync(p).isFile();}catch{return false;}});
    files.sort((a,b)=>statSync(b).mtimeMs - statSync(a).mtimeMs);
    return files.slice(0,limit).map(p=>({name:basename(p), path:p}));
  }catch{return [];}
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
  setCookie(c,"flash",encoded,{path:"/", httpOnly:false, sameSite:"Lax"});
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
  const now=performance.now()/1000;
  const cutoff=now - AUTH_FAILURE_WINDOW_SECONDS;
  let recent=( _authFailures.get(ip)||[] ).filter(t=>t>=cutoff);
  if(recordFailure) recent.push(now);
  if(recent.length) _authFailures.set(ip,recent); else _authFailures.delete(ip);
  return recent.length>=AUTH_FAILURE_LIMIT;
}
export const app=new Hono();
app.use("*", async(c,next)=>{ if(c.req.method==="GET") getCsrfToken(c); await next();});

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

app.get("/", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const html=await renderIndex(c);
  return c.html(html);
});

app.post("/setup", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  if(PRINTER_IP_ENV){ setFlash(c,"error","PRINTER_IP is set by Docker, so the dashboard cannot change it."); return c.redirect("/",302); }
  const body=await c.req.parseBody();
  const token=String(body["_csrf_token"]||c.req.header("x-csrf-token")||"");
  const expected=getCookie(c,"csrf_token")||"";
  if(!expected||token!==expected) return c.text("Invalid or missing CSRF token",400);
  const rawIp=String(body["printer_ip"]||"");
  let printerIp:string;
  try{ printerIp=validateIPv4(rawIp);}catch(e:any){ setFlash(c,"error",e.message); return c.redirect("/",302); }
  const lock=await withOperationLock("cups-config", async()=>{
    const [ok,log]=await configureCups(printerIp);
    if(ok){ savePrinterIp(printerIp); clearStatusCaches(); setFlash(c,"success",`Printer saved at ${printerIp}. CUPS is configured.`); }
    else setFlash(c,"error",`CUPS setup failed; the previous printer setting was kept: ${(log||"unknown error").slice(-800)}`);
  });
  if(!lock.acquired) setFlash(c,"error","Printer settings are already being changed. Wait for that operation to finish.");
  return c.redirect("/",302);
});

app.post("/client-settings", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const printerIp=currentPrinterIp();
  if(!printerIp){ setFlash(c,"error","Set up the physical printer first."); return c.redirect("/",302); }
  const body=await c.req.parseBody();
  const token=String(body["_csrf_token"]||c.req.header("x-csrf-token")||"");
  if(token!==(getCookie(c,"csrf_token")||"")) return c.text("Invalid or missing CSRF token",400);
  let printerName:string, displayName:string;
  try{
    printerName=validateQueueName(String(body["printer_name"]||""));
    displayName=validateDisplayName(String(body["display_name"]||""));
  }catch(e:any){ setFlash(c,"error",e.message); return c.redirect("/",302); }
  const sharePrinter=body["share_printer"]==="on";
  const lock=await withOperationLock("cups-config", async()=>{
    const oldName=currentPrinterName();
    const [ok,log]=await configureCups(printerIp,{printerName, displayName, sharePrinter, oldPrinterName:oldName});
    if(!ok){ setFlash(c,"error",`Network printing settings were not applied: ${(log||"unknown error").slice(-800)}`); return; }
    const data=savedSettingsSync();
    data.printer_name=printerName;
    data.display_name=displayName;
    data.share_printer=sharePrinter;
    saveSettingsSync(data);
    clearStatusCaches();
    setFlash(c,"success","Network printing settings applied.");
  });
  if(!lock.acquired) setFlash(c,"error","Printer settings are already being changed. Wait for that operation to finish.");
  return c.redirect("/",302);
});

app.post("/print", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  if(!currentPrinterIp()){ setFlash(c,"error","Set up the printer first."); return c.redirect("/",302); }
  const body:any=await c.req.parseBody();
  const token=String(body["_csrf_token"]||c.req.header("x-csrf-token")||"");
  if(token!==(getCookie(c,"csrf_token")||"")) return c.text("Invalid or missing CSRF token",400);
  const file=body["file"] as File|undefined;
  if(!file||!(file instanceof File)||!file.name){ setFlash(c,"error","Choose a file first."); return c.redirect("/",302); }
  const name=secureFilename(file.name);
  const suffix=extname(name).toLowerCase();
  if(![".pdf",".png",".jpg",".jpeg",".txt"].includes(suffix)){ setFlash(c,"error","Supported files: PDF, PNG, JPG and TXT."); return c.redirect("/",302); }
  let copies=1;
  try{ copies=parseInt(String(body["copies"]||"1"),10); if(!(copies>=1 && copies<=99)) throw new Error(); }catch{ setFlash(c,"error","Copies must be a whole number between 1 and 99."); return c.redirect("/",302); }
  const grayscale=body["grayscale"]==="on";
  if(file.size> MAX_UPLOAD_MB*1024*1024){ setFlash(c,"error",`That file is too large. The limit is ${MAX_UPLOAD_MB} MB.`); return c.redirect("/",302); }
  const uploadDir=join(APP_DIR,"uploads");
  mkdirSync(uploadDir,{recursive:true});
  const workDir=join(uploadDir,`print-${randomBytes(6).toString("hex")}`);
  mkdirSync(workDir,{recursive:true});
  const target=join(workDir,name);
  try{
    const buf=await file.arrayBuffer();
    await Bun.write(target, buf);
    const err=await validateUpload(target, suffix);
    if(err){ setFlash(c,"error",err); return c.redirect("/",302); }
    const result=await submitPrint(currentPrinterName(), target, {copies, grayscale, title:name});
    clearStatusCaches();
    setFlash(c, result.ok?"success":"error", result.ok?"File added to the print queue.":(result.stderr||"Print failed."));
  } finally { try{ await Bun.$`rm -rf ${workDir}`.quiet(); }catch{} }
  return c.redirect("/",302);
});

app.post("/scan", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const printerIp=currentPrinterIp();
  if(!printerIp){ setFlash(c,"error","Set up the printer first."); return c.redirect("/",302); }
  const body=await c.req.parseBody();
  const token=String(body["_csrf_token"]||c.req.header("x-csrf-token")||"");
  if(token!==(getCookie(c,"csrf_token")||"")) return c.text("Invalid or missing CSRF token",400);
  let dpi=parseInt(String(body["dpi"]||"300"),10);
  if(![150,200,300,600].includes(dpi)){ setFlash(c,"error","DPI must be 150, 200, 300 or 600."); return c.redirect("/",302); }
  const lock=await withOperationLock("scanner", async()=>{
    const [result, path]=await scanDocument(printerIp, SCAN_DIR, {dpi, mode:String(body["mode"]||"Color"), fmt:String(body["format"]||"pdf")});
    clearStatusCaches();
    if(result.ok && path){ pruneScans(); setFlash(c,"success", result.stderr||`Scan saved as ${basename(path)}.`); }
    else setFlash(c,"error", result.stderr||"Scan failed.");
  });
  if(!lock.acquired) setFlash(c,"error","A scan is already in progress. Wait for it to finish before starting another.");
  return c.redirect("/",302);
});

app.post("/jobs/:job_id/cancel", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const body=await c.req.parseBody();
  const token=String((body as any)["_csrf_token"]||c.req.header("x-csrf-token")||"");
  const expected=getCookie(c,"csrf_token")||"";
  if(!expected||token!==expected) return c.text("Invalid or missing CSRF token",400);
  const jobId=c.req.param("job_id");
  const result=await cancelJob(jobId);
  clearStatusCaches();
  setFlash(c, result.ok?"success":"error", result.ok?"Job cancelled.":result.stderr||"Could not cancel job.");
  return c.redirect("/",302);
});

app.get("/scans/:filename", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const filename=c.req.param("filename");
  const safe=basename(filename);
  const path=join(SCAN_DIR, safe);
  const file=Bun.file(path);
  if(!(await file.exists())) return c.text("Not found",404);
  const buf=await file.arrayBuffer();
  return new Response(buf, {headers:{"Content-Disposition":`attachment; filename="${safe}"`, "Content-Type": (file as any).type || "application/octet-stream"}});
});

app.get("/api/status", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  const printerIp=currentPrinterIp();
  const printerName=currentPrinterName();
  let scans:string[]=[];
  try{scans=recentScans(10).map(s=>s.name);}catch{scans=[];}
  const data:any={
    printer_ip:printerIp,
    printer_name:printerName,
    display_name:currentDisplayName(),
    network_sharing:networkSharingEnabledSync(),
    reachable: printerIp?await cachedPrinterReachable(printerIp):false,
    printer: printerIp?await cachedCupsPrinterStatus(printerName):{ok:false, state:"setup_required"},
    scanner: printerIp?await scannerStatus(printerIp):{ok:false, state:"setup_required"},
    queue: printerIp?await cachedListJobs(printerName):[],
    recent_prints: (()=>{try{return listPrintHistory(10);}catch{return [];}})(),
    scans,
  };
  return c.json(data);
});

app.get("/api/history", async(c)=>{
  const auth=requireAuth(c);
  if(auth) return auth;
  let limit=100;
  try{limit=parseInt(c.req.query("limit")||"100",10);}catch{limit=100;}
  let history:any[]=[];
  try{history=listPrintHistory(limit);}catch{history=[];}
  return c.json({history});
});

app.get("/api/health", async(c)=>{
  const result=await runCommand(["lpstat","-r"],3000);
  return c.json({ok:result.ok, service:"epson-printer-ha", cups:result.stdout||result.stderr}, result.ok?200:503);
});

app.get("/static/*", async(c)=>{
  const path=c.req.path.replace("/static/","");
  const safe=path.replace(/\.\./g,"");
  for(const cand of [join(process.cwd(),"public",safe), join(process.cwd(),"src/frontend",safe), join(process.cwd(),"app/static",safe)]){
    const f=Bun.file(cand);
    if(await f.exists()) return new Response(f);
  }
  return c.text("Not found",404);
});

app.onError((err,c)=>{
  if((err as any).message?.includes("413") || (c.req.header("content-length") && parseInt(c.req.header("content-length")!) > MAX_UPLOAD_MB*1024*1024)){
    setFlash(c,"error",`That file is too large. The limit is ${MAX_UPLOAD_MB} MB.`);
    return c.redirect("/",302);
  }
  console.error(err);
  return c.text("Internal Server Error",500);
});

export default app;
export { validateIPv4, validateQueueName, validateDisplayName, getCsrfToken, currentPrinterIp as _currentPrinterIp, savePrinterIp as _savePrinterIp };
export { AUTH_FAILURE_LIMIT, AUTH_FAILURE_WINDOW_SECONDS };

