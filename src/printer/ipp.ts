import type { InkKey, InkCartridge, InkStatus } from "./ink-types.ts";
import { COLOR_HEX, PRETTY, orderKey, cartridgeState, keyFromDescription, levelToPercent, hasKnownLevel } from "./ink-common.ts";
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

export async function tryIpp(host: string, timeoutMs = 3000): Promise<InkStatus | null> {
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
