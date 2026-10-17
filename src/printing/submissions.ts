import { Database } from "bun:sqlite";
import { join } from "node:path";

export type PrintReceipt = {
  ok: boolean;
  message?: string;
  error?: string;
  job_id?: string;
  replayed?: boolean;
  retry_safe?: boolean;
};
export type SubmissionResult = {
  status: 200 | 400 | 409 | 413 | 500 | 503;
  body: PrintReceipt;
};
const RETENTION_MS = 24 * 60 * 60 * 1000;

function connect(path: string) {
  const db = new Database(path, { create: true });
  db.run("PRAGMA busy_timeout = 5000");
  db.run(`CREATE TABLE IF NOT EXISTS submissions (
    key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL,
    result TEXT
  )`);
  return db;
}

/** A durable claim is written BEFORE invoking lp. An interrupted claim is never
 * automatically submitted again, including after a server/container restart. */
export function createPrintSubmissions(dataDir: () => string) {
  const pending = new Map<string, Promise<SubmissionResult>>();
  return async function submit(
    key: string,
    fingerprint: string,
    action: () => Promise<SubmissionResult>,
  ): Promise<SubmissionResult> {
    const path = join(dataDir(), "print-submissions.sqlite3");
    const pendingKey = `${path}:${key}`;
    const db = connect(path);
    let claimed = false;
    try {
      const existing = db
        .transaction(() => {
          db.run("DELETE FROM submissions WHERE created_at < ?", [
            Date.now() - RETENTION_MS,
          ]);
          const row = db
            .query("SELECT fingerprint, result FROM submissions WHERE key = ?")
            .get(key) as { fingerprint: string; result: string | null } | null;
          if (row) return row;
          const count = db
            .query("SELECT COUNT(*) AS total FROM submissions")
            .get() as { total: number };
          if (count.total >= 2048)
            throw new Error(
              "Submission receipt storage is full. Try again later.",
            );
          db.run(
            "INSERT INTO submissions (key, fingerprint, created_at) VALUES (?, ?, ?)",
            [key, fingerprint, Date.now()],
          );
          claimed = true;
          return null;
        })
        .immediate();
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          return {
            status: 409,
            body: {
              ok: false,
              error:
                "This submission ID was already used for a different document or settings.",
            },
          };
        if (existing.result) {
          const result = JSON.parse(existing.result) as SubmissionResult;
          return { ...result, body: { ...result.body, replayed: true } };
        }
        const running = pending.get(pendingKey);
        if (running) return await running;
        return {
          status: 409,
          body: {
            ok: false,
            error:
              "The previous submission was interrupted and may have reached the printer. Check the queue and print history before sending a new job.",
          },
        };
      }
    } finally {
      db.close();
    }
    if (!claimed) throw new Error("Could not claim print submission");
    // Start in a microtask so the promise is registered before action can yield.
    const running = Promise.resolve()
      .then(action)
      .then((result) => {
        const receiptDb = connect(path);
        try {
          receiptDb.run("UPDATE submissions SET result = ? WHERE key = ?", [
            JSON.stringify(result),
            key,
          ]);
        } finally {
          receiptDb.close();
        }
        return result;
      })
      .catch((error) => {
        console.error("[print] submission interrupted", error);
        // Keep the unresolved durable claim; a retry must never replay hardware.
        return {
          status: 503 as const,
          body: {
            ok: false,
            error:
              "Could not confirm this submission. Check the queue and print history before sending a new job.",
          },
        };
      })
      .finally(() => {
        pending.delete(pendingKey);
      });
    pending.set(pendingKey, running);
    return running;
  };
}
