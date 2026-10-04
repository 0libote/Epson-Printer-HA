import type { InkStatus } from "./ink-types.ts";
export type DeviceState = "ready" | "printing" | "scanning" | "busy" | "sleeping" | "offline" | "error" | "unknown";
export type MaintenanceAction = "nozzle-check" | "head-clean";
export type PrinterCapabilities = { inkLevels: boolean; pageCount: boolean; nozzleCheck: boolean; headCleaning: boolean };
export type DeviceStatus = { state: DeviceState; backend: string; rawState: string; warnings: string[] };
export interface PrinterBackend {
 id: string;
 available(ip: string): Promise<boolean>;
 getCapabilities(ip: string): Promise<PrinterCapabilities>;
 getStatus(ip: string): Promise<DeviceStatus>;
 getInkLevels(ip: string): Promise<InkStatus>;
 maintenance?(ip: string, action: MaintenanceAction): Promise<void>;
}
export function normalizePrinterState(raw: string, reachable: boolean): DeviceState {
 if (!reachable) return "offline";
 const state = raw.toLowerCase();
 if (state === "disabled" || state === "error") return "error";
 if (["ready", "printing", "scanning", "busy", "sleeping"].includes(state)) return state as DeviceState;
 return "unknown";
}
