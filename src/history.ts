import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export let APP_DIR = process.env.APP_DATA || "/data";
export let HISTORY_DB = join(APP_DIR, "print_history.sqlite3");
export const HISTORY_RETENTION_DAYS = process.env.HISTORY_RETENTION_DAYS ?? "90";

export let _initialisedDatabases: Set<string> = new Set();
let initialisedDatabase: string | null = null;

export function _setAppDir(dir: string) {
  APP_DIR = dir;
  HISTORY_DB = join(dir, "history.sqlite3");
}
export function _resetHistoryState() {
  _initialisedDatabases.clear();
  initialisedDatabase = null;
}

const STATE_NAMES: Record<number, string> = {
  3: "pending",
  4: "held",
  5: "printing",
  6: "stopped",
  7: "cancelled",
  8: "aborted",
  9: "completed",
};

const REQUESTED_ATTRIBUTES = [
  "job-id",
  "job-printer-uri",
  "job-state",
  "job-state-reasons",
  "job-name",
  "job-originating-user-name",
  "job-originating-host-name",
  "job-k-octets",
  "job-impressions",
  "job-impressions-completed",
  "time-at-creation",
  "time-at-processing",
  "time-at-completed",
];

function connect(readOnly = false): Database {
  mkdirSync(APP_DIR, { recursive: true });
  try {
    const db = new Database(HISTORY_DB, { readonly: readOnly, create: !readOnly, strict: true });
    db.run("PRAGMA busy_timeout = 10000");
    if (readOnly) {
      try { db.run("PRAGMA query_only = ON"); } catch {}
    }
    return db;
  } catch (e) {
    // if readonly and file doesn't exist, create empty then reopen readonly
    if (readOnly) {
      const tmp = new Database(HISTORY_DB, { create: true, strict: true });
      tmp.close();
      const db2 = new Database(HISTORY_DB, { readonly: true, strict: true });
      db2.run("PRAGMA busy_timeout = 10000");
      try { db2.run("PRAGMA query_only = ON"); } catch {}
      return db2;
    }
    throw e;
  }
}

export function initHistory(): void {
  const key = HISTORY_DB;
  if (_initialisedDatabases.has(key) || initialisedDatabase === key) return;
  const db = connect();
  try {
    db.run("PRAGMA journal_mode = WAL");
    db.run("BEGIN IMMEDIATE");
    try {
      const cols = db.query("PRAGMA table_info(print_history)").all() as Array<{ name: string }>;
      const columnNames = new Set(cols.map(c => c.name));
      if (cols.length > 0 && !columnNames.has("history_key")) {
        db.run("ALTER TABLE print_history RENAME TO print_history_legacy");
      }
      db.run(`
        CREATE TABLE IF NOT EXISTS print_history (
          history_key TEXT PRIMARY KEY,
          job_id INTEGER NOT NULL,
          printer TEXT NOT NULL,
          document TEXT NOT NULL DEFAULT '',
          user_name TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'Network device',
          origin_host TEXT NOT NULL DEFAULT '',
          state TEXT NOT NULL DEFAULT 'unknown',
          size_bytes INTEGER NOT NULL DEFAULT 0,
          pages INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT 0,
          processing_at INTEGER NOT NULL DEFAULT 0,
          completed_at INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT 0
        )
      `);
      if (cols.length > 0 && !columnNames.has("history_key")) {
        db.run(`
          INSERT INTO print_history (
            history_key, job_id, printer, document, user_name, source, origin_host,
            state, size_bytes, pages, created_at, processing_at, completed_at, updated_at
          )
          SELECT
            printer || ':' || job_id || ':' || CASE WHEN created_at > 0 THEN created_at ELSE updated_at END,
            job_id, printer, document, user_name, source, origin_host,
            state, size_bytes, pages, created_at, processing_at, completed_at, updated_at
          FROM print_history_legacy
        `);
        db.run("DROP TABLE print_history_legacy");
      }
      db.run("CREATE INDEX IF NOT EXISTS idx_print_history_created ON print_history(created_at DESC)");
      db.run("COMMIT");
    } catch (e) {
      try { db.run("ROLLBACK"); } catch {}
      throw e;
    } finally {
      db.close();
    }
    _initialisedDatabases.add(key);
    initialisedDatabase = key;
  } catch (e) {
    db.close();
    throw e;
  }
}

function queueFromUri(uri: string): string {
  if (!uri) return "";
  try {
    const url = new URL(uri);
    const path = url.pathname.replace(/\/$/, "");
    const last = path.split("/").pop() ?? "";
    return decodeURIComponent(last);
  } catch {
    const path = uri.split("?")[0].split("#")[0];
    const parts = path.replace(/\/$/, "").split("/");
    return decodeURIComponent(parts[parts.length - 1] ?? "");
  }
}

function sourceFor(userName: string, originHost: string): string {
  const user = (userName || "").trim().toLowerCase();
  const host = (originHost || "").trim().toLowerCase();
  if (user === "webui" || (["root", "epson"].includes(user) && ["localhost", "127.0.0.1", "::1"].includes(host))) {
    return "WebUI";
  }
  return "Network device";
}

function safeInt(value: any, def = 0): number {
  try {
    if (value === null || value === undefined || value === "") return def;
    const n = Number(value);
    if (Number.isNaN(n)) return def;
    return Math.trunc(n);
  } catch {
    return def;
  }
}

function normaliseJob(jobId: number, attrs: Record<string, any>, printerName: string) {
  jobId = safeInt(jobId, -1);
  const stateValue = safeInt(attrs["job-state"]);
  const sizeKb = safeInt(attrs["job-k-octets"]);
  const pages = safeInt(attrs["job-impressions-completed"] ?? attrs["job-impressions"]);
  const userName = String(attrs["job-originating-user-name"] ?? "");
  const originHost = String(attrs["job-originating-host-name"] ?? "");
  const createdAt = safeInt(attrs["time-at-creation"]);
  return {
    history_key: `${printerName}:${jobId}:${createdAt}`,
    job_id: jobId,
    printer: printerName,
    document: String(attrs["job-name"] ?? "Untitled job"),
    user_name: userName,
    source: sourceFor(userName, originHost),
    origin_host: originHost,
    state: STATE_NAMES[stateValue] ?? (stateValue ? `state-${stateValue}` : "unknown"),
    size_bytes: Math.max(0, sizeKb * 1024),
    pages: Math.max(0, pages),
    created_at: createdAt,
    processing_at: safeInt(attrs["time-at-processing"]),
    completed_at: safeInt(attrs["time-at-completed"]),
    updated_at: Math.floor(Date.now() / 1000),
  };
}

// Fetch jobs via python cups bridge - keeps pycups dependency but called from Bun
async function fetchJobs(whichJobs: string): Promise<Record<number, Record<string, any>>> {
  // Use python3 to call cups, returns JSON
  const pythonScript = `
import json, sys
try:
    import cups
except ImportError:
    print(json.dumps({}))
    sys.exit(0)
attrs = ${JSON.stringify(REQUESTED_ATTRIBUTES)}
try:
    conn = cups.Connection()
    jobs = conn.getJobs(which_jobs="${whichJobs}", my_jobs=False, limit=1000, requested_attributes=attrs)
    # Convert keys to int and ensure serializable
    out = {}
    for k, v in jobs.items():
        # v may contain non-json types, convert to plain
        plain = {}
        for kk, vv in v.items():
            try:
                json.dumps(vv)
                plain[kk] = vv
            except:
                plain[kk] = str(vv)
        out[str(k)] = plain
    print(json.dumps(out))
except TypeError:
    try:
        conn = cups.Connection()
        jobs = conn.getJobs(which_jobs="${whichJobs}", my_jobs=False, limit=1000)
        out = {}
        for k, v in jobs.items():
            plain = {}
            for kk, vv in v.items():
                try:
                    json.dumps(vv)
                    plain[kk] = vv
                except:
                    plain[kk] = str(vv)
            out[str(k)] = plain
        print(json.dumps(out))
    except Exception as e:
        print(json.dumps({"__error__": str(e)}), file=sys.stderr)
        sys.exit(1)
except Exception as e:
    print(json.dumps({"__error__": str(e)}), file=sys.stderr)
    sys.exit(1)
`;
  const proc = Bun.spawn(["python3", "-c", pythonScript], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    // stderr may contain error
    if (stderr.includes("__error__") || stderr.trim()) {
      throw new Error(stderr.trim() || `cups fetch failed ${whichJobs}`);
    }
    // if python not available, return empty
    if (!stdout.trim()) return {};
    throw new Error(`cups fetch failed: ${stderr}`);
  }
  try {
    const data = JSON.parse(stdout.trim() || "{}");
    if (data["__error__"]) throw new Error(data["__error__"]);
    const result: Record<number, Record<string, any>> = {};
    for (const [k, v] of Object.entries(data)) {
      result[Number(k)] = v as any;
    }
    return result;
  } catch (e) {
    // if parse fails, return empty
    return {};
  }
}

// Sync variant for tests that mock _fetchJobs - expose for monkeypatching
export let _fetchJobs: (which: string) => Promise<Record<number, Record<string, any>>> = fetchJobs;

export function __setFetchJobs(fn: typeof _fetchJobs) {
  _fetchJobs = fn;
}

export async function syncPrintHistory(printerName: string, opts: { includeCompleted?: boolean } = {}): Promise<number> {
  const includeCompleted = opts.includeCompleted ?? true;
  if (!printerName) return 0;
  // Check if cups available by trying fetch; if python missing, _fetchJobs will return {}
  initHistory();

  const snapshots: Record<number, Record<string, any>> = {};
  const failures: string[] = [];
  const jobSets = includeCompleted ? (["not-completed", "completed"] as const) : (["not-completed"] as const);
  for (const which of jobSets) {
    try {
      const jobs = await _fetchJobs(which);
      Object.assign(snapshots, jobs);
    } catch (exc: any) {
      failures.push(`${which}: ${exc?.message ?? String(exc)}`);
    }
  }
  if (failures.length === jobSets.length) {
    throw new Error(`Unable to fetch CUPS jobs (${failures.join("; ")})`);
  }
  if (failures.length) {
    console.log(`[history] Partial CUPS job fetch failed (${failures.join("; ")})`);
  }

  const rows: ReturnType<typeof normaliseJob>[] = [];
  for (const [jobIdStr, attrs] of Object.entries(snapshots)) {
    const jobId = Number(jobIdStr);
    if (typeof attrs !== "object" || attrs === null) continue;
    if (queueFromUri(String(attrs["job-printer-uri"] ?? "")) !== printerName) continue;
    const row = normaliseJob(jobId, attrs, printerName);
    if (row.job_id >= 0) rows.push(row);
  }

  if (!rows.length) {
    if (includeCompleted) prunePrintHistory();
    return 0;
  }

  const db = connect();
  try {
    // bun:sqlite doesn't expose total_changes via same API, we compute via changes
    let changed = 0;
    const stmt = db.prepare(`
      INSERT INTO print_history (
        history_key, job_id, printer, document, user_name, source, origin_host, state,
        size_bytes, pages, created_at, processing_at, completed_at, updated_at
      ) VALUES (
        $history_key, $job_id, $printer, $document, $user_name, $source, $origin_host, $state,
        $size_bytes, $pages, $created_at, $processing_at, $completed_at, $updated_at
      )
      ON CONFLICT(history_key) DO UPDATE SET
        job_id=excluded.job_id,
        printer=excluded.printer,
        document=excluded.document,
        user_name=excluded.user_name,
        source=excluded.source,
        origin_host=excluded.origin_host,
        state=excluded.state,
        size_bytes=CASE WHEN excluded.size_bytes > 0 THEN excluded.size_bytes ELSE print_history.size_bytes END,
        pages=CASE WHEN excluded.pages > 0 THEN excluded.pages ELSE print_history.pages END,
        created_at=CASE WHEN excluded.created_at > 0 THEN excluded.created_at ELSE print_history.created_at END,
        processing_at=CASE WHEN excluded.processing_at > 0 THEN excluded.processing_at ELSE print_history.processing_at END,
        completed_at=CASE WHEN excluded.completed_at > 0 THEN excluded.completed_at ELSE print_history.completed_at END,
        updated_at=excluded.updated_at
      WHERE print_history.document != excluded.document
         OR print_history.user_name != excluded.user_name
         OR print_history.source != excluded.source
         OR print_history.origin_host != excluded.origin_host
         OR print_history.state != excluded.state
         OR (excluded.size_bytes > 0 AND print_history.size_bytes != excluded.size_bytes)
         OR (excluded.pages > 0 AND print_history.pages != excluded.pages)
         OR (excluded.processing_at > 0 AND print_history.processing_at != excluded.processing_at)
         OR (excluded.completed_at > 0 AND print_history.completed_at != excluded.completed_at)
    `);
    const txn = db.transaction((rows: any[]) => {
      let totalChanges = 0;
      for (const row of rows) {
        const res = stmt.run(row);
        totalChanges += res.changes;
      }
      return totalChanges;
    });
    changed = txn(rows);
    if (includeCompleted) {
      prunePrintHistory({ db });
    }
    return changed;
  } catch (e) {
    throw e;
  } finally {
    db.close();
  }
}

export function prunePrintHistory(opts: { retentionDays?: any; db?: Database } = {}): number {
  let days: number;
  if (opts.retentionDays === undefined || opts.retentionDays === null) {
    days = safeInt(HISTORY_RETENTION_DAYS, 90);
  } else {
    days = safeInt(opts.retentionDays, 90);
  }
  if (days <= 0) return 0;
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  let ownsConnection = !opts.db;
  let db = opts.db ?? connect();
  if (ownsConnection) initHistory();
  try {
    const result = db.query(`
      DELETE FROM print_history
      WHERE state IN ('cancelled', 'aborted', 'completed')
        AND CASE WHEN completed_at > 0 THEN completed_at ELSE created_at END > 0
        AND CASE WHEN completed_at > 0 THEN completed_at ELSE created_at END < ?
    `).run(cutoff);
    return result.changes;
  } finally {
    if (ownsConnection) db.close();
  }
}

export function listPrintHistory(limit = 100): Array<Record<string, any>> {
  limit = Math.max(1, Math.min(Math.trunc(limit), 1000));
  initHistory();
  const db = connect(true);
  try {
    const rows = db.query(`
      SELECT job_id, printer, document, user_name, source, origin_host, state,
             size_bytes, pages, created_at, processing_at, completed_at, updated_at
      FROM print_history
      ORDER BY CASE WHEN created_at > 0 THEN created_at ELSE updated_at END DESC, job_id DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, any>>;

    return rows.map((row) => {
      const item: Record<string, any> = { ...row };
      const stamp = item["created_at"] || item["updated_at"];
      item["created_display"] = stamp ? new Date(stamp * 1000).toLocaleString("sv-SE").replace("T", " ") : "Unknown";
      // Use time.strftime equivalent? Use local display like YYYY-MM-DD HH:MM:SS
      if (stamp) {
        const d = new Date(stamp * 1000);
        const pad = (n: number) => String(n).padStart(2, "0");
        item["created_display"] = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      }
      item["size_display"] = formatBytes(item["size_bytes"]);
      item["device_display"] = item["origin_host"] || item["user_name"] || "Unknown device";
      return item;
    });
  } finally {
    db.close();
  }
}

function formatBytes(value: number): string {
  value = Math.max(0, Math.trunc(value || 0));
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

// For testing exports
export const _queueFromUri = queueFromUri;
export const _sourceFor = sourceFor;
export const _safeInt = safeInt;
export const _normaliseJob = normaliseJob;
export const HISTORY_DB_PATH = HISTORY_DB;
export const APP_DIR_PATH = APP_DIR;
