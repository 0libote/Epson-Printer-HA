// Generic TTL cache with in-flight dedup: concurrent callers share one promise,
// avoiding spawn storms when many dashboard clients poll at once.
// Short negative caching: failures are also cached briefly (default 5s) so a
// down CUPS/scanner doesn't get hammered on every poll.
const failureCache = new WeakMap<object, Map<string, { exp: number; error: unknown }>>();
function failuresFor(cache: object): Map<string, { exp: number; error: unknown }> {
  let m = failureCache.get(cache);
  if (!m) { m = new Map(); failureCache.set(cache, m); }
  return m;
}
export function ttlCached<T>(cache: Map<string, { exp: number; value: T }>, inflight: Map<string, Promise<T>>, key: string, ttlMs: number, fn: () => Promise<T>, failureTtlMs = 5000): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return Promise.resolve(hit.value);
  const failHit = failureCache.get(cache)?.get(key);
  if (failHit && failHit.exp > now) return Promise.reject(failHit.error);
  // prune expired failure marker so the map can't grow with dead entries
  if (failHit) failureCache.get(cache)?.delete(key);
  const ongoing = inflight.get(key);
  if (ongoing) return ongoing;
  const p = fn().then(
    (v) => {
      if (inflight.get(key) !== p) return v;
      if (cache.size > 128) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { exp: Date.now() + ttlMs, value: v });
      inflight.delete(key);
      return v;
    },
    (e) => {
      if (inflight.get(key) === p) inflight.delete(key);
      try { failuresFor(cache).set(key, { exp: Date.now() + failureTtlMs, error: e }); } catch {}
      throw e;
    }
  );
  inflight.set(key, p);
  return p;
}

