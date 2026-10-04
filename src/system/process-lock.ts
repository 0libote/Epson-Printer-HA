import { join } from "node:path";
import { mkdirSync, statSync, rmSync } from "node:fs";
export function createOperationLocks(dataDir: () => string) {
const operationLocks = new Map<string, { acquiredAt: number; owner: symbol }>();
function clearForTest(name?: string) {
  if (name) operationLocks.delete(name);
  else operationLocks.clear();
}
function operationLockStaleMs(name: string): number {
  // A full 600dpi scan + retry + conversion can take ~6-7 min; never treat a
  // scanner lock younger than that as stale. Other ops are quick (5 min cap).
  return name === "scanner" ? 8 * 60 * 1000 : 5 * 60 * 1000;
}
function removeOperationLockFs(lockPath: string): void {
  // rmSync with recursive+force removes both legacy file locks (Python fcntl
  // era) and directory locks (Bun mkdir era). rmdirSync/unlinkSync alone only
  // handle one form and leave the other behind forever.
  try { rmSync(lockPath, { recursive: true, force: true }); } catch {}
}
async function withOperationLock<T>(name: string, fn: () => Promise<T>): Promise<{ acquired: boolean; result?: T }> {
  const lockPath = join(dataDir(), `.${name}.lock`);
  const staleMs = operationLockStaleMs(name);
  const heldAt = operationLocks.get(name);
  if (heldAt !== undefined) {
    if (Date.now() - heldAt.acquiredAt > staleMs) {
      // Previous holder hung/crashed without reaching finally (e.g. a
      // scanimage promise that never settled). Reap it so one stuck scan
      // can't block everything until container restart.
      operationLocks.delete(name);
      removeOperationLockFs(lockPath);
    } else {
      return { acquired: false };
    }
  }
  try {
    mkdirSync(lockPath);
  } catch {
    // mkdir fails when the path already exists as a dir *or* as a legacy
    // file. Check mtime: stale locks are removed (file or dir), fresh ones
    // mean someone else is genuinely running.
    try {
      const st = statSync(lockPath);
      if (Date.now() - st.mtimeMs > staleMs) {
        removeOperationLockFs(lockPath);
        mkdirSync(lockPath);
      } else {
        return { acquired: false };
      }
    } catch {
      return { acquired: false };
    }
  }
  const owner = Symbol(name);
  operationLocks.set(name, { acquiredAt: Date.now(), owner });
  try { const result = await fn(); return { acquired: true, result }; }
  finally {
    if (operationLocks.get(name)?.owner === owner) {
      operationLocks.delete(name);
      removeOperationLockFs(lockPath);
    }
  }
}

return { operationLocks, clearForTest, removeOperationLockFs, withOperationLock };
}
