import { createConnection } from "node:net";
import { networkInterfaces } from "node:os";
import { ttlCached } from "./cache.ts";
export function tcpOpen(host: string, port: number, timeout = 1000): Promise<boolean> {
  if (!host) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let fallback: any = null;
    const done = (v: boolean) => {
      if (settled) return;
      settled = true;
      if (fallback) clearTimeout(fallback);
      try { socket.destroy(); } catch {}
      resolve(v);
    };
    const socket = createConnection({ host, port, timeout }, () => {
      try { socket.end(); } catch {}
      done(true);
    });
    socket.on("error", () => done(false));
    socket.on("timeout", () => done(false));
    // hard fallback so a hung kernel connect can never leak the socket
    fallback = setTimeout(() => done(false), timeout + 500);
    (fallback as any).unref?.();
  });
}

export async function printerReachable(host: string): Promise<boolean> {
  // tighter timeout per port 0.35s keeps offline under 1.2s
  for (const port of [631, 9100, 515] as const) {
    if (await tcpOpen(host, port, 350)) return true;
  }
  return false;
}

// TTL caches with in-flight dedup (no bucket churn, bounded size)
const reachableCache = new Map<string, { exp: number; value: boolean }>();
const reachableInflight = new Map<string, Promise<boolean>>();
export async function cachedPrinterReachable(host: string): Promise<boolean> {
  return ttlCached(reachableCache, reachableInflight, host, 10_000, () => printerReachable(host));
}

export interface PrinterNetworkHint {
  /** Hub's own LAN IPv4 addresses (non-internal), so the UI can show them. */
  serverIps: string[];
  /**
   * Whether the configured printer IP looks like it's on the same /24 as one
   * of the hub's addresses. Null when it can't be determined (no printer IP,
   * unparseable IP, or the hub has no LAN address to compare against).
   * Home LANs are near-universally /24, which is all this heuristic assumes.
   */
  sameSubnet: boolean | null;
  /** Actionable one-liner for the dashboard when the printer is unreachable. */
  hint: string;
}

/** Non-internal IPv4 addresses of this hub (host networking: the LAN address). */
export function localIPv4s(): string[] {
  const out: string[] = [];
  try {
    for (const addrs of Object.values(networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === "IPv4" && !a.internal) out.push(a.address);
      }
    }
  } catch { /* no network info — caller treats as undetermined */ }
  return [...new Set(out)];
}

function slash24(ip: string): string | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => n < 0 || n > 255)) return null;
  return nums.slice(0, 3).join(".");
}

export function printerNetworkHint(printerIp: string, serverIps: string[], reachable: boolean): PrinterNetworkHint {
  const sameSubnet = (() => {
    const printerNet = slash24(printerIp);
    if (!printerNet || !serverIps.length) return null;
    return serverIps.some((s) => slash24(s) === printerNet);
  })();
  let hint: string;
  if (reachable) {
    hint = `Printer ${printerIp || "unknown"} is responding on the network.`;
  } else if (!printerIp) {
    hint = "No printer address is configured yet.";
  } else if (sameSubnet === false) {
    hint = `Printer ${printerIp} is not responding and is on a different network than this hub (${serverIps.join(", ")}). Put the printer on the same Wi-Fi/network as the hub, or update its address in Settings.`;
  } else {
    hint = `Printer ${printerIp} is not responding. Check it is powered on with solid Wi-Fi${serverIps.length ? ` on the same network as this hub (${serverIps.join(", ")})` : ""}; if its address changed (DHCP), update it in Settings and consider a router address reservation.`;
  }
  return { serverIps, sameSubnet, hint };
}


export function clearNetworkCache() { reachableCache.clear(); reachableInflight.clear(); }
