import { join } from "node:path";
import { initHistory, syncPrintHistory } from "./history.ts";

const APP_DIR = process.env.APP_DATA || "/data";
const SETTINGS_FILE = join(APP_DIR, "settings.json");
const DEFAULT_PRINTER_NAME = (process.env.PRINTER_NAME || "Home_Epson_XP2200").trim() || "Home_Epson_XP2200";

function positiveEnvInt(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined) return def;
  const n = parseInt(raw, 10);
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
  let lastCompletedPoll = 0;
  while (true) {
    try {
      const now = performance.now() / 1000; // seconds monotonic approx
      const includeCompleted = now - lastCompletedPoll >= COMPLETED_POLL_SECONDS;
      const name = await currentPrinterName();
      await syncPrintHistory(name, { includeCompleted });
      if (includeCompleted) lastCompletedPoll = now;
    } catch (exc: any) {
      console.log(`[history] Sync failed: ${exc?.message ?? String(exc)}`);
    }
    await Bun.sleep(POLL_INTERVAL_SECONDS * 1000);
  }
}

if (import.meta.main) {
  main();
}
