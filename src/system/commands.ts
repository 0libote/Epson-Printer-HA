export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  returncode: number;
}

export function commandResult(ok: boolean, stdout = "", stderr = "", returncode = 0): CommandResult {
  return { ok, stdout, stderr, returncode };
}

// Bun.spawn based runCommand with timeout (no listener leaks, no zombie procs)
// Hardened: global concurrency cap (spawn storms under multi-client polling),
// output truncation (verbose CUPS/scanimage stderr can't OOM the hub).
const RUN_CONCURRENCY_MAX_DEFAULT = 12;
const RUN_QUEUE_MAX_DEFAULT = 64;
let RUN_CONCURRENCY_MAX = RUN_CONCURRENCY_MAX_DEFAULT;
// Waiting callers also pile up memory (each holds its stream promises), so
// fail fast instead of queueing without bound when the hub is saturated.
let RUN_QUEUE_MAX = RUN_QUEUE_MAX_DEFAULT;

/** Test hook: shrink limits to exercise saturation without spawning dozens of procs. */
export function _setRunLimitsForTest(activeMax?: number, queueMax?: number) {
  if (activeMax !== undefined) RUN_CONCURRENCY_MAX = Math.max(1, activeMax);
  if (queueMax !== undefined) RUN_QUEUE_MAX = Math.max(0, queueMax);
}
export function _resetRunLimitsForTest() {
  RUN_CONCURRENCY_MAX = RUN_CONCURRENCY_MAX_DEFAULT;
  RUN_QUEUE_MAX = RUN_QUEUE_MAX_DEFAULT;
}
let _runActive = 0;
const _runQueue: Array<() => void> = [];

function _runAcquire(): Promise<void> {
  if (_runActive < RUN_CONCURRENCY_MAX) {
    _runActive++;
    return Promise.resolve();
  }
  if (_runQueue.length >= RUN_QUEUE_MAX) {
    return Promise.reject(new Error("server busy: too many subprocesses queued"));
  }
  return new Promise<void>((resolve) => {
    _runQueue.push(() => {
      _runActive++;
      resolve();
    });
  });
}

function _runRelease(): void {
  _runActive = Math.max(0, _runActive - 1);
  const next = _runQueue.shift();
  if (next) next();
}

const RUN_OUTPUT_MAX = 256 * 1024; // 256KB cap per stream
function _truncateOutput(s: string): string {
  if (s.length > RUN_OUTPUT_MAX) return s.slice(0, RUN_OUTPUT_MAX) + "\n…[truncated]";
  return s;
}

export function _runStatsForTest() {
  return { active: _runActive, queued: _runQueue.length, max: RUN_CONCURRENCY_MAX };
}

/** Drain output while retaining bounded text, so noisy drivers cannot exhaust memory. */
export async function readCommandStream(stream: ReadableStream<Uint8Array>, maxBytes = RUN_OUTPUT_MAX): Promise<string> {
 const reader = stream.getReader();
 const chunks: Uint8Array[] = [];
 let size = 0, truncated = false;
 try {
  while (true) {
   const { done, value } = await reader.read();
   if (done) break;
   const retain = Math.min(value.length, maxBytes - size);
   if (retain > 0) { chunks.push(value.slice(0, retain)); size += retain; }
   if (retain < value.length) truncated = true;
  }
 } finally { reader.releaseLock(); }
 const bytes = new Uint8Array(size);
 let offset = 0;
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
 return new TextDecoder().decode(bytes) + (truncated ? "\n…[truncated]" : "");
}

export async function runCommand(args: string[], timeout = 30_000, cwd?: string): Promise<CommandResult> {
  try {
    await _runAcquire();
  } catch (exc: any) {
    // Saturated (see RUN_QUEUE_MAX): report instead of throwing so status
    // polls degrade to "unknown" rather than 500ing every dashboard client.
    return commandResult(false, "", String(exc?.message ?? exc).slice(0, 500), 1);
  }
  let proc: any;
  let timer: any = null;
  try {
    proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      cwd,
    });
    const stdoutPromise = readCommandStream(proc.stdout);
    const stderrPromise = readCommandStream(proc.stderr);
    const exitPromise = proc.exited;

    let timedOut = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        try { proc.kill(); } catch {}
        reject(new Error("timeout"));
      }, timeout);
    });

    try {
      const [out, err, code] = (await Promise.race([
        Promise.all([stdoutPromise, stderrPromise, exitPromise]),
        timeoutPromise,
      ])) as [string, string, number];
      return commandResult(code === 0, _truncateOutput(out.trim()), _truncateOutput(err.trim()), code);
    } catch (exc: any) {
      if (timedOut || exc?.message === "timeout") {
        try { await Promise.race([proc.exited, Bun.sleep(1500)]); } catch {}
        try { proc.kill(9); } catch {}
        return commandResult(false, "", "timeout", 1);
      }
      throw exc;
    }
  } catch (exc: any) {
    if (exc?.message === "timeout") {
      try { proc?.kill(); } catch {}
      return commandResult(false, "", "timeout", 1);
    }
    return commandResult(false, "", _truncateOutput(String(exc?.message ?? exc)).slice(0, 2000), 1);
  } finally {
    if (timer) clearTimeout(timer);
    _runRelease();
  }
}

// sync-ish version for quick calls where async not needed - uses Bun.spawnSync
export function runCommandSync(args: string[], timeout = 5000): CommandResult {
  try {
    const proc = Bun.spawnSync(args, { timeout });
    const stdout = proc.stdout ? Buffer.from(proc.stdout).toString("utf-8").trim() : "";
    const stderr = proc.stderr ? Buffer.from(proc.stderr).toString("utf-8").trim() : "";
    return commandResult(proc.exitCode === 0, stdout, stderr, proc.exitCode ?? 1);
  } catch (exc: any) {
    return commandResult(false, "", String(exc), 1);
  }
}

