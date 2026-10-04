import { join } from "node:path";
import { initHistory, syncPrintHistory } from "./history.ts";

const APP_DIR = process.env.APP_DATA || "/data";
const SETTINGS_FILE = join(APP_DIR, "settings.json");
// Queue name default mirrors the WebUI default; the saved settings file is the
// only runtime source (env is intentionally not consulted).
const DEFAULT_PRINTER_NAME = "Home_Epson_XP2200";

function positiveEnvInt(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined) return def;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(1, n);
}

export const POLL_INTERVAL_SECONDS = positiveEnvInt("HISTORY_POLL_SECONDS", 5);
export const COMPLETED_POLL_SECONDS = Math.max(POLL_INTERVAL_SECONDS, positiveEnvInt("HISTORY_COMPLETED_POLL_SECONDS", 60));

export async function currentPrinterName(): Promise<string> {
  try {
    const text = await Bun.file(SETTINGS_FILE).text();
    const data = JSON.parse(text);
    const value = String(data.printer_name ?? "").trim();
    return value || DEFAULT_PRINTER_NAME;
  } catch {
    return DEFAULT_PRINTER_NAME;
  }
}

export async function main(): Promise<void> {
  console.log("[history] Persistent print history collector started.");
  // initHistory() used to run once before the loop: any failure there (full
  // disk, locked/corrupt DB on first boot) killed the process, and after a
  // few rapid restarts supervisord marked the worker FATAL — silently losing
  // all history collection. Initialise lazily inside the loop instead so a
  // transient failure backs off and retries like any other sync error.
  let initialised = false;
  let lastCompletedPoll = -COMPLETED_POLL_SECONDS;
  let running = false;
  let consecutiveFailures = 0;
  let lastErrorLogged = "";
  while (true) {
    const tickStart = Date.now();
    try {
      if (!running) {
        running = true;
        try {
          if (!initialised) {
            initHistory();
            initialised = true;
          }
          const now = Date.now() / 1000;
          const includeCompleted = now - lastCompletedPoll >= COMPLETED_POLL_SECONDS;
          const name = await currentPrinterName();
          await syncPrintHistory(name, { includeCompleted });
          if (includeCompleted) lastCompletedPoll = now;
          consecutiveFailures = 0;
          lastErrorLogged = "";
        } finally {
          running = false;
        }
      }
    } catch (exc: any) {
      running = false;
      consecutiveFailures++;
      // Don't spam docker logs every 5s when CUPS is down for hours — log on
      // change + every 10th failure, with backoff so a wedged CUPS/python
      // doesn't get hammered.
      const msg = String(exc?.message ?? String(exc)).slice(0, 300);
      if (msg !== lastErrorLogged || consecutiveFailures % 10 === 1) {
        console.log(`[history] Sync failed (${consecutiveFailures}x): ${msg}`);
        lastErrorLogged = msg;
      }
    }
    // account for sync duration so a slow CUPS fetch can't cause overlap/drift;
    // back off up to 60s after repeated failures.
    const backoffMs = Math.min(60_000, POLL_INTERVAL_SECONDS * 1000 * Math.min(8, Math.max(1, consecutiveFailures)));
    const baseMs = consecutiveFailures > 1 ? backoffMs : POLL_INTERVAL_SECONDS * 1000;
    const elapsed = Date.now() - tickStart;
    await Bun.sleep(Math.max(1000, baseMs - elapsed));
  }
}

if (import.meta.main) {
  main();
}
