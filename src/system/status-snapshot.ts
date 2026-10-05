import { readFileSync, statSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
export type SnapshotPart = { updated_at: string | null; refreshing: boolean; stale: boolean; error: string | null };
export function createStatusSnapshot<T extends Record<string, unknown>>(options: {
 key: () => string;
 loaders: { [K in keyof T]: () => Promise<T[K]> };
 fallback: () => T;
 path?: () => string;
 now?: () => number;
 ttlMs?: Partial<Record<keyof T, number>>;
 validate?: (name: keyof T, value: unknown) => boolean;
}) {
 const now = options.now ?? Date.now;
 const names = Object.keys(options.loaders) as Array<keyof T & string>;
 let key = "", generation = 0;
 let values: T;
 let parts: Record<string, { at: number; restored: boolean; error: string | null; attempted?: number }> = {};
 // Invalidation never clears running tasks: a second client cannot spawn a duplicate probe.
 const running = new Map<string, { generation: number; promise: Promise<void> }>();
 let persistTimer: ReturnType<typeof setTimeout> | null = null;
 function initialize() {
  const next = options.key();
  if (next === key && values) return;
  key = next; generation++; values = options.fallback(); parts = {};
  if (!options.path) return;
  try {
   const path = options.path();
   if (statSync(path).size > 256 * 1024) return;
   const saved = JSON.parse(readFileSync(path, "utf8"));
   if (saved.version !== 1 || saved.key !== key || !saved.values || !saved.parts) return;
   for (const name of names) {
    const at = saved.parts[name]?.at;
    if (typeof at !== "number" || at > now() || now() - at > 24 * 60 * 60 * 1000 || !(name in saved.values)) continue;
    // Values came from this appliance. Shape is still checked against the cold fallback.
    const value = saved.values[name], expected = values[name];
    if (!matchesShape(value, expected) || (options.validate && !options.validate(name, value))) continue;
    values[name] = value; parts[name] = { at, restored: true, error: null };
   }
  } catch { /* Cache is optional; corrupt/missing data must not prevent startup. */ }
 }
 function persist() {
  if (!options.path || persistTimer) return;
  persistTimer = setTimeout(() => {
   persistTimer = null;
   try {
    if (options.key() !== key) return;
    const path = options.path!(), serialized = JSON.stringify({ version: 1, key, values, parts });
    if (serialized.length > 256 * 1024) return;
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.tmp`; writeFileSync(temp, serialized, { mode: 0o600 }); renameSync(temp, path);
   } catch { /* Disk cache is advisory; live status stays available on a full disk. */ }
  }, 1000);
  persistTimer.unref?.();
 }
 function refresh(force = false, waitFor: Array<keyof T> = names): Promise<void> {
  initialize();
  const currentGeneration = generation;
  const tasks = names.map(name => {
   const existing = running.get(name);
   if (existing) {
    // Old-device results are discarded; recheck this component after its bounded probe finishes.
    return existing.generation === currentGeneration ? existing.promise : existing.promise.then(() => refreshPart(name, force));
   }
   return refreshPart(name, force);
  });
  return Promise.all(tasks.filter((_, index) => waitFor.includes(names[index]))).then(() => {});
 }
 function refreshPart(name: keyof T & string, force: boolean): Promise<void> {
  initialize();
  const existing = running.get(name); if (existing) return existing.promise;
  const part = parts[name], ttl = options.ttlMs?.[name] ?? 15_000;
  if (!force && part?.error && now() - (part.attempted ?? 0) < 30_000) return Promise.resolve();
  if (!force && part && !part.restored && now() - part.at < ttl) return Promise.resolve();
  const owner = generation, previousPart = parts[name];
  // Schedule the loader after the in-flight slot is installed, including synchronous throws.
  const promise = Promise.resolve().then(() => options.loaders[name]()).then(value => {
   if (owner !== generation || options.key() !== key || parts[name] !== previousPart) return;
   values[name] = value; parts[name] = { at: now(), restored: false, error: null, attempted: now() }; persist();
  }, () => {
   if (owner !== generation || options.key() !== key || parts[name] !== previousPart) return;
   const previous = parts[name];
   parts[name] = { at: previous?.at ?? 0, restored: previous?.restored ?? false, error: "Status check temporarily unavailable", attempted: now() };
   // Preserve last-known values and back off failures; no command output leaks into the UI.
  }).finally(() => { if (running.get(name)?.promise === promise) running.delete(name); });
  running.set(name, { generation: owner, promise });
  return promise;
 }
 let lastAttempt = 0;
 function background(force = false) {
  initialize();
  if (force || now() - lastAttempt >= 5000) { lastAttempt = now(); void refresh(force); }
 }
 function read() {
  initialize();
  const metadata: Record<string, SnapshotPart> = {};
  for (const name of names) {
   const part = parts[name];
   metadata[name] = { updated_at: part?.at ? new Date(part.at).toISOString() : null,
    refreshing: running.has(name), stale: !part || part.restored || !!part.error || now() - part.at >= (options.ttlMs?.[name] ?? 15_000), error: part?.error ?? null };
  }
  return { values: { ...values }, metadata };
 }
 function invalidate() { generation++; key = ""; initialize(); lastAttempt = 0; }
 function stop() { if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; } }
 return { read, refresh, background, invalidate, stop, failed(name: keyof T & string) { initialize(); const previous = parts[name]; parts[name] = { at: previous?.at ?? 0, restored: previous?.restored ?? false, attempted: now(), error: "Status check temporarily unavailable" }; }, set<K extends keyof T & string>(name: K, value: T[K]) { initialize(); values[name] = value; parts[name] = { at: now(), restored: false, error: null, attempted: now() }; persist(); } };
}

function matchesShape(value: unknown, sample: unknown): boolean {
 if (sample === null) return value === null || typeof value === "string";
 if (Array.isArray(sample)) return Array.isArray(value);
 if (typeof sample !== "object") return typeof value === typeof sample;
 if (!value || typeof value !== "object" || Array.isArray(value)) return false;
 return Object.entries(sample).every(([key, expected]) => Object.hasOwn(value, key) && matchesShape((value as Record<string, unknown>)[key], expected));
}
