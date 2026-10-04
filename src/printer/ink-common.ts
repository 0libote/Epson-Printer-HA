import type { InkKey, InkCartridge } from "./ink-types.ts";
export const COLOR_HEX: Record<InkKey, string> = {
  black: "#1f2937",
  cyan: "#06b6d4",
  magenta: "#ec4899",
  yellow: "#eab308",
};
export const PRETTY: Record<InkKey, string> = { black: "Black", cyan: "Cyan", magenta: "Magenta", yellow: "Yellow" };

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

export function orderKey(k: InkKey): number {
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


export function hasKnownLevel(carts: InkCartridge[]) { return carts.some(c => c.level != null); }
