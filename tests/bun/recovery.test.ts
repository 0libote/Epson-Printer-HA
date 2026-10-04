import { test, expect } from "bun:test";
import { createDeviceRecovery, chooseRecoveryTarget, type RecoverySettings } from "../../src/device/recovery.ts";
import { parseMdnsPrinters, arpIdentity, mergeCandidates, type DiscoveredPrinter } from "../../src/discover.ts";
const printer = (ip = "192.168.1.50", uuid = "printer-123456"): DiscoveredPrinter => ({ip, uuid, model:"Epson XP-2200", likelyEpson:true, ports:[631], detail:"mdns"});
function fixture(saved: RecoverySettings = {ip:"192.168.1.20",identity:{uuid:"printer-123456"}}) {
 let time = 100_000, connected = false, busy = false, result = "ok" as "ok"|"busy"|"stale"|"failed";
 const sweepFlags: boolean[] = [];
 let found = [printer()], scans = 0, relocations = 0, identityCalls = 0, remembers = 0;
 const deps = {
  read: () => saved, reachable: async (ip:string) => ip === saved.ip ? connected : true,
  identify: async (_ip:string) => {identityCalls++;return found[0] ?? null;},
  discover: async (sweep:boolean) => {sweepFlags.push(sweep);scans++;return found;}, busy: () => busy, now: () => time,
  remember: async (_ip:string, identity:any) => {remembers++;saved.identity=identity;return true;},
  relocate: async (_expected:RecoverySettings,p:DiscoveredPrinter) => {relocations++;if(result==='ok') saved={ip:p.ip,identity:{uuid:p.uuid,mac:p.mac}};return result;},
 };
 const recovery = createDeviceRecovery(deps);
 return {recovery,deps,sweepFlags,get saved(){return saved;},get scans(){return scans;},get relocations(){return relocations;},get remembers(){return remembers;},get identityCalls(){return identityCalls;},advance(){time+=60_001;},setConnected(v:boolean){connected=v;},setBusy(v:boolean){busy=v;},setFound(v:DiscoveredPrinter[]){found=v;},setResult(v:typeof result){result=v;}};
}
test('DNS-SD resolves escaped names, UUID, address and ignores local/IPv6/malicious records',()=>{
 const result=parseMdnsPrinters('=;eth0;IPv4;EPSON\\032XP-2200;_ipp._tcp;local;EPSON.local;192.168.1.50;631;"ty=EPSON XP-2200 Series" "UUID=urn:uuid:PRINTER-123456"\n=;eth0;IPv6;EPSON;_ipp._tcp;local;EPSON.local;::1;631;"ty=EPSON"\n=;eth0;IPv4;EPSON;_ipp._tcp;local;EPSON.local;127.0.0.1;631;"ty=EPSON"');
 expect(result).toHaveLength(1);expect(result[0].uuid).toBe('printer-123456');expect(result[0].hostname).toBe('EPSON.local');expect(result[0].likelyEpson).toBe(true);
});
test('ARP identity accepts only complete entries for the exact address',()=>{
 const table='IP address HW type Flags HW address Mask Device\n192.168.1.50 0x1 0x2 AA:BB:CC:DD:EE:FF * eth0\n192.168.1.51 0x1 0x0 AA:BB:CC:DD:EE:00 * eth0';
 expect(arpIdentity('192.168.1.50',table)).toBe('aa:bb:cc:dd:ee:ff');expect(arpIdentity('192.168.1.51',table)).toBeUndefined();
});
test('discovery merges multiple services and network evidence for one printer',()=>{
 const merged=mergeCandidates([printer(),{...printer(),uuid:undefined,mac:'aa:bb:cc:dd:ee:ff',ports:[9100]}]);
 expect(merged).toHaveLength(1);expect(merged[0].uuid).toBe('printer-123456');expect(merged[0].ports).toEqual([631,9100]);
});
test('never guesses between identities or duplicate advertisements',()=>{
 expect(chooseRecoveryTarget({ip:'',identity:undefined},[printer(),printer('192.168.1.60','other-printer')])).toBeNull();
 expect(chooseRecoveryTarget({ip:'192.168.1.20'},[printer()])).toBeNull();
 expect(chooseRecoveryTarget({ip:'x',identity:{uuid:'printer-123456',mac:'aa'}},[{...printer(),uuid:'different',mac:'aa'}])).toBeNull();
 expect(chooseRecoveryTarget({ip:'x',identity:{uuid:'printer-123456'}},[printer(),printer('192.168.1.60')])).toBeNull();
});
test('DHCP movement follows remembered identity and reports previous address',async()=>{
 const f=fixture();const status=await f.recovery.tick();expect(status.state).toBe('recovered');expect(status.previousAddress).toBe('192.168.1.20');expect(f.saved.ip).toBe('192.168.1.50');expect(f.relocations).toBe(1);
});
test('fresh installation adopts exactly one verified Epson',async()=>{
 const f=fixture({ip:''});expect((await f.recovery.tick()).state).toBe('recovered');expect(f.saved.ip).toBe('192.168.1.50');
});
test('multiple Epson printers require deliberate selection',async()=>{
 const f=fixture({ip:''});f.setFound([printer(),printer('192.168.1.60','other-printer')]);expect((await f.recovery.tick()).state).toBe('ambiguous');expect(f.relocations).toBe(0);
});
test('learns identity online without reconfiguring a healthy queue',async()=>{
 const f=fixture({ip:'192.168.1.50'});f.setConnected(true);expect((await f.recovery.tick()).state).toBe('ready');expect(f.remembers).toBe(1);expect(f.saved.identity?.uuid).toBe('printer-123456');expect(f.relocations).toBe(0);
});
test('sleeping/offline device leaves settings intact and retries with backoff',async()=>{
 const f=fixture();f.setFound([]);expect((await f.recovery.tick()).state).toBe('offline');await f.recovery.tick();expect(f.scans).toBe(2);f.advance();await f.recovery.tick();expect(f.scans).toBe(3);expect(f.sweepFlags).toEqual([false,true,false]);expect(f.saved.ip).toBe('192.168.1.20');
});
test('deduplicates concurrent recovery and preserves settings on failed queue setup',async()=>{
 const f=fixture();f.setResult('failed');await Promise.all([f.recovery.tick(true),f.recovery.tick(true)]);expect(f.relocations).toBe(1);expect(f.saved.ip).toBe('192.168.1.20');expect(f.recovery.status().state).toBe('failed');
});
test('conflicting operations and stale manual edits defer recovery',async()=>{
 const f=fixture();f.setBusy(true);expect((await f.recovery.tick()).state).toBe('busy');expect(f.relocations).toBe(0);f.setBusy(false);f.setResult('stale');expect((await f.recovery.tick(true)).state).toBe('waiting');expect(f.saved.ip).toBe('192.168.1.20');
});
test('an old address reused by another device does not suppress recovery',async()=>{
 const f=fixture();f.setConnected(true);f.deps.identify=async()=>({...printer('192.168.1.20','other-device'),likelyEpson:false});
 expect((await f.recovery.tick()).state).toBe('recovered');expect(f.saved.ip).toBe('192.168.1.50');
});
test('discovery errors are bounded and safe for users',async()=>{
 const f=fixture();f.deps.discover=async()=>{throw Error('private traceback');};const status=await f.recovery.tick();expect(status.state).toBe('failed');expect(status.message).not.toContain('traceback');
});
