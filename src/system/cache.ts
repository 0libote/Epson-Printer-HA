// Generic TTL cache with in-flight dedup: concurrent callers share one promise,
// avoiding spawn storms when many dashboard clients poll at once.
export function ttlCached<T>(cache: Map<string, { exp: number; value: T }>, inflight: Map<string, Promise<T>>, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return Promise.resolve(hit.value);
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
      throw e;
    }
  );
  inflight.set(key, p);
  return p;
}

