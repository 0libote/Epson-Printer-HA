import {
  accessSync,
  constants,
  readdirSync,
  lstatSync,
  statfsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

export type ScanRetentionPolicy = "keep-all" | "delete-oldest";
export type ScanStorage = {
  total: number;
  reserved: number;
  max: number;
  policy: ScanRetentionPolicy;
  available_bytes: number;
  full: boolean;
};
export type ScanFile = {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
};
export class ScanStorageError extends Error {
  constructor(
    message: string,
    public status: 409 | 503 = 503,
  ) {
    super(message);
  }
}
export type ScanReservation = {
  commit: (name: string) => void;
  release: () => void;
};
const MIN_FREE_BYTES = 32 * 1024 * 1024;

export function scanRetentionPolicy(
  value: string | undefined,
): ScanRetentionPolicy {
  if (!value || value === "keep-all") return "keep-all";
  if (value === "delete-oldest") return "delete-oldest";
  throw new Error("SCAN_RETENTION_POLICY must be keep-all or delete-oldest");
}

/** One index and capacity ledger for every publisher in this hub process.
 * Reservations count accepted scans as well as PDFs still being assembled. */
export function createScanLibrary(options: {
  directory: () => string;
  limit: () => number;
  policy: ScanRetentionPolicy;
  freeBytes?: () => number;
}) {
  let cached: { directory: string; at: number; files: ScanFile[] } | null =
    null;
  const pending = new Map<symbol, { directory: string; rotating: boolean }>();
  const invalidate = () => {
    cached = null;
  };
  function entries(fresh = false): ScanFile[] {
    const directory = options.directory();
    if (
      !fresh &&
      cached?.directory === directory &&
      Date.now() - cached.at < 1000
    )
      return [...cached.files];
    try {
      const files = readdirSync(directory)
        .filter(
          (name) => !name.startsWith(".") && /\.(pdf|png|jpe?g)$/i.test(name),
        )
        .flatMap((name) => {
          const path = join(directory, name);
          try {
            const stat = lstatSync(path);
            return stat.isFile()
              ? [{ name, path, size: stat.size, mtimeMs: stat.mtimeMs }]
              : [];
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw error;
          }
        });
      files.sort(
        (a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name),
      );
      cached = { directory, at: Date.now(), files };
      return [...files];
    } catch {
      throw new ScanStorageError(
        "Saved scans are unavailable. Check the hub's data volume and try again.",
      );
    }
  }
  function freeBytes() {
    if (options.freeBytes) return options.freeBytes();
    try {
      const info = statfsSync(options.directory());
      return Math.max(
        0,
        Math.min(Number.MAX_SAFE_INTEGER, info.bavail * info.bsize),
      );
    } catch {
      return -1;
    }
  }
  function reservations() {
    return [...pending.values()].filter(
      (entry) => entry.directory === options.directory(),
    );
  }
  function usage(): ScanStorage {
    const total = entries().length,
      reserved = reservations().length,
      max = options.limit();
    return {
      total,
      reserved,
      max,
      policy: options.policy,
      available_bytes: freeBytes(),
      full: total + reserved >= max,
    };
  }
  function reserve(allowRotation = false): ScanReservation {
    const directory = options.directory();
    const files = entries(true),
      waiting = reservations(),
      available = freeBytes();
    try {
      accessSync(directory, constants.W_OK);
    } catch {
      throw new ScanStorageError(
        "The saved-scan folder is not writable. Check the hub's data-volume permissions before scanning.",
      );
    }
    if (available >= 0 && available < MIN_FREE_BYTES)
      throw new ScanStorageError(
        "The hub has less than 32 MB of free space. Download and delete unneeded scans or free storage before scanning.",
      );
    const rotating = allowRotation && options.policy === "delete-oldest";
    if (waiting.some((entry) => entry.rotating) || (rotating && waiting.length))
      throw new ScanStorageError(
        "Another document is being saved. Wait for it to finish before starting this operation.",
        409,
      );
    if (files.length + waiting.length >= options.limit() && !rotating)
      throw new ScanStorageError(
        "Saved scans are full. Download and delete unneeded scans before saving another document.",
        409,
      );
    const token = Symbol("scan-output");
    pending.set(token, { directory, rotating });
    let active = true;
    function release() {
      if (!active) return;
      active = false;
      pending.delete(token);
      invalidate();
    }
    function commit(name: string) {
      if (!active) return;
      try {
        if (options.directory() !== directory)
          throw new ScanStorageError(
            "Scan storage changed while this document was being saved.",
          );
        if (rotating) {
          const files = entries(true);
          if (!files.some((file) => file.name === name))
            throw new ScanStorageError(
              "The new scan could not be found. Existing documents were kept.",
            );
          const older = files.filter((file) => file.name !== name);
          for (const file of older.slice(Math.max(0, options.limit() - 1))) {
            unlinkSync(file.path);
            try {
              unlinkSync(join(directory, `.thumb-${file.name}.webp`));
            } catch {}
          }
        }
      } finally {
        release();
      }
    }
    return { release, commit };
  }
  return { entries, usage, reserve, invalidate };
}
