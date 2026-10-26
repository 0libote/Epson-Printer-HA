import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

let history: typeof import("../../src/history.ts");
const fetchCupsJobs = (await import("../../src/history.ts"))._fetchJobs;

describe("history", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "history-test-"));
    process.env.APP_DATA = tmp;
    history = await import("../../src/history.ts");
    history._setAppDir(tmp);
    history._resetHistoryState();
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    delete process.env.APP_DATA;
  });

  test("source classification", () => {
    expect(history._sourceFor("webui", "localhost")).toBe("WebUI");
    expect(history._sourceFor("epson", "localhost")).toBe("WebUI");
    expect(history._sourceFor("root", "127.0.0.1")).toBe("WebUI");
    expect(history._sourceFor("alice", "192.0.2.25")).toBe("Network device");
  });

  test("history sync persists jobs", async () => {
    history._setAppDir(tmp);
    history._resetHistoryState();

    const pending = {
      42: {
        "job-printer-uri": "ipp://localhost/printers/Home_Epson_XP2200",
        "job-state": 5,
        "job-name": "windows-test.pdf",
        "job-originating-user-name": "alice",
        "job-originating-host-name": "192.0.2.25",
        "job-k-octets": 12,
        "job-impressions": 2,
        "time-at-creation": 1000,
      }
    };
    history.__setFetchJobs(async (which: string) => pending as any);

    const changed = await history.syncPrintHistory("Home_Epson_XP2200");
    expect(changed).toBe(1);
    const rows = history.listPrintHistory();
    expect(rows.length).toBe(1);
    expect(rows[0].job_id).toBe(42);
    expect(rows[0].document).toBe("windows-test.pdf");
    expect(rows[0].source).toBe("Network device");
    expect(rows[0].origin_host).toBe("192.0.2.25");
    expect(rows[0].state).toBe("printing");
    expect(rows[0].size_bytes).toBe(12 * 1024);

    const changed2 = await history.syncPrintHistory("Home_Epson_XP2200");
    expect(changed2).toBe(0);
  });

  test("history sync tolerates malformed numeric attributes", async () => {
    history._setAppDir(tmp);
    history._resetHistoryState();
    history.__setFetchJobs(async (_which: string) => ({
      7: {
        "job-printer-uri": "ipp://localhost/printers/Printer",
        "job-state": "bad",
        "job-k-octets": {},
        "time-at-creation": "not-a-time",
      }
    } as any));

    const changed = await history.syncPrintHistory("Printer", { includeCompleted: false });
    expect(changed).toBe(1);
    const row = history.listPrintHistory()[0];
    expect(row.state).toBe("unknown");
    expect(row.size_bytes).toBe(0);
    expect(row.created_at).toBe(0);
  });

  test("history sync reports total cups failure", async () => {
    history._setAppDir(tmp);
    history._resetHistoryState();
    history.__setFetchJobs(async (which: string) => { throw new Error(`${which} unavailable`); });
    let err: any = null;
    try { await history.syncPrintHistory("Printer"); } catch (e) { err = e; }
    expect(err).not.toBeNull();
    expect(String(err.message)).toContain("Unable to fetch CUPS jobs");
  });

  test("history retention only removes old terminal jobs", async () => {
    const dbPath = join(tmp, "print_history.sqlite3");
    history._setAppDir(tmp);
    history._resetHistoryState();
    history.initHistory();
    const old = Math.floor(Date.now() / 1000) - 10 * 86400;
    const db = new Database(dbPath);
    for (const [key, state] of [["old-complete", "completed"], ["old-active", "printing"]] as const) {
      db.run("INSERT INTO print_history (history_key, job_id, printer, state, created_at, updated_at) VALUES (?, 1, 'Printer', ?, ?, ?)", [key, state, old, old]);
    }
    db.close();
    expect(history.prunePrintHistory({ retentionDays: 5 })).toBe(1);
    expect(history.listPrintHistory().map(r => r.state)).toEqual(["printing"]);
  });

  test("a complete empty CUPS snapshot stops claiming lost jobs are printing", async () => {
    history.__setFetchJobs(async (which): Promise<Record<number, Record<string, any>>> => which === "not-completed" ? {
      7: { "job-printer-uri": "ipp://localhost/printers/Printer", "job-state": 5, "time-at-creation": 1000 },
    } : {});
    await history.syncPrintHistory("Printer");
    history.__setFetchJobs(async () => ({}));
    expect(await history.syncPrintHistory("Printer")).toBe(1);
    const row = history.listPrintHistory()[0];
    expect(row.state).toBe("unknown");
    expect(row.completed_at).toBe(0);
  });

  test("partial or active-only snapshots never invalidate retained jobs", async () => {
    history.__setFetchJobs(async (which): Promise<Record<number, Record<string, any>>> => which === "not-completed" ? {
      7: { "job-printer-uri": "ipp://localhost/printers/Printer", "job-state": 5, "time-at-creation": 1000 },
    } : {});
    await history.syncPrintHistory("Printer");
    history.__setFetchJobs(async () => ({}));
    await history.syncPrintHistory("Printer", { includeCompleted: false });
    expect(history.listPrintHistory()[0].state).toBe("printing");
    history.__setFetchJobs(async which => { if (which === "completed") throw Error("offline"); return {}; });
    await history.syncPrintHistory("Printer");
    expect(history.listPrintHistory()[0].state).toBe("printing");
  });

  test("truncated CUPS listings never invalidate jobs outside the page", async () => {
    history.__setFetchJobs(async () => ({
      7: { "job-printer-uri": "ipp://localhost/printers/Printer", "job-state": 5, "time-at-creation": 1000 },
    }));
    await history.syncPrintHistory("Printer");
    history.__setFetchJobs(async () => Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [i + 100, {
      "job-printer-uri": "ipp://localhost/printers/Other", "job-state": 9,
    }])));
    await history.syncPrintHistory("Printer");
    expect(history.listPrintHistory()[0].state).toBe("printing");
  });

  test("private metadata becoming unavailable does not erase a recorded document", async () => {
    const attrs = { "job-printer-uri": "ipp://localhost/printers/Printer", "job-state": 5, "time-at-creation": Math.floor(Date.now() / 1000) };
    history.__setFetchJobs(async () => ({ 7: { ...attrs, "job-name": "letter.pdf", "job-originating-user-name": "epson", "job-originating-host-name": "localhost" } }));
    await history.syncPrintHistory("Printer");
    history.__setFetchJobs(async () => ({ 7: { ...attrs, "job-state": 9 } }));
    await history.syncPrintHistory("Printer");
    expect(history.listPrintHistory()[0]).toMatchObject({ document: "letter.pdf", user_name: "epson", origin_host: "localhost", source: "WebUI", state: "completed" });
  });

  test("invalid CUPS responses and missing pycups are failures, never empty queues", async () => {
    for (const [stdout, code] of [["not json", 0], ["[]", 0], ["null", 0], ['{"7":null}', 0], ["", 1]] as const) {
      const spawn = spyOn(Bun, "spawn").mockReturnValue({
        stdout: new Response(stdout).body, stderr: new Response("").body, exited: Promise.resolve(code), kill() {},
      } as any);
      try { await expect(fetchCupsJobs("completed")).rejects.toThrow(/CUPS|cups/); }
      finally { spawn.mockRestore(); }
    }
  });

  test("non-finite CUPS attributes fall back to valid SQLite integers", () => {
    expect(history._safeInt(Infinity)).toBe(0);
    expect(history._safeInt("-Infinity")).toBe(0);
  });

  test("legacy history survives reused cups job id", async () => {
    const dbPath = join(tmp, "print_history.sqlite3");
    history._setAppDir(tmp);
    history._resetHistoryState();
    const now = Math.floor(Date.now() / 1000);
    const legacy_created = now - 1000;
    const legacy_updated = now - 900;
    const new_created = now;

    const dbInit = new Database(dbPath);
    dbInit.run(`
      CREATE TABLE print_history (
        job_id INTEGER PRIMARY KEY, printer TEXT NOT NULL, document TEXT NOT NULL,
        user_name TEXT NOT NULL, source TEXT NOT NULL, origin_host TEXT NOT NULL,
        state TEXT NOT NULL, size_bytes INTEGER NOT NULL, pages INTEGER NOT NULL,
        created_at INTEGER NOT NULL, processing_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )
    `);
    dbInit.run("INSERT INTO print_history VALUES (1, 'Home_Epson_XP2200', 'old.pdf', '', 'WebUI', '', 'completed', 10, 1, ?, 0, ?, ?)", [legacy_created, legacy_updated, legacy_updated]);
    dbInit.close();

    // Now need to clear cache so initHistory will migrate
    history._resetHistoryState();

    const newJob = {
      1: {
        "job-printer-uri": "ipp://localhost/printers/Home_Epson_XP2200",
        "job-state": 5,
        "job-name": "new.pdf",
        "time-at-creation": new_created,
      }
    };
    history.__setFetchJobs(async (which: string) => which === "not-completed" ? newJob as any : {} as any);
    const changed = await history.syncPrintHistory("Home_Epson_XP2200");
    expect(changed).toBe(1);
    const rows = history.listPrintHistory();
    expect(rows.map(r => r.document)).toEqual(["new.pdf", "old.pdf"]);
  });
});
