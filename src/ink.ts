// Ink levels for Epson XP-2200 (and similar Epson inkjets).
// Strategy, cheapest reliable first:
//   1. SNMP Printer-MIB (RFC 3805) prtMarkerSuppliesTable over UDP/161, community "public"
//   2. IPP Get-Printer-Attributes (marker-levels/marker-names/...) over TCP/631
//   3. Epson embedded web UI scrape (/PRESENTATION/ADVANCED/INFO_PRTINFO/TOP)
// No new system packages: SNMP is hand-rolled BER over node:dgram,
// IPP is hand-rolled binary over fetch(), HTTP scrape is plain fetch().

export type InkKey = "black" | "cyan" | "magenta" | "yellow";
export interface InkCartridge {
  key: InkKey;
  name: string;
  color: string;
  level: number | null; // 0-100 percent, null = unknown
  state: "ok" | "low" | "empty" | "unknown";
  detail: string;
}
export interface InkStatus {
  ok: boolean;
  source: "snmp" | "ipp" | "http" | "none";
  updated_at: string;
  cartridges: InkCartridge[];
  message: string;
}

const OID_DESC = "1.3.6.1.2.1.43.11.1.1.6";
const OID_MAX = "1.3.6.1.2.1.43.11.1.1.8";
const OID_LEVEL = "1.3.6.1.2.1.43.11.1.1.9";
const SNMP_PORT = 161;
// Read per-request (not import-time) so a SNMP_COMMUNITY change applies
// without a process restart.
function snmpCommunity(): string {
  try {
    return process.env.SNMP_COMMUNITY?.trim() || "public";
  } catch {
    return "public";
  }
}

const COLOR_HEX: Record<InkKey, string> = {
  black: "#1f2937",
  cyan: "#06b6d4",
  magenta: "#ec4899",
  yellow: "#eab308",
};
const PRETTY: Record<InkKey, string> = { black: "Black", cyan: "Cyan", magenta: "Magenta", yellow: "Yellow" };

export function cartridgeState(level: number | null): InkCartridge["state"] {
  if (level == null || Number.isNaN(level)) return "unknown";
  if (level <= 0) return "empty";
  if (level <= 15) return "low";
  return "ok";
}

export function keyFromDescription(desc: string): InkKey | null {
  const d = desc.toLowerCase();
  // skip non-ink supplies (waste/maintenance box)
  if (d.includes("waste") || d.includes("maintenance") || d.includes("box")) return null;
  // black: explicit word, "bk" as standalone token (e.g. "BK", "BK ink",
  // "Ink BK"), or single "k" only when paired with "ink" to avoid matching
  // random words containing k.
  if (
    d.includes("black") ||
    /(^|[^a-z])bk([^a-z]|$)/.test(d) ||
    (/(^|[^a-z])k([^a-z]|$)/.test(d) && d.includes("ink"))
  ) {
    return "black";
  }
  if (d.includes("cyan")) return "cyan";
  if (d.includes("magenta")) return "magenta";
  if (d.includes("yellow")) return "yellow";
  // short Epson forms: "BK", "C", "M", "Y" as whole description
  const t = d.trim();
  if (t === "bk" || t === "black" || t === "k") return "black";
  if (t === "c" || t === "cyan") return "cyan";
  if (t === "m" || t === "magenta") return "magenta";
  if (t === "y" || t === "yellow") return "yellow";
  // "Photo Black" etc still black
  if (t.includes("photo") && t.includes("black")) return "black";
  return null;
}

function orderKey(k: InkKey): number {
  return k === "black" ? 0 : k === "cyan" ? 1 : k === "magenta" ? 2 : 3;
}

export function levelToPercent(level: number, max: number): number | null {
  // RFC 3805 special values for prtMarkerSuppliesLevel
  if (level === -3) return 100; // full / some supply, respectively
  if (level < 0) return null; // -1 other, -2 unknown
  if (!max || max <= 0) {
    // many Epson report max=100 already; if max missing assume percent scale
    if (level >= 0 && level <= 100) return Math.round(level);
    return null;
  }
  const pct = Math.round((100 * level) / max);
  return Math.max(0, Math.min(100, pct));
}

// ── minimal SNMP BER ─────────────────────────────────────────────
function encodeLength(len: number): number[] {
  if (len < 128) return [len];
  const bytes: number[] = [];
  let n = len;
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return [0x80 | bytes.length, ...bytes];
}
function tlv(tag: number, content: number[]): number[] {
  return [tag, ...encodeLength(content.length), ...content];
}
function encodeInteger(n: number): number[] {
  if (n === 0) return tlv(0x02, [0]);
  let neg = n < 0;
  let v = neg ? -n : n;
  const bytes: number[] = [];
  while (v > 0) { bytes.unshift(v & 0xff); v = Math.floor(v / 256); }
  if (!neg && bytes[0] & 0x80) bytes.unshift(0);
  if (neg) {
    // two's complement
    for (let i = bytes.length - 1, carry = 1; i >= 0; i--) {
      const inv = (~bytes[i] & 0xff) + carry;
      bytes[i] = inv & 0xff;
      carry = inv > 0xff ? 1 : 0;
    }
    if (!(bytes[0] & 0x80)) bytes.unshift(0xff);
  }
  return tlv(0x02, bytes);
}
function encodeOctetString(s: string): number[] {
  return tlv(0x04, Array.from(Buffer.from(s, "utf-8")));
}
function encodeNull(): number[] { return [0x05, 0x00]; }
function encodeOidStr(oid: string): number[] {
  const parts = oid.split(".").map(Number);
  const out: number[] = [40 * parts[0] + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let n = parts[i];
    const stack: number[] = [n & 0x7f];
    n >>= 7;
    while (n > 0) { stack.unshift((n & 0x7f) | 0x80); n >>= 7; }
    for (let j = 0; j < stack.length - 1; j++) stack[j] |= 0x80;
    out.push(...stack);
  }
  return tlv(0x06, out);
}
function buildSnmpGet(community: string, oid: string, requestId: number, getNext: boolean): Buffer {
  const varbind = tlv(0x30, [...encodeOidStr(oid), ...encodeNull()]);
  const varbindList = tlv(0x30, varbind);
  const pduContent = [...encodeInteger(requestId), ...encodeInteger(0), ...encodeInteger(0), ...varbindList];
  const pdu = tlv(getNext ? 0xa1 : 0xa0, pduContent);
  const msg = tlv(0x30, [...encodeInteger(0), ...encodeOctetString(community), ...pdu]);
  return Buffer.from(msg);
}

interface Tlv { tag: number; value: Buffer; children?: Tlv[]; int?: number; oid?: string }
function readTlv(buf: Buffer, off: number): { node: Tlv; next: number } {
  const tag = buf[off]; let pos = off + 1;
  let len = buf[pos++];
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[pos++];
  }
  const value = buf.subarray(pos, pos + len);
  const node: Tlv = { tag, value };
  if (tag === 0x02 && len <= 4) {
    let v = 0;
    for (let i = 0; i < len; i++) v = (v << 8) | value[i];
    // sign extend
    if (len > 0 && value[0] & 0x80) v -= 2 ** (len * 8);
    node.int = v;
  }
  if (tag === 0x06) {
    const parts: number[] = [];
    if (value.length) {
      parts.push(Math.floor(value[0] / 40), value[0] % 40);
      let n = 0;
      for (let i = 1; i < value.length; i++) {
        n = (n << 7) | (value[i] & 0x7f);
        if (!(value[i] & 0x80)) { parts.push(n); n = 0; }
      }
    }
    node.oid = parts.join(".");
  }
  if (tag === 0x30 || tag === 0xa0 || tag === 0xa1 || tag === 0xa2) {
    const children: Tlv[] = [];
    let p = 0;
    while (p < value.length) {
      const r = readTlv(value, p);
      children.push(r.node);
      p = r.next;
    }
    node.children = children;
  }
  return { node, next: pos + len };
}

export function decodeSnmpResponse(buf: Buffer): { requestId: number; oid: string; value: Tlv | null; error: number } {
  const { node } = readTlv(buf, 0);
  const pdu = node.children?.[2];
  const requestId = pdu?.children?.[0]?.int ?? -1;
  const error = pdu?.children?.[1]?.int ?? 1;
  const varbindList = pdu?.children?.[3];
  const first = varbindList?.children?.[0];
  const oid = first?.children?.[0]?.oid ?? "";
  const value = first?.children?.[1] ?? null;
  return { requestId, oid, value, error };
}
function snmpValueToNumber(v: Tlv | null): number | null {
  if (!v) return null;
  if (v.tag === 0x02 || v.tag === 0x41 || v.tag === 0x42 || v.tag === 0x43) {
    if (v.int !== undefined) return v.int;
    const b = v.value;
    let n = 0;
    for (const byte of b) n = (n << 8) | byte;
    return n;
  }
  return null;
}
function snmpValueToString(v: Tlv | null): string {
  if (!v) return "";
  if (v.tag === 0x04) return v.value.toString("utf-8").replace(/\0+$/g, "").trim();
  if (v.tag === 0x02 && v.int !== undefined) return String(v.int);
  return "";
}

let _reqId = 1;

async function snmpRequest(host: string, oid: string, getNext: boolean, timeoutMs = 2000): Promise<{ oid: string; value: Tlv | null }> {
  const { default: dgram } = await import("node:dgram");
  const reqId = (_reqId = (_reqId + 1) % 0x7fffffff) || 1;
  const payload = buildSnmpGet(snmpCommunity(), oid, reqId, getNext);
  return new Promise((resolve, reject) => {
    const sock: any = dgram.createSocket("udp4");
    const timer = setTimeout(() => { try { sock.close(); } catch {} reject(new Error("snmp timeout")); }, timeoutMs);
    sock.on("error", (e: any) => { clearTimeout(timer); try { sock.close(); } catch {} reject(e); });
    sock.on("message", (msg: Buffer) => {
      clearTimeout(timer);
      try { sock.close(); } catch {}
      try {
        const decoded = decodeSnmpResponse(msg);
        if (decoded.requestId !== reqId) { reject(new Error("snmp request-id mismatch")); return; }
        if (decoded.error !== 0) { reject(new Error(`snmp error ${decoded.error}`)); return; }
        resolve({ oid: decoded.oid, value: decoded.value });
      } catch (e) { reject(e); }
    });
    sock.send(payload, SNMP_PORT, host, (err: any) => { if (err) { clearTimeout(timer); try { sock.close(); } catch {} reject(err); } });
  });
}

async function snmpWalk(host: string, base: string, timeoutMs = 2000, maxRows = 12): Promise<Array<{ oid: string; value: Tlv | null }>> {
  const rows: Array<{ oid: string; value: Tlv | null }> = [];
  let cursor = base;
  for (let i = 0; i < maxRows; i++) {
    const res = await snmpRequest(host, cursor, true, timeoutMs);
    if (!res.oid.startsWith(base + ".")) break;
    rows.push(res);
    cursor = res.oid;
  }
  return rows;
}

function rowIndex(oid: string, base: string): string {
  return oid.slice(base.length + 1); // e.g. "1.4" for hrDevice-indexed tables
}

function hasKnownLevel(carts: InkCartridge[]): boolean {
  return carts.some((c) => c.level != null);
}

async function trySnmp(host: string): Promise<InkStatus | null> {
  // Tolerate partial failures: a missing MAX column (or any single timed-out
  // walk) must not discard usable DESC+LEVEL data. Default an absent max to
  // the percent scale (levelToPercent handles max<=0).
  const [descsR, maxesR, levelsR] = await Promise.allSettled([
    snmpWalk(host, OID_DESC),
    snmpWalk(host, OID_MAX),
    snmpWalk(host, OID_LEVEL),
  ]);
  const descs = descsR.status === "fulfilled" ? descsR.value : [];
  const maxes = maxesR.status === "fulfilled" ? maxesR.value : [];
  const levels = levelsR.status === "fulfilled" ? levelsR.value : [];
  if (!descs.length || !levels.length) return null;
  const maxByIdx = new Map<string, number | null>();
  for (const r of maxes) maxByIdx.set(rowIndex(r.oid, OID_MAX), snmpValueToNumber(r.value));
  const levelByIdx = new Map<string, number | null>();
  for (const r of levels) levelByIdx.set(rowIndex(r.oid, OID_LEVEL), snmpValueToNumber(r.value));
  const carts: InkCartridge[] = [];
  for (const r of descs) {
    const idx = rowIndex(r.oid, OID_DESC);
    const desc = snmpValueToString(r.value);
    const key = keyFromDescription(desc);
    if (!key) continue;
    const raw = levelByIdx.get(idx);
    const max = maxByIdx.get(idx);
    if (raw == null) continue;
    const pct = levelToPercent(raw, max ?? 100);
    carts.push({
      key,
      name: PRETTY[key],
      color: COLOR_HEX[key],
      level: pct,
      state: cartridgeState(pct),
      detail: `${desc} (${raw}${max ? `/${max}` : ""})`,
    });
  }
  if (!carts.length) return null;
  carts.sort((a, b) => orderKey(a.key) - orderKey(b.key));
  // de-dupe (some printers expose each color twice); prefer a known level
  const seen = new Map<InkKey, InkCartridge>();
  for (const c of carts) {
    const prev = seen.get(c.key);
    if (!prev || (prev.level == null && c.level != null)) seen.set(c.key, c);
  }
  const unique = [...seen.values()].sort((a, b) => orderKey(a.key) - orderKey(b.key));
  return {
    ok: unique.some((c) => c.level != null),
    source: "snmp",
    updated_at: new Date().toISOString(),
    cartridges: unique,
    message: unique.some((c) => c.level != null) ? `Read via SNMP Printer-MIB from ${host}` : "SNMP reachable but no usable supply levels",
  };
}

// ── IPP Get-Printer-Attributes ───────────────────────────────────
function encodeIppString(tag: number, name: string, value: string): number[] {
  const nb = Buffer.from(name, "utf-8");
  const vb = Buffer.from(value, "utf-8");
  return [tag, (nb.length >> 8) & 0xff, nb.length & 0xff, ...nb, (vb.length >> 8) & 0xff, vb.length & 0xff, ...vb];
}
function buildIppGetPrinterAttributes(printerUri: string): Buffer {
  const out: number[] = [0x01, 0x01, 0x00, 0x0b, 0x00, 0x00, 0x00, 0x01, 0x01];
  out.push(...encodeIppString(0x47, "attributes-charset", "utf-8"));
  out.push(...encodeIppString(0x48, "attributes-natural-language", "en"));
  out.push(...encodeIppString(0x45, "printer-uri", printerUri));
  const wanted = ["marker-names", "marker-colors", "marker-levels", "marker-types", "marker-high-levels", "marker-low-levels"];
  for (const w of wanted) out.push(...encodeIppString(0x44, "requested-attributes", w));
  out.push(0x03);
  return Buffer.from(out);
}

export function parseIppAttributes(buf: Buffer): Map<string, Array<{ tag: number; value: Buffer | number | string }>> {
  const attrs = new Map<string, Array<{ tag: number; value: Buffer | number | string }>>();
  if (buf.length < 8) return attrs;
  let pos = 8;
  let currentName = "";
  let currentTag = 0;
  const pushVal = (tag: number, name: string, val: Buffer | number | string) => {
    const key = name || currentName;
    if (!key) return;
    if (!attrs.has(key)) attrs.set(key, []);
    attrs.get(key)!.push({ tag, value: val });
  };
  while (pos < buf.length) {
    const tag = buf[pos++];
    if (tag === 0x03) break;
    if (tag === 0x01 || tag === 0x02 || tag === 0x04 || tag === 0x05) { currentName = ""; continue; }
    if (pos + 4 > buf.length) break;
    const nameLen = (buf[pos] << 8) | buf[pos + 1]; pos += 2;
    let name = "";
    if (nameLen > 0) {
      name = buf.subarray(pos, pos + nameLen).toString("utf-8");
      pos += nameLen;
      currentName = name;
      currentTag = tag;
    } else {
      tag as unknown;
      // continuation of previous attribute: keep currentName/currentTag
    }
    const effTag = nameLen > 0 ? tag : currentTag;
    if (pos + 2 > buf.length) break;
    const valLen = (buf[pos] << 8) | buf[pos + 1]; pos += 2;
    const valBytes = buf.subarray(pos, pos + valLen); pos += valLen;
    let val: Buffer | number | string = valBytes;
    if (effTag === 0x21 || effTag === 0x23) {
      let n = 0;
      for (const b of valBytes) n = (n << 8) | b;
      if (valBytes.length === 4 && valBytes[0] & 0x80) n -= 2 ** 32;
      val = n;
    } else if ([0x44, 0x42, 0x41, 0x47, 0x48, 0x45, 0x46, 0x35, 0x36].includes(effTag)) {
      val = valBytes.toString("utf-8");
    }
    pushVal(effTag, nameLen > 0 ? name : currentName, val);
  }
  return attrs;
}

function ippVals(attrs: Map<string, any[]>, key: string): any[] {
  return (attrs.get(key) || []).map((e) => e.value);
}

export function parsePrinterSupplyEntry(entry: string): { key: InkKey | null; level: number | null } {
  // printer-supply entries look like
  // "type=inkCartridge;...;colorant=K;...;level=80;..." — extract the level and
  // map the color from the colorant/name fields.
  const levelM = entry.match(/level\s*=\s*(-?\d+)/i);
  const raw = levelM ? Number.parseInt(levelM[1], 10) : NaN;
  const level = !Number.isFinite(raw) ? null : raw === -3 ? 100 : raw < 0 ? null : Math.max(0, Math.min(100, Math.round(raw)));
  const colorM = entry.match(/colorant\s*=\s*([^;,\s]+)/i) || entry.match(/color\s*=\s*([^;,\s]+)/i);
  // Single-letter colorant codes (K/C/M/Y) never match keyFromDescription's
  // whole-string rules, so map them directly first.
  const code = (colorM?.[1] ?? "").trim().toLowerCase();
  const direct: Record<string, InkKey> = {
    k: "black", bk: "black", black: "black",
    c: "cyan", cyan: "cyan",
    m: "magenta", magenta: "magenta",
    y: "yellow", yellow: "yellow",
  };
  const key = direct[code] ?? keyFromDescription(`${colorM?.[1] ?? ""} ${entry.slice(0, 80)}`);
  return { key, level };
}

async function tryIpp(host: string, timeoutMs = 3000): Promise<InkStatus | null> {
  const paths = ["/ipp/print", "/ipp/print?version=1.1", "/Epson_IPP_Printer"];
  let lastErr = "";
  for (const path of paths) {
    const uri = `ipp://${host}:631${path.split("?")[0]}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`http://${host}:631${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/ipp", Accept: "application/ipp" },
        body: buildIppGetPrinterAttributes(uri) as any,
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const bytes = Buffer.from(await res.arrayBuffer());
      const attrs = parseIppAttributes(bytes);
      const names = ippVals(attrs, "marker-names").map(String);
      const colors = ippVals(attrs, "marker-colors").map(String);
      const levels = ippVals(attrs, "marker-levels").map(Number);
      const carts: InkCartridge[] = [];
      if (levels.length) {
        for (let i = 0; i < levels.length; i++) {
          const name = names[i] ?? colors[i] ?? `Supply ${i + 1}`;
          const key = keyFromDescription(`${name} ${colors[i] ?? ""}`);
          if (!key) continue;
          const raw = levels[i];
          const pct = raw === -3 ? 100 : raw < 0 ? null : Math.max(0, Math.min(100, Math.round(raw)));
          carts.push({ key, name: PRETTY[key], color: COLOR_HEX[key], level: pct, state: cartridgeState(pct), detail: `${name} (marker-levels=${raw})` });
        }
      } else {
        // Fallback within the same IPP response: CUPS and some firmware expose
        // supplies as printer-supply / printer-supply-description instead.
        const supplies = [...ippVals(attrs, "printer-supply").map(String), ...ippVals(attrs, "printer-supply-description").map(String)];
        if (!supplies.length) { lastErr = "no marker-levels"; continue; }
        for (const entry of supplies) {
          const { key, level } = parsePrinterSupplyEntry(entry);
          if (!key) continue;
          carts.push({ key, name: PRETTY[key], color: COLOR_HEX[key], level, state: cartridgeState(level), detail: entry.slice(0, 120) });
        }
      }
      if (!carts.length) { lastErr = "no mappable markers"; continue; }
      // An all-unknown marker set (e.g. marker-levels=-2) must not shadow the
      // HTTP web-scrape fallback — keep probing the next path/source.
      if (!hasKnownLevel(carts)) { lastErr = "marker levels all unknown"; continue; }
      carts.sort((a, b) => orderKey(a.key) - orderKey(b.key));
      return {
        ok: true,
        source: "ipp",
        updated_at: new Date().toISOString(),
        cartridges: carts,
        message: `Read via IPP Get-Printer-Attributes from ${host}`,
      };
    } catch (e: any) {
      lastErr = String(e?.message || e);
    }
  }
  void lastErr;
  return null;
}

// ── Epson web UI scrape ──────────────────────────────────────────
// Full-scale bar height on Epson Web Config status pages. Real pages render
// e.g. <img ... src='.../Ink_K.PNG' height='48'> next to <div class='clrname'>BK</div>
// and the community standard (Home Assistant command_line sensors, ioBroker,
// ha-epson-workforce which computes px*2) is 50px == 100%.
export const EPSON_WEB_FULL_BAR_PX = 50;

const TANK_LABEL_TO_KEY: Record<string, InkKey> = {
  BK: "black", K: "black", BLACK: "black", PB: "black",
  C: "cyan", CYAN: "cyan",
  M: "magenta", MAGENTA: "magenta",
  Y: "yellow", YELLOW: "yellow",
};

function tankChunkLevel(chunk: string): number | null {
  // Prefer the level from linear-gradient (second percentage stop).
  const gradIdx = chunk.toLowerCase().indexOf("linear-gradient");
  if (gradIdx >= 0) {
    const nums = [...chunk.slice(gradIdx, gradIdx + 400).matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)]
      .map((x) => Number.parseFloat(x[1]))
      .filter((n) => Number.isFinite(n));
    if (nums.length >= 2) return Math.max(0, Math.min(100, Math.round(nums[1])));
  }
  // Inline-style height in px (50px == full).
  const styleH = chunk.match(/style\s*=\s*["'][^"']*?height\s*:\s*(\d+)/i);
  if (styleH) return Math.max(0, Math.min(100, Number.parseInt(styleH[1], 10) * 2));
  // Classic bar image height attribute.
  const imgH = chunk.match(/<img[^>]*?height\s*=\s*["']?(\d+)/i);
  if (imgH) return Math.max(0, Math.min(100, Number.parseInt(imgH[1], 10) * 2));
  return null;
}

function parseEpsonTankListItems(html: string): InkCartridge[] | null {
  const perKey = new Map<InkKey, { level: number; detail: string }>();
  const segments = html.split(/<li[\s>]/i);
  // segments[0] is the page head before the first <li>; still scan it in case
  // the page has no <li> at all — the caller treats empty as "try fallback",
  // so only accept li-shaped segments here.
  let foundLi = false;
  for (let i = 1; i < segments.length; i++) {
    const chunk = segments[i].slice(0, segments[i].search(/<\/li\s*>/i) >= 0 ? segments[i].search(/<\/li\s*>/i) : segments[i].length);
    if (!/class\s*=\s*["'][^"']*\btank\b/i.test(chunk)) continue;
    foundLi = true;
    // Maintenance/waste-box row — never an ink cartridge.
    if (/mbicn/i.test(chunk) || /Ink_Waste/i.test(chunk)) continue;
    const labelM = chunk.match(/clrname[^>]*>\s*([A-Za-z]+)\s*</i);
    let key: InkKey | undefined;
    if (labelM) key = TANK_LABEL_TO_KEY[labelM[1].toUpperCase()];
    if (!key) {
      const inkM = chunk.match(/Ink_(K|C|M|Y)/i);
      if (inkM) key = TANK_LABEL_TO_KEY[inkM[1].toUpperCase()];
    }
    if (!key) continue;
    const level = tankChunkLevel(chunk);
    if (level == null) continue;
    const prev = perKey.get(key);
    if (!prev || level > prev.level) {
      perKey.set(key, { level, detail: `Web status tank ${key} ${level}%` });
    }
  }
  if (!foundLi) return null; // no li.tank structure — caller tries page-wide fallback
  if (!perKey.size) return null;
  return [...perKey.entries()]
    .map(([key, v]) => ({ key, name: PRETTY[key], color: COLOR_HEX[key], level: v.level, state: cartridgeState(v.level), detail: v.detail }))
    .sort((a, b) => orderKey(a.key) - orderKey(b.key));
}

export function parseEpsonInkHtml(html: string): InkCartridge[] | null {
  // Primary: per-cartridge <li class="tank"> blocks, mirroring the structure of
  // real Epson Web Config pages (see ha-epson-workforce fixtures):
  //   <li class='tank'><div class='tank'><img .../Ink_K.PNG height='48'></div>
  //   <div class='clrname'>BK</div></li>
  // The maintenance-box row (Ink_Waste.PNG / mbicn) is skipped. Levels come
  // from linear-gradient percentages, inline-style heights, or img heights.
  const liLevels = parseEpsonTankListItems(html);
  if (liLevels) return liLevels;
  // Fallback for pages without the li.tank structure: page-wide img heights.
  // Ink_Waste.PNG (maintenance box) intentionally does not match K|C|M|Y.
  const heights = new Map<string, number>();
  const take = (code: string, h: number) => {
    if (!Number.isFinite(h) || h < 0) return;
    const prev = heights.get(code) ?? 0;
    heights.set(code, Math.max(prev, h));
  };
  const imgRe = /Ink_(K|C|M|Y)[^>]*?height\s*=\s*["']?(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) take(m[1].toUpperCase(), Number.parseInt(m[2], 10));
  if (!heights.size) {
    // fallback: textual percentages near color names
    const text = html.replace(/<[^>]*>/g, " ");
    const out: InkCartridge[] = [];
    for (const [label, key] of [["black", "black"], ["cyan", "cyan"], ["magenta", "magenta"], ["yellow", "yellow"]] as Array<[string, InkKey]>) {
      const rx = new RegExp(label + `[^\\d]{0,40}(\\d{1,3})\\s*%`, "i");
      const mm = text.match(rx);
      if (mm) {
        const pct = Math.max(0, Math.min(100, Number.parseInt(mm[1], 10)));
        out.push({ key, name: PRETTY[key], color: COLOR_HEX[key], level: pct, state: cartridgeState(pct), detail: "Parsed from printer web page text" });
      }
    }
    return out.length ? out.sort((a, b) => orderKey(a.key) - orderKey(b.key)) : null;
  }
  // Scale against the known 50px full-scale bar. If a skin ever uses taller
  // bars, scale against the observed max instead so levels never clip at 100
  // for every cartridge.
  const observed = Math.max(...heights.values());
  if (!observed) return null;
  const full = observed > EPSON_WEB_FULL_BAR_PX ? observed : EPSON_WEB_FULL_BAR_PX;
  const codeToKey: Record<string, InkKey> = { K: "black", C: "cyan", M: "magenta", Y: "yellow" };
  const carts: InkCartridge[] = [];
  for (const [code, h] of heights) {
    const key = codeToKey[code];
    const pct = Math.max(0, Math.min(100, Math.round((100 * h) / full)));
    carts.push({ key, name: PRETTY[key], color: COLOR_HEX[key], level: pct, state: cartridgeState(pct), detail: `Web status bar height ${h}/${full}` });
  }
  return carts.sort((a, b) => orderKey(a.key) - orderKey(b.key));
}

async function tryHttp(host: string, timeoutMs = 4000): Promise<InkStatus | null> {
  // /PRESENTATION/HTML/TOP/PRTINFO.HTML first: this is the page the Home
  // Assistant / ioBroker community integrations scrape successfully.
  const paths = [
    "/PRESENTATION/HTML/TOP/PRTINFO.HTML",
    "/PRESENTATION/ADVANCED/INFO_PRTINFO/TOP",
    "/PRESENTATION/ADVANCED/HTML/PRTINFO.HTML",
  ];
  const urls: string[] = [];
  for (const scheme of ["http", "https"]) for (const p of paths) urls.push(`${scheme}://${host}${p}`);
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "text/html" } }).finally(() => clearTimeout(timer));
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";
      // Some printers answer unknown paths with 200 + non-HTML; skip those.
      if (ct && !ct.includes("html") && !ct.includes("text")) continue;
      const html = await res.text();
      // one defensive session-language POST is done by some integrations; skip — parse is locale-independent
      const carts = parseEpsonInkHtml(html);
      if (carts?.length) {
        return { ok: true, source: "http", updated_at: new Date().toISOString(), cartridges: carts, message: `Read from printer web status page` };
      }
    } catch { /* try next */ }
  }
  return null;
}

// ── orchestrator + cache ─────────────────────────────────────────
const cache = new Map<string, { exp: number; value: InkStatus }>();
const inflight = new Map<string, Promise<InkStatus>>();
let _fetchImpl: ((host: string) => Promise<InkStatus>) | null = null;

export function _setFetchImplForTest(fn: ((host: string) => Promise<InkStatus>) | null) {
  _fetchImpl = fn;
}
/** Drop cached levels and in-flight polls (used by ?refresh=1 and tests). */
export function clearInkCache() { cache.clear(); inflight.clear(); }
export function _clearInkCacheForTest() { clearInkCache(); }

function unknownStatus(host: string, message: string): InkStatus {
  const cartridges: InkCartridge[] = (["black", "cyan", "magenta", "yellow"] as InkKey[]).map((key) => ({
    key, name: PRETTY[key], color: COLOR_HEX[key], level: null, state: "unknown" as const, detail: message,
  }));
  return { ok: false, source: "none", updated_at: new Date().toISOString(), cartridges, message };
}

export async function fetchInkLevels(host: string): Promise<InkStatus> {
  if (_fetchImpl) return _fetchImpl(host);
  if (!host) return unknownStatus(host, "Printer IP is not configured");
  // Hard ceiling: SNMP walks + IPP probes + HTTP scrapes can each stall on a
  // sleeping printer. Never let one /api/ink call hang for ~45s and trip
  // client/HA timeouts — race the whole chain against a single deadline.
  const INK_OVERALL_TIMEOUT_MS = 20_000;
  const chain = (async (): Promise<InkStatus> => {
    // SNMP first (fast LAN UDP), then IPP, then HTTP scrape. A source only
    // wins if it reports at least one known level: consumer Epsons often
    // answer SNMP/IPP with all-unknown sentinels (-1/-2) while the web status
    // page still shows real bars. Accepting an all-unknown result here used
    // to shadow the working fallback behind it.
    try {
      const snmp = await trySnmp(host);
      if (snmp && snmp.cartridges.length && hasKnownLevel(snmp.cartridges)) return snmp;
    } catch {}
    try {
      const ipp = await tryIpp(host);
      if (ipp && ipp.cartridges.length && hasKnownLevel(ipp.cartridges)) return ipp;
    } catch {}
    try {
      const http = await tryHttp(host);
      if (http && http.cartridges.length) return http;
    } catch {}
    return unknownStatus(host, "No ink data: SNMP/IPP/web status all unreachable. Check the printer is awake.");
  })();
  const timeout = new Promise<InkStatus>((resolve) => {
    const t = setTimeout(() => {
      resolve(unknownStatus(host, "Ink check timed out after 20s. The printer may be asleep; try again."));
    }, INK_OVERALL_TIMEOUT_MS);
    // don't let the timer hold the process open on its own
    (t as any).unref?.();
    chain.then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(unknownStatus(host, "No ink data: SNMP/IPP/web status all unreachable. Check the printer is awake.")); },
    );
  });
  return timeout;
}

export async function getInkLevels(host: string): Promise<InkStatus> {
  if (!host) return unknownStatus(host, "Printer IP is not configured");
  const now = Date.now();
  const hit = cache.get(host);
  if (hit && hit.exp > now) return hit.value;
  const ongoing = inflight.get(host);
  if (ongoing) return ongoing;
  const p = fetchInkLevels(host).then((v) => {
    // cache successes 2 min, failures 30 s (don't hammer a sleeping printer)
    const ttl = v.ok ? 120_000 : 30_000;
    if (cache.size > 64) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(host, { exp: Date.now() + ttl, value: v });
    inflight.delete(host);
    return v;
  }, (e) => {
    inflight.delete(host);
    throw e;
  });
  inflight.set(host, p);
  return p;
}

/** Non-blocking read for /api/status: never stall the dashboard on ink. */
export function getCachedInkLevels(host: string): InkStatus | null {
  const hit = cache.get(host);
  if (hit && hit.exp > Date.now()) return hit.value;
  // kick off a background refresh (fire-and-forget) so the next poll has data
  if (host && !inflight.has(host)) {
    getInkLevels(host).catch(() => {});
  }
  return hit?.value ?? null;
}
