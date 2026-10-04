import { test, expect, spyOn, afterEach } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScannerManager, supportsOptions } from "../../src/scanning/manager.ts";
import { EpsonScan2Backend } from "../../src/scanning/epson-scan2.ts";
import { parseSaneCapabilities } from "../../src/scanning/airscan.ts";
import { createSaneService, parseSaneDevices } from "../../src/scanning/sane.ts";
import { createCupsBackend } from "../../src/printing/cups.ts";
import { createPrinterDeviceService } from "../../src/printer/manager.ts";
import { normalizePrinterState } from "../../src/printer/types.ts";
import { createOperationLocks } from "../../src/system/process-lock.ts";
import { commandResult, readCommandStream, runCommand } from "../../src/system/commands.ts";
import * as snmp from "../../src/printer/snmp.ts";
import * as ipp from "../../src/printer/ipp.ts";
import * as web from "../../src/printer/web-status.ts";
import { fetchInkLevels } from "../../src/printer/standard.ts";

const caps = { resolutions: [150, 300, 600], modes: ["Color", "Gray"], sources: ["flatbed"], formats: ["png","jpg","pdf"], verified: true };
const help = "--mode Color|Gray|Lineart [Color]\n--resolution 75..600dpi [300]\n--source Flatbed [Flatbed]\n-x 0..215.9mm [210]\n-y 0..297.18mm [297]";
const health = { ok: true, version: "6.7.80.0-1", printerAddress: "192.0.2.10", capabilities: { ...caps, combinations: [{ dpi: 300, mode: "Color" }] }, lastError: null };
const disabledEpson = () => new EpsonScan2Backend(async () => { throw new Error("unavailable"); });
const dirs: string[] = [];
const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => { for (const mock of mocks.splice(0)) mock.mockRestore(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "epson-adapter-")); dirs.push(dir); return dir; };
function fakeSane(devices: Array<{ rank: number; device: string; backend: string }>, scan = async () => [commandResult(true), null]) {
 return { listCandidates: async () => devices, scanDocument: scan, clearDeviceCache() {} } as any;
}

test("SANE capabilities parse actual lists/ranges and require A4 flatbed", () => {
 expect(parseSaneCapabilities(help)).toEqual({ ...caps, resolutions:[150,200,300,600], modes:["Color","Gray","Lineart"] });
 expect(parseSaneCapabilities(help.replace("297.18", "200")).verified).toBe(false);
 expect(parseSaneCapabilities("--resolution 150|300dpi\n--mode Gray\n--source ADF").sources).toEqual([]);
});
test("exact Epson profile combinations do not become a Cartesian product", () => {
 expect(supportsOptions({ ...caps, combinations:[{dpi:300,mode:"Gray"}] } as any, {dpi:300,mode:"Color"})).toBe(false);
 expect(supportsOptions(caps, {dpi:300,mode:"Color",fmt:"jpeg"})).toBe(true);
});
test("discovery matches target address exactly and supports other vendors", () => {
 const found = parseSaneDevices("device 'airscan:e0:Other' is a scanner ip=192.0.2.10\ndevice 'airscan:e1:Wrong' is a scanner ip=192.0.2.100", "192.0.2.10");
 expect(found.map(d => d.device)).toEqual(["airscan:e0:Other"]);
});
test("AirScan with usable capabilities is preferred", async () => {
 const sane=fakeSane([{rank:0,device:"airscan:test",backend:"AirScan/WSD"},{rank:2,device:"epsonds:test",backend:"Open-source SANE"}]);
 const epson=new EpsonScan2Backend(async () => Response.json(health));
 const manager=createScannerManager(sane, async () => commandResult(true,help),epson);
 expect((await manager.select("192.0.2.10",{dpi:300,mode:"Color"}))?.id).toBe("airscan");
});
test("capability rejection allows Epson before generic SANE", async () => {
 const sane=fakeSane([{rank:0,device:"airscan:test",backend:"AirScan/WSD"},{rank:2,device:"epsonds:test",backend:"Open-source SANE"}]);
 const manager=createScannerManager(sane, async () => commandResult(true,help.replace("75..600", "75..150")),new EpsonScan2Backend(async () => Response.json(health)));
 expect((await manager.select("192.0.2.10",{dpi:300,mode:"Color"}))?.id).toBe("epsonscan2");
});
test("crashed or unprovisioned sidecar preserves SANE", async () => {
 const sane=fakeSane([{rank:2,device:"epsonds:test",backend:"Open-source SANE"}]);
 const manager=createScannerManager(sane, async () => commandResult(true,help),disabledEpson());
 expect((await manager.select("192.0.2.10",{}))?.id).toBe("sane");
 expect(await disabledEpson().available("192.0.2.10")).toBe(false);
 const empty=new EpsonScan2Backend(async () => Response.json({ ...health, capabilities:{...caps,combinations:[]} }));
 expect(await empty.available("192.0.2.10")).toBe(false);
});
test("discovery is shared across callers and invalidated on IP/explicit refresh", async () => {
 let calls=0;
 const sane=fakeSane([]); sane.listCandidates=async () => { calls++; await Bun.sleep(5); return []; };
 const manager=createScannerManager(sane,undefined,disabledEpson());
 await Promise.all([manager.backends("192.0.2.10"),manager.backends("192.0.2.10")]);
 expect(calls).toBe(1);
 await manager.backends("192.0.2.20"); expect(calls).toBe(2);
 await manager.backends("192.0.2.10",true); expect(calls).toBe(3);
});
test("failed acquisition is not repeated on another backend, and next request can fallback", async () => {
 let acquisitions=0;
 const sane=fakeSane([{rank:0,device:"airscan:test",backend:"AirScan/WSD"},{rank:2,device:"epsonds:test",backend:"SANE"}],async () => { acquisitions++; return [commandResult(false,"","timeout",1),null]; });
 const manager=createScannerManager(sane,async () => commandResult(true,help),disabledEpson());
 const result=await manager.scan("192.0.2.10",temp(),{});
 expect(result[0].ok).toBe(false); expect(acquisitions).toBe(1);
 expect((await manager.select("192.0.2.10",{}))?.id).toBe("sane");
});
test("cancelled acquisition does not penalize backend reliability", async () => {
 const sane=fakeSane([{rank:0,device:"airscan:test",backend:"AirScan/WSD"}],async () => [commandResult(false,"","scan_cancelled",130),null]);
 const manager=createScannerManager(sane,async () => commandResult(true,help),disabledEpson());
 await manager.scan("192.0.2.10",temp(),{});
 expect((await manager.select("192.0.2.10",{}))?.id).toBe("airscan");
});
test("Epson API translates scan requests and publishes validated PNG", async () => {
 const requests:Array<{ path:string; body?:object }>=[];
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=","base64");
 const id="a".repeat(32);
 const backend=new EpsonScan2Backend(async (path,body) => {
  requests.push({path,body});
  if(path==="/health")return Response.json(health);
  if(path==="/scan")return Response.json({id},{status:202});
  if(path.endsWith('/file'))return new Response(png,{headers:{"content-type":"image/png","content-length":String(png.length)}});
  return Response.json({state:"done"});
 });
 const dir=temp();const [result,path]=await backend.scan("192.0.2.10",dir,{fmt:"png"});
 expect(result.ok).toBe(true);expect(readdirSync(dir)).toEqual([path!.split('/').pop()!]);
 expect(requests.find(r=>r.path==='/scan')?.body).toEqual({ip:"192.0.2.10",dpi:300,mode:"Color",format:"png"});
});
test("Epson cancellation sends cancel and waits for settled job", async () => {
 const id="b".repeat(32); let cancelled=false, requested=false;
 const backend=new EpsonScan2Backend(async (path) => {
  if(path==='/health')return Response.json(health);
  if(path==='/scan')return Response.json({id},{status:202});
  if(path.endsWith('/cancel')){requested=true;return Response.json({ok:true});}
  return Response.json({state:requested?'cancelled':'scanning'});
 });
 const [result]=await backend.scan("192.0.2.10",temp(),{control:{isCancelled:()=>cancelled,registerProcess:process=>{cancelled=true;process.kill();},clearProcess:()=>{}}});
 expect(requested).toBe(true);expect(result.returncode).toBe(130);
});
test("Epson errors and oversized output never publish or expose raw errors", async () => {
 for(const failure of ['error','oversized','crash']) {
  const backend=new EpsonScan2Backend(async path=>{
   if(path==='/health')return Response.json(health);
   if(path==='/scan')return Response.json({id:'c'.repeat(32)},{status:202});
   if(path.endsWith('/cancel'))return Response.json({ok:true});
   if(failure==='crash')throw new Error('private low-level stderr');
   if(path.endsWith('/file'))return new Response('png',{headers:{'content-type':'image/png','content-length':'999999999'}});
   return Response.json({state:failure==='error'?'error':'done',error:'private low-level stderr'});
  });
  const dir=temp();const [result,path]=await backend.scan('192.0.2.10',dir,{});
  expect(result.ok).toBe(false);expect(path).toBeNull();expect(readdirSync(dir)).toEqual([]);
  // Network exceptions should be normalized by the adapter too.
  expect(result.stderr).not.toContain('private');
 }
});
test("malicious parameters never reach CUPS subprocess", async () => {
 let calls=0;const cups=createCupsBackend(async()=>{calls++;return commandResult(true);});
 expect((await cups.submitJob('-evil','/tmp/file')).ok).toBe(false);
 expect((await cups.submitJob('valid','/tmp/file',{copies:NaN})).ok).toBe(false);
 expect((await cups.cancelJob('queue-1;id')).ok).toBe(false);
 expect((await cups.configureQueue('127.0.0.1',{printerName:'q',displayName:'q',sharePrinter:true}))[0]).toBe(false);
 expect(calls).toBe(0);
});
test("CUPS jobs preserve names containing hyphens and configured queue", async () => {
 let args:string[]=[]; const cups=createCupsBackend(async a=>{args=a;return commandResult(true,'my-queue-23 epson 1024 date');});
 expect((await cups.listJobs('my-queue'))[0].id).toBe('my-queue-23');expect(args).toEqual(['lpstat','-o','my-queue']);
});
test("normalized device states keep disabled/error separate from offline/sleeping", () => {
 expect(normalizePrinterState('disabled',true)).toBe('error');expect(normalizePrinterState('ready',false)).toBe('offline');
 expect(normalizePrinterState('sleeping',true)).toBe('sleeping');expect(normalizePrinterState('unconfigured',true)).toBe('unknown');
});
test("standard ink ordering skips all-unknown data", async () => {
 const status=(source:'snmp'|'ipp'|'http',level:number|null)=>({ok:true,source,updated_at:'now',cartridges:[{key:'black',name:'Black',color:'#000',level,state:level===null?'unknown':'ok',detail:''}],message:''}) as any;
 const snmpMock=spyOn(snmp,'trySnmp').mockResolvedValue(status('snmp',null));mocks.push(snmpMock);
 const ippMock=spyOn(ipp,'tryIpp').mockResolvedValue(status('ipp',55));mocks.push(ippMock);
 const webMock=spyOn(web,'tryHttp').mockResolvedValue(status('http',70));mocks.push(webMock);
 expect((await fetchInkLevels('192.0.2.10')).source).toBe('ipp');expect(webMock).not.toHaveBeenCalled();
 ippMock.mockResolvedValue(status('ipp',null));expect((await fetchInkLevels('192.0.2.10')).source).toBe('http');
});
test("maintenance is unsupported with standard backend", async () => {
 const dir=temp(); const locks=createOperationLocks(() => dir);
 const service=createPrinterDeviceService({reachable:async()=>true,queueStatus:async()=>({state:'ready',detail:''}),jobs:async()=>[],scannerBusy:()=>false,lock:fn=>locks.withOperationLock('device',fn)});
 expect((await service.maintenance('192.0.2.10','q','nozzle-check')).status).toBe(501);
 expect((await service.capabilities('192.0.2.10')).capabilities.headCleaning).toBe(false);
});
test("maintenance respects scan/queue conflicts and mutual exclusion", async () => {
 const dir=temp(); const locks=createOperationLocks(() => dir);let busy=false, jobs:unknown[]=[], calls=0;
 let finish!:()=>void; const pending=new Promise<void>(resolve=>finish=resolve);
 const backend:any={id:'verified-test',available:async()=>true,getCapabilities:async()=>({inkLevels:true,pageCount:false,nozzleCheck:true,headCleaning:true}),maintenance:async()=>{calls++;await pending;}};
 const service=createPrinterDeviceService({reachable:async()=>true,queueStatus:async()=>({state:'ready',detail:''}),jobs:async()=>jobs,scannerBusy:()=>busy,lock:fn=>locks.withOperationLock('device',fn)},backend);
 busy=true;expect((await service.maintenance('192.0.2.10','q','head-clean')).status).toBe(409);
 busy=false;jobs=[{}];expect((await service.maintenance('192.0.2.10','q','head-clean')).status).toBe(409);
 jobs=[];const first=service.maintenance('192.0.2.10','q','head-clean');await Bun.sleep(5);
 expect((await service.maintenance('192.0.2.10','q','nozzle-check')).status).toBe(409);
 expect((await service.status('192.0.2.10','q')).state).toBe('busy');
 finish();expect((await first).ok).toBe(true);expect(calls).toBe(1);expect((await service.capabilities('192.0.2.10')).maintenance.state).toBe('complete');
});
test("command timeouts and bounded drain survive noisy subprocesses", async () => {
 const timeout=await runCommand(['python3','-c','import time;time.sleep(30)'],20);expect(timeout.stderr).toBe('timeout');
 const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('abc'.repeat(100)));c.close();}});
 expect(await readCommandStream(stream,5)).toBe('abcab\n…[truncated]');
});

test("failed discovery clears previously enumerated candidates", async () => {
 let online = true;
 const service = createSaneService(async () => online ? commandResult(true, "device 'epsonds:net:192.0.2.10' is a scanner") : commandResult(false));
 expect(await service.listCandidates("192.0.2.10", true)).toHaveLength(1);
 online = false;
 expect(await service.listCandidates("192.0.2.10", true)).toEqual([]);
});
test("capability summary selects a backend even when its default options are unsupported", async () => {
 const manager = createScannerManager(fakeSane([{ rank:0, device:"airscan:test", backend:"AirScan/WSD" }]), async () => commandResult(true,help.replace("Color|Gray|Lineart", "Gray").replace("75..600", "150..150")), disabledEpson());
 const summary = await manager.capabilities("192.0.2.10");
 expect(summary.selected).toBe("airscan");
 expect(summary.capabilities?.modes).toEqual(["Gray"]);
 expect(summary.capabilities?.resolutions).toEqual([150]);
});
