import { join } from "node:path";
import { initHistory, syncPrintHistory } from "./history.ts";

const APP_DIR = process.env.APP_DATA || "/data";
const SETTINGS_FILE = join(APP_DIR, "settings.json");
const DEFAULT_PRINTER_NAME = (process.env.PRINTER_NAME || "Home_Epson_XP2200").trim() || "Home_Epson_XP2200";

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
  initHistory();
  console.log("[history] Persistent print history collector started.");
  let lastCompletedPoll = -COMPLETED_POLL_SECONDS;
  let running = false;
  while (true) {
    const tickStart = Date.now();
    try {
      if (!running) {
        running = true;
        try {
          const now = Date.now() / 1000;
          const includeCompleted = now - lastCompletedPoll >= COMPLETED_POLL_SECONDS;
          const name = await currentPrinterName();
          await syncPrintHistory(name, { includeCompleted });
          if (includeCompleted) lastCompletedPoll = now;
        } finally {
          running = false;
        }
      }
    } catch (exc: any) {
      running = false;
      console.log(`[history] Sync failed: ${exc?.message ?? String(exc)}`);
    }
    // account for sync duration so a slow CUPS fetch can't cause overlap/drift
    const elapsed = Date.now() - tickStart;
    await Bun.sleep(Math.max(1000, POLL_INTERVAL_SECONDS * 1000 - elapsed));
  }
}

if (import.meta.main) {
  main();
}
