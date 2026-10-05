import type { InkStatus, InkCartridge, InkKey } from "./ink-types.ts";
import { hasKnownLevel, PRETTY, COLOR_HEX } from "./ink-common.ts";
import { trySnmp } from "./snmp.ts";
import { tryIpp } from "./ipp.ts";
import { tryHttp } from "./web-status.ts";
const cache = new Map<string, { exp: number; value: InkStatus }>();
const inflight = new Map<string, Promise<InkStatus>>();
let _fetchImpl: ((host: string) => Promise<InkStatus>) | null = null;

export function _setFetchImplForTest(fn: ((host: string) => Promise<InkStatus>) | null) {
  _fetchImpl = fn;
}
/** Refresh requests join a current hardware check instead of duplicating it. */
export function clearInkCache() { cache.clear(); }
export function _clearInkCacheForTest() { cache.clear(); inflight.clear(); }

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
    if (inflight.get(host) !== p) return v;
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
    if (inflight.get(host) === p) inflight.delete(host);
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
