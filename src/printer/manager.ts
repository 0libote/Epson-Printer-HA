import { getInkLevels, getCachedInkLevels } from "./standard.ts";
import { normalizePrinterState, type PrinterBackend, type MaintenanceAction, type PrinterCapabilities } from "./types.ts";
import { validatePrinterAddress } from "../system/validation.ts";
export const standardCapabilities: PrinterCapabilities = { inkLevels: true, pageCount: false, nozzleCheck: false, headCleaning: false };
// inkLevels denotes an available reader, not a promise the device reports levels.
export function createPrinterDeviceService(deps: {
 reachable: (ip: string) => Promise<boolean>;
 queueStatus: (queue: string) => Promise<{ state: string; detail: string }>;
 jobs: (queue: string) => Promise<unknown[]>;
 scannerBusy: () => boolean;
 lock: <T>(fn: () => Promise<T>) => Promise<{ acquired: boolean; result?: T }>;
}, utility?: PrinterBackend) {
 let maintenanceState: { action: MaintenanceAction | null; state: "unsupported" | "available" | "running" | "complete" | "failed"; error?: string } = { action: null, state: "unsupported" };
 async function activeBackend(ip: string) { try { return utility && await utility.available(ip) ? utility : null; } catch { return null; } }
 async function capabilities(ip: string) {
  const backend = ip ? await activeBackend(ip) : null;
  return { backend: backend?.id ?? "standard", capabilities: backend ? await backend.getCapabilities(ip) : standardCapabilities, maintenance: maintenanceState };
 }
 async function status(ip: string, queue: string) {
  if (!ip) return { state: "unknown" as const, backend: "standard", rawState: "setup_required", warnings: ["Printer address required"] };
  validatePrinterAddress(ip);
  try { const backend = await activeBackend(ip); if (backend) return await backend.getStatus(ip); } catch { /* A utility failure must preserve standard status. */ }
  const [reachable, cups] = await Promise.all([deps.reachable(ip), deps.queueStatus(queue)]);
  return { state: maintenanceState.state === "running" ? "busy" as const : deps.scannerBusy() ? "scanning" as const : normalizePrinterState(cups.state, reachable),
   backend: "standard", rawState: cups.state, warnings: !reachable ? ["Printer is not responding; it may be asleep or offline"] : cups.state === "disabled" ? ["CUPS queue disabled"] : [] };
 }
 async function ink(ip: string) {
  validatePrinterAddress(ip);
  try {
   const backend = await activeBackend(ip);
   if (backend) { const result = await backend.getInkLevels(ip); if (result.ok && result.cartridges.some(c => c.level !== null)) return result; }
  } catch { /* Utility unavailable: retain the proven fallback chain. */ }
  return getInkLevels(ip);
 }
 async function maintenance(ip: string, queue: string, action: MaintenanceAction) {
  validatePrinterAddress(ip);
  if (!["nozzle-check", "head-clean"].includes(action)) return { ok: false, status: 400, error: "Invalid maintenance action" };
  const backend = await activeBackend(ip);
  const caps = backend ? await backend.getCapabilities(ip) : standardCapabilities;
  if (!backend?.maintenance || !(action === "nozzle-check" ? caps.nozzleCheck : caps.headCleaning)) {
   maintenanceState = { action, state: "unsupported" };
   return { ok: false, status: 501, error: "Maintenance is unsupported by the active backend" };
  }
  const locked = await deps.lock(async () => {
   if (deps.scannerBusy() || (await deps.jobs(queue)).length) return { ok: false, status: 409, error: "Printer is busy" };
   maintenanceState = { action, state: "running" };
   try { await backend.maintenance!(ip, action); maintenanceState = { action, state: "complete" }; return { ok: true, status: 200 }; }
   catch { maintenanceState = { action, state: "failed", error: "Printer maintenance failed" }; return { ok: false, status: 502, error: maintenanceState.error }; }
  });
  return locked.acquired ? locked.result! : { ok: false, status: 409, error: "Printer is busy" };
 }
 return { capabilities, status, ink, cachedInk: getCachedInkLevels, maintenance };
}
