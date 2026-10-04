import type { DiscoveredPrinter } from "../discover.ts";
export type DeviceIdentity = { uuid?: string; mac?: string; model?: string | null };
export type RecoverySettings = { ip: string; identity?: DeviceIdentity };
export type RecoveryStatus = { state: "waiting" | "checking" | "searching" | "ready" | "recovered" | "ambiguous" | "offline" | "busy" | "failed"; message: string; lastChecked: string | null; lastRecovered: string | null; previousAddress: string | null };
export function identityOf(p: DiscoveredPrinter): DeviceIdentity {
 return { ...(p.uuid ? { uuid: p.uuid } : {}), ...(p.mac ? { mac: p.mac } : {}), model: p.model };
}
export function sameDevice(identity: DeviceIdentity, p: DiscoveredPrinter): boolean {
 // A conflicting UUID cannot be overridden by a coincidental matching MAC.
 if (identity.uuid && p.uuid) return identity.uuid === p.uuid;
 return !!identity.mac && identity.mac === p.mac;
}
export function chooseRecoveryTarget(settings: RecoverySettings, printers: DiscoveredPrinter[]): DiscoveredPrinter | null {
 const unique = [...new Map(printers.map(p => [p.ip, p])).values()];
 const matches = settings.identity?.uuid || settings.identity?.mac
  ? unique.filter(p => sameDevice(settings.identity!, p))
  : settings.ip ? [] : unique.filter(p => p.likelyEpson);
 return matches.length === 1 ? matches[0] : null;
}
export function createDeviceRecovery(deps: {
 read: () => RecoverySettings;
 reachable: (ip: string) => Promise<boolean>;
 identify: (ip: string) => Promise<DiscoveredPrinter | null>;
 discover: (sweep: boolean) => Promise<DiscoveredPrinter[]>;
 remember: (expectedIp: string, identity: DeviceIdentity) => Promise<boolean>;
 relocate: (expected: RecoverySettings, printer: DiscoveredPrinter) => Promise<"ok" | "busy" | "stale" | "failed">;
 busy: () => boolean;
 now?: () => number;
}) {
 const now = deps.now ?? Date.now;
 const status: RecoveryStatus = { state: "waiting", message: "Automatic printer discovery starts with the hub", lastChecked: null, lastRecovered: null, previousAddress: null };
 let pending: Promise<RecoveryStatus> | null = null, nextCheck = 0, nextSweep = 0, learnedIp = "", nextIdentityCheck = 0;
 const set = (state: RecoveryStatus["state"], message: string) => { status.state = state; status.message = message; };
 async function check() {
  const saved = deps.read();
  status.lastChecked = new Date(now()).toISOString();
  if (deps.busy()) { set("busy", "Waiting for the current printer operation to finish"); return; }
  set("checking", "Checking the saved printer address");
  let connected = !!saved.ip && await deps.reachable(saved.ip);
  if (connected) {
   if ((!saved.identity?.uuid && !saved.identity?.mac) || learnedIp !== saved.ip || now() >= nextIdentityCheck) {
    nextIdentityCheck = now() + 300_000;
    const printer = await deps.identify(saved.ip);
    if (printer) {
     if ((saved.identity?.uuid || saved.identity?.mac) && (printer.uuid || printer.mac) && !sameDevice(saved.identity, printer)) connected = false;
     if (connected && (printer.likelyEpson || (saved.identity && sameDevice(saved.identity, printer)))) {
      const learned = identityOf(printer);
      if (learned.uuid || learned.mac) { if (await deps.remember(saved.ip, { ...saved.identity, ...learned })) learnedIp = saved.ip; }
     }
    }
   }
   if (connected) { set("ready", saved.identity?.uuid || saved.identity?.mac || learnedIp === saved.ip ? "Printer connected; automatic address recovery is enabled" : "Printer connected; waiting for a stable identity to enable address recovery"); return; }
  }
  set("searching", saved.ip ? "Looking for this printer at its new address" : "Looking for an Epson printer on your network");
  const sweep = now() >= nextSweep;
  let printers = await deps.discover(false);
  let target = chooseRecoveryTarget(saved, printers);
  if (!target && sweep) {
   nextSweep = now() + 300_000;
   printers = await deps.discover(true);
   target = chooseRecoveryTarget(saved, printers);
  }
  if (deps.busy()) { set("busy", "Waiting for the current printer operation to finish"); return; }
  if (!target) {
   if (!saved.ip && printers.filter(p => p.likelyEpson).length > 1) set("ambiguous", "Several Epson printers found; choose yours in Settings");
   else if (saved.ip && !saved.identity?.uuid && !saved.identity?.mac && printers.some(p => p.likelyEpson)) set("ambiguous", "Choose your printer once in Settings so the hub can remember it and follow address changes");
   else set("offline", "Printer not found yet; the hub will keep looking automatically");
   return;
  }
  if (!await deps.reachable(target.ip)) { set("offline", "Printer discovered but not responding yet; retrying automatically"); return; }
  const result = await deps.relocate(saved, target);
  if (result === "ok") {
   status.previousAddress = saved.ip || null; status.lastRecovered = new Date(now()).toISOString(); learnedIp = target.ip;
   set("recovered", `Printer ${saved.ip ? "reconnected" : "set up"} automatically at ${target.ip}`);
   console.info(`[device:recovery] ${status.message}`);
  } else if (result === "busy") set("busy", "Waiting for the current printer operation to finish");
  else if (result === "stale") set("waiting", "Printer settings changed; checking again shortly");
  else set("failed", "Could not update the print queue; previous settings kept, retrying automatically");
 }
 function tick(force = false): Promise<RecoveryStatus> {
  if (pending) return pending;
  if (!force && now() < nextCheck) return Promise.resolve({ ...status });
  if (force) nextSweep = 0; // Deliberate reconnect may bypass the background sweep cooldown.
  nextCheck = now() + 60_000;
  pending = check().catch(() => set("failed", "Discovery temporarily unavailable; retrying automatically"))
   .then(() => ({ ...status })).finally(() => { pending = null; });
  return pending;
 }
 return { tick, status: () => ({ ...status }), start() {
  void tick(); const timer = setInterval(() => { void tick(); }, 60_000); timer.unref?.();
  return () => clearInterval(timer);
 } };
}
