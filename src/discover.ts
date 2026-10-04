// Network printer discovery for the Settings UI.
// Sweeps the hub's own /24 subnets for printer ports (IPP 631, raw 9100,
// LPD 515, HTTP 80) and fingerprints responders via Epson Web Config.
// Pure helpers (parseEpsonTitle, rankCandidates) are unit-tested; the live
// sweep has a test hook (_setScanImplForTest) so API tests never touch LAN.

import { localIPv4s, tcpOpen } from "./system/network.ts";
import { runCommand } from "./system/commands.ts";
import { validatePrinterAddress } from "./system/validation.ts";
import { readFileSync } from "node:fs";

export interface DiscoveredPrinter {
  ip: string;
  uuid?: string;
  mac?: string;
  hostname?: string;
  source?: "mdns" | "network";
  model: string | null;
  ports: number[];
  likelyEpson: boolean;
  detail: string;
}

export interface DiscoverResult {
  ok: boolean;
  printers: DiscoveredPrinter[];
  subnets: string[];
  scanned_at: string;
  message?: string;
}

const PROBE_PORTS = [631, 9100, 515, 80] as const;
const PROBE_TIMEOUT_MS = 250;
const FINGERPRINT_TIMEOUT_MS = 3000;
// Overall ceiling so one /api/discover call can't stall past client timeouts.
const DISCOVER_OVERALL_TIMEOUT_MS = 25_000;
const DISCOVER_CACHE_TTL_MS = 120_000;
const DISCOVER_CONCURRENCY = 64;
const FINGERPRINT_CONCURRENCY = 24;

/** Extract a display model from an Epson (or generic) status page. */
export function parseEpsonTitle(html: string): { model: string | null; looksEpson: boolean } {
  const title = html.match(/<title[^>]*>([^<]*)<\/title\s*>/i)?.[1]?.trim() ?? "";
  const modelMatch = html.match(/\b(XP|ET|WF|L|PX|EP|ST|TM|PLQ|DLQ)-[A-Z0-9]+\b/i)
    ?? title.match(/\b(XP|ET|WF|L|PX|EP|ST|TM|PLQ|DLQ)-[A-Z0-9]+\b/i);
  const looksEpson =
    /epson/i.test(title) ||
    /epson/i.test(html.slice(0, 4000)) ||
    /\/PRESENTATION\//i.test(html) ||
    /Ink_[KCMY]\.PNG/i.test(html);
  const model = modelMatch ? modelMatch[0].toUpperCase() : (title || null);
  return { model, looksEpson };
}

/** Epson-likely first, then by numeric IP. Exported for tests. */
export function rankCandidates(found: DiscoveredPrinter[]): DiscoveredPrinter[] {
  const num = (ip: string) => ip.split(".").reduce((a, p) => a * 256 + Number(p), 0);
  return [...found].sort((a, b) => {
    if (a.likelyEpson !== b.likelyEpson) return a.likelyEpson ? -1 : 1;
    return num(a.ip) - num(b.ip);
  });
}

async function probeHost(ip: string): Promise<number[]> {
  const open: number[] = [];
  await Promise.all(
    PROBE_PORTS.map(async (port) => {
      try {
        if (await tcpOpen(ip, port, PROBE_TIMEOUT_MS)) open.push(port);
      } catch { /* closed */ }
    }),
  );
  return open.sort((a, b) => a - b);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<{ text: string; server: string } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { redirect: "error", signal: ctrl.signal, headers: { Accept: "text/html" } });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") || "";
      if (ct && !ct.includes("html") && !ct.includes("text")) return null;
      let text = "";
      if (!res.body) return null;
      const reader = res.body.getReader();
      const decoder = new TextDecoder(); let bytes = 0;
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 256 * 1024) return null; text += decoder.decode(chunk.value, { stream: true }); } } finally { await reader.cancel().catch(() => {}); }
      return { text, server: res.headers.get("server") || "" };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export async function fingerprint(ip: string, ports: number[]): Promise<DiscoveredPrinter> {
  let model: string | null = null;
  let likelyEpson = false;
  let detail = `Open ports: ${ports.join(", ")}`;
  // Epson Web Config status page is the strongest signal.
  const status = await fetchWithTimeout(`http://${ip}/PRESENTATION/HTML/TOP/PRTINFO.HTML`, FINGERPRINT_TIMEOUT_MS);
  if (status) {
    const parsed = parseEpsonTitle(status.text);
    if (parsed.looksEpson) {
      likelyEpson = true;
      model = parsed.model;
      detail = model ? `Epson status page (${model})` : "Epson status page";
    } else if (/epson/i.test(status.server)) {
      likelyEpson = true;
      model = parsed.model;
      detail = "Epson web server";
    }
  }
  if (!likelyEpson) {
    // Fall back to the device root page (also catches non-Epson printers).
    const root = ports.includes(80) || ports.includes(631)
      ? await fetchWithTimeout(`http://${ip}${ports.includes(80) ? "" : ":631"}/`, FINGERPRINT_TIMEOUT_MS)
      : null;
    if (root) {
      const parsed = parseEpsonTitle(root.text);
      if (parsed.looksEpson || /epson/i.test(root.server)) {
        likelyEpson = true;
        model = parsed.model;
        detail = model ? `Web page (${model})` : "Epson web page";
      } else if (parsed.model && /cups/i.test(root.server)) {
        model = `CUPS server (${parsed.model})`;
        detail = "CUPS print server, not a printer";
      } else if (/cups/i.test(root.server)) {
        detail = "CUPS print server, not a printer";
      }
    }
  }
  if (!likelyEpson && (ports.includes(631) || ports.includes(9100))) {
    detail += " — IPP/raw printing port open, model unknown";
  }
  return { ip, model, ports, likelyEpson, detail, mac: arpIdentity(ip), source: "network" };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.max(1, Math.min(concurrency, items.length))).fill(0).map(async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Link-local is never routed to a printer; skip it so the sweep budget is spent on real LANs. */
export function usableSubnets(nets: string[]): string[] {
  return nets.filter((n) => {
    const first = Number(n.split(".")[0]);
    if (first === 169) return false; // 169.254.0.0/16 link-local
    return true;
  });
}

/** Sweep every /24 of the hub's LAN addresses for printer ports. */
export async function scanSubnets(subnets: string[]): Promise<DiscoveredPrinter[]> {
  const deadline = Date.now() + 18_000;
  const ips: string[] = [];
  const self = new Set(localIPv4s());
  for (const net of subnets) {
    for (let host = 1; host <= 254; host++) { const ip = `${net}.${host}`; if (!self.has(ip)) ips.push(ip); }
  }
  const probed = await mapPool(ips, DISCOVER_CONCURRENCY, async (ip) => ({ ip, ports: await probeHost(ip) }));
  const responders = probed.filter((p) => p.ports.length > 0);
  const fingerprinted = await mapPool(responders, FINGERPRINT_CONCURRENCY, (r) => Date.now() < deadline ? fingerprint(r.ip, r.ports) : Promise.resolve(null));
  return rankCandidates(fingerprinted.filter((p): p is DiscoveredPrinter => !!p));
}

// ── cached orchestrator (mirrors ink.ts pattern) ────────────────────
let _cache: { exp: number; value: DiscoverResult } | null = null;
let _inflight: Promise<DiscoverResult> | null = null;
let _scanImpl: (() => Promise<DiscoverResult>) | null = null;

export function _setScanImplForTest(fn: (() => Promise<DiscoverResult>) | null) {
  _scanImpl = fn;
}
export function clearDiscoverCache() {
  _cache = null;
  _inflight = null;
}
export function _clearDiscoverCacheForTest() {
  clearDiscoverCache();
}

function unknownResult(subnets: string[], message: string): DiscoverResult {
  return { ok: false, printers: [], subnets, scanned_at: new Date().toISOString(), message };
}

export async function discoverPrinters(opts: { refresh?: boolean; includeSweep?: boolean } = {}): Promise<DiscoverResult> {
  if (opts.refresh) _cache = null; // Keep an ongoing search shared, even on explicit refresh.
  const now = Date.now();
  if (!opts.includeSweep && _cache && _cache.exp > now) return _cache.value;
  if (_inflight) return _inflight;
  const p = (async (): Promise<DiscoverResult> => {
    const nets = usableSubnets([...new Set(localIPv4s().map((ip) => ip.split(".").slice(0, 3).join(".")))]);
    if (!nets.length) return unknownResult([], "No hub network address found.");
    // Test hook replaces only the sweep so cache/in-flight behaviour stays live.
    const sweep = _scanImpl ?? (async () => {
      const advertised = await discoverAdvertisedPrinters();
      const swept = opts.includeSweep || !advertised.some(p => p.likelyEpson) ? await scanSubnets(nets.slice(0, 4)) : [];
      const printers = mergeCandidates([...advertised, ...swept]);
      return { ok: true, printers, subnets: nets, scanned_at: new Date().toISOString() };
    });
    const chain = sweep();
    const timeout = new Promise<DiscoverResult>((resolve) => {
      const t = setTimeout(() => resolve(unknownResult(nets, "Network search timed out after 25s. Try again.")), DISCOVER_OVERALL_TIMEOUT_MS);
      (t as unknown as { unref?: () => void }).unref?.();
      chain.then(
        (v) => { clearTimeout(t); resolve(v); },
        () => { clearTimeout(t); resolve(unknownResult(nets, "Network search failed. Try again.")); },
      );
    });
    return timeout;
  })().then((v) => {
    _cache = { exp: Date.now() + DISCOVER_CACHE_TTL_MS, value: v };
    _inflight = null;
    return v;
  }, (e) => {
    _inflight = null;
    throw e;
  });
  _inflight = p;
  return p;
}

/** Avahi's parsable fields escape punctuation as decimal \DDD sequences. */
export function unescapeAvahi(value: string): string {
 return value.replace(/\\(\d{3})/g, (_, digits) => String.fromCharCode(Number(digits)));
}
export function parseMdnsPrinters(output: string): DiscoveredPrinter[] {
 const found: DiscoveredPrinter[] = [];
 for (const line of output.split("\n")) {
  const fields = line.split(";");
  if (fields[0] !== "=" || fields[2] !== "IPv4" || fields.length < 10) continue;
  const ip = fields[7]; try { validatePrinterAddress(ip); } catch { continue; }
  const txt: Record<string, string> = {};
  for (const match of fields.slice(9).join(";").matchAll(/"((?:\\.|[^"\\])*)"/g)) {
   const value = unescapeAvahi(match[1]); const at = value.indexOf("=");
   if (at > 0) txt[value.slice(0, at).toLowerCase()] = value.slice(at + 1).slice(0, 200);
  }
  const name = unescapeAvahi(fields[3]), hostname = unescapeAvahi(fields[6]);
  const model = txt.ty || txt.product?.replace(/^\(|\)$/g, "") || name;
  const uuid = (txt.uuid || "").replace(/^urn:uuid:/i, "").toLowerCase();
  const port = Number(fields[8]); if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
  found.push({ ip, model, ports: [port], likelyEpson: /epson/i.test(`${name} ${model} ${txt.usb_mfg || ""}`),
   hostname, uuid: /^[a-z0-9-]{8,80}$/.test(uuid) ? uuid : undefined, mac: arpIdentity(ip),
   source: "mdns", detail: "Advertised printer on your network" });
 }
 return mergeCandidates(found);
}
export function arpIdentity(ip: string, table?: string): string | undefined {
 try {
  for (const line of (table ?? readFileSync("/proc/net/arp", "utf8")).split("\n")) {
   const fields = line.trim().split(/\s+/); const mac = fields[3]?.toLowerCase();
   if (fields[0] === ip && (Number(fields[2]) & 2) && mac && /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac) && mac !== "00:00:00:00:00:00") return mac;
  }
 } catch { /* Different network or no ARP table; UUID remains preferred. */ }
 return undefined;
}
export function mergeCandidates(found: DiscoveredPrinter[]): DiscoveredPrinter[] {
 const byIp = new Map<string, DiscoveredPrinter>();
 for (const p of found) {
  const previous = byIp.get(p.ip);
  byIp.set(p.ip, previous ? { ...p, ...previous, uuid: previous.uuid || p.uuid, mac: previous.mac || p.mac,
   likelyEpson: previous.likelyEpson || p.likelyEpson, ports: [...new Set([...previous.ports, ...p.ports])], model: previous.model || p.model } : p);
 }
 return rankCandidates([...byIp.values()]);
}
export async function discoverAdvertisedPrinters(): Promise<DiscoveredPrinter[]> {
 const results = await Promise.all(["_ipp._tcp", "_ipps._tcp", "_scanner._tcp", "_uscan._tcp"].map(type =>
  runCommand(["avahi-browse", "--resolve", "--parsable", "--terminate", "--ignore-local", type], 6000)));
 return mergeCandidates(results.flatMap(result => parseMdnsPrinters(result.stdout)));
}
export async function identifyPrinter(ip: string): Promise<DiscoveredPrinter | null> {
 validatePrinterAddress(ip);
 const advertised = (await discoverAdvertisedPrinters()).find(p => p.ip === ip);
 const device = await fingerprint(ip, await probeHost(ip));
 return mergeCandidates([...(advertised ? [advertised] : []), device])[0] ?? null;
}

export function cachedDiscoveredPrinter(ip: string): DiscoveredPrinter | undefined {
 return _cache && _cache.exp > Date.now() ? _cache.value.printers.find(p => p.ip === ip) : undefined;
}
