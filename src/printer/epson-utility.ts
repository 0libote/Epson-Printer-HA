import { runCommand } from "../system/commands.ts";
// Availability of a Qt executable is not availability of a usable device backend.
// No command from ecbd's undocumented internal protocol is sent to a printer.
export const epsonUtilityIntegration = {
 id: "epson-utility",
 available: false,
 reason: "No verified headless device-management interface; standard SNMP/IPP/HTTP fallback retained",
 async installation() {
  const result = await runCommand(["dpkg-query", "-W", "-f=${Version}", "epson-printer-utility"], 3000);
  return { installed: result.ok, version: result.ok ? result.stdout.slice(0, 80) : null,
   available: false, reason: this.reason };
 },
};
