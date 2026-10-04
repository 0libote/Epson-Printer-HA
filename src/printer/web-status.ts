import type { InkKey, InkCartridge, InkStatus } from "./ink-types.ts";
import { COLOR_HEX, PRETTY, orderKey, cartridgeState, keyFromDescription, levelToPercent, hasKnownLevel } from "./ink-common.ts";
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

export async function tryHttp(host: string, timeoutMs = 4000): Promise<InkStatus | null> {
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
