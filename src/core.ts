// Compatibility exports for existing callers. Hardware implementations live in adapters.
import { runCommand, commandResult } from "./system/commands.ts";
import { tcpOpen, clearNetworkCache } from "./system/network.ts";
import { createCupsBackend } from "./printing/cups.ts";
import { createSaneService } from "./scanning/sane.ts";
export * from "./system/commands.ts";
export * from "./system/network.ts";
export type { ScanControl } from "./scanning/types.ts";
export const cupsBackend = createCupsBackend((...args) => runCommand(...args));
export const saneService = createSaneService((...args) => runCommand(...args), (...args) => tcpOpen(...args));
export function cupsPrinterStatus(...args: Parameters<typeof cupsBackend.getStatus>) { return cupsBackend.getStatus(...args); }
export function cachedCupsPrinterStatus(...args: Parameters<typeof cupsBackend.cachedStatus>) { return cupsBackend.cachedStatus(...args); }
export function listJobs(...args: Parameters<typeof cupsBackend.listJobs>) { return cupsBackend.listJobs(...args); }
export function cachedListJobs(...args: Parameters<typeof cupsBackend.cachedJobs>) { return cupsBackend.cachedJobs(...args); }
export function submitPrint(...args: Parameters<typeof cupsBackend.submitJob>) { return cupsBackend.submitJob(...args); }
export function cancelJob(...args: Parameters<typeof cupsBackend.cancelJob>) { return cupsBackend.cancelJob(...args); }
export function detectSaneDevice(...args: Parameters<typeof saneService.detectSaneDevice>) { return saneService.detectSaneDevice(...args); }
export function detectSaneDeviceCached(...args: Parameters<typeof saneService.detectSaneDeviceCached>) { return saneService.detectSaneDeviceCached(...args); }
export function clearDeviceCache(...args: Parameters<typeof saneService.clearDeviceCache>) { return saneService.clearDeviceCache(...args); }
export function warmDeviceCache(...args: Parameters<typeof saneService.warmDeviceCache>) { return saneService.warmDeviceCache(...args); }
export function scannerStatus(...args: Parameters<typeof saneService.scannerStatus>) { return saneService.scannerStatus(...args); }
export function scanDocument(...args: Parameters<typeof saneService.scanDocument>) { return saneService.scanDocument(...args); }
export function clearStatusCaches() { clearNetworkCache(); cupsBackend.clearCache(); saneService.clearStatusCache(); }
