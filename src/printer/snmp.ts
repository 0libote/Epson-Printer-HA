import type { InkKey, InkCartridge, InkStatus } from "./ink-types.ts";
import { COLOR_HEX, PRETTY, orderKey, cartridgeState, keyFromDescription, levelToPercent, hasKnownLevel } from "./ink-common.ts";
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

export async function trySnmp(host: string): Promise<InkStatus | null> {
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
