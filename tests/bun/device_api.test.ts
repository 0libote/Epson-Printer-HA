import { test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
let app: typeof import("../../src/app.ts");
import * as core from "../../src/core.ts";
let dir:string;
const restores: Array<{ mockRestore():void }> = [];
beforeEach(async ()=>{
 dir=mkdtempSync(join(tmpdir(),'epson-device-api-'));process.env.APP_DATA=dir;app=await import('../../src/app.ts');app._setAppDirForTest(dir);app._setAuthForTest('','');app._savePrinterIp('192.0.2.10');
 const history=await import('../../src/history.ts');history._setAppDir(dir);history.initHistory();
 restores.push(spyOn(core.scannerManager,'capabilities').mockResolvedValue({selected:null,backends:[],capabilities:null}));
 restores.push(spyOn(core.scannerManager.epson,'health').mockRejectedValue(new Error('unavailable')));
});
afterEach(()=>{ for(const r of restores.splice(0))r.mockRestore();app._setAuthForTest('','');rmSync(dir,{recursive:true,force:true}); });
async function token(){const response=await app.app.request('/api/csrf');const data=await response.json() as any;return {csrf:data.csrf_token,cookie:response.headers.get('set-cookie')!.split(';')[0]};}
function post(path:string,csrf:string,cookie:string){return app.app.request(path,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf,cookie},body:'{}'});}
test('capabilities are honest and setup-independent',async()=>{
 const data=await (await app.app.request('/api/capabilities')).json() as any;
 expect(data.printing.backend).toBe('cups');expect(data.printer.capabilities.nozzleCheck).toBe(false);expect(data.printer.capabilities.headCleaning).toBe(false);expect(data.scanner.backends).toEqual([]);
});
test('diagnostics never serialize community strings or credentials',async()=>{
 const original=process.env.SNMP_COMMUNITY;process.env.SNMP_COMMUNITY='test-private-community';
 try {const response=await app.app.request('/api/diagnostics');const data=await response.json() as any;
 expect(data.version).toBe('1.4.0');expect(data.epsonUtility.available).toBe(false);expect(JSON.stringify(data)).not.toContain('test-private-community');expect(data).not.toHaveProperty('environment');
 }finally{if(original===undefined)delete process.env.SNMP_COMMUNITY;else process.env.SNMP_COMMUNITY=original;}
});
test('new status and diagnostics endpoints obey dashboard authentication',async()=>{
 app._setAuthForTest('test','secret');
 for(const path of ['/api/capabilities','/api/printer/status','/api/scanner/status','/api/diagnostics'])expect((await app.app.request(path)).status).toBe(401);
});
test('maintenance validates CSRF/action and reports unsupported',async()=>{
 expect((await app.app.request('/api/printer/maintenance/head-clean',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(400);
 const {csrf,cookie}=await token();
 expect((await post('/api/printer/maintenance/factory-reset',csrf,cookie)).status).toBe(400);
 const response=await post('/api/printer/maintenance/nozzle-check',csrf,cookie);expect(response.status).toBe(501);expect((await response.json() as any).error).toContain('unsupported');
});
test('rediscovery is an authenticated CSRF mutation',async()=>{
 expect((await app.app.request('/api/scanner/rediscover',{method:'POST'})).status).toBe(400);
 const {csrf,cookie}=await token();expect((await post('/api/scanner/rediscover',csrf,cookie)).status).toBe(200);
});
test('old Home Assistant status fields survive alongside structured state',async()=>{
 restores.push(spyOn(core,'cachedPrinterReachable').mockResolvedValue(false));
 restores.push(spyOn(core,'cachedCupsPrinterStatus').mockResolvedValue({ok:true,state:'ready',detail:'idle'}));
 restores.push(spyOn(core,'scannerStatus').mockResolvedValue({ok:false,state:'not_detected',detail:'offline',backend:null,device:null,open_source:false}));
 restores.push(spyOn(core,'cachedListJobs').mockResolvedValue([]));
 const data=await (await app.app.request('/api/status')).json() as any;
 for(const field of ['printer_ip','printer_name','printer','scanner','queue','recent_prints','scans','ink'])expect(data).toHaveProperty(field);
 expect(data.printer.state).toBe('ready');expect(data.device.state).toBe('offline');expect(data.device.rawState).toBe('ready');
 expect((await app.app.request('/api/history')).status).toBe(200);
});
test('visible build is consistent in status, health and diagnostics',async()=>{
 restores.push(spyOn(core,'cachedPrinterReachable').mockResolvedValue(false));
 restores.push(spyOn(core,'cachedCupsPrinterStatus').mockResolvedValue({ok:true,state:'ready',detail:'idle'}));
 restores.push(spyOn(core,'scannerStatus').mockResolvedValue({ok:false,state:'not_detected',detail:'offline',backend:null,device:null,open_source:false}));
 restores.push(spyOn(core,'cachedListJobs').mockResolvedValue([]));
 const status=await (await app.app.request('/api/status')).json() as any;
 const health=await (await app.app.request('/api/health')).json() as any;
 const diagnostics=await (await app.app.request('/api/diagnostics')).json() as any;
 expect(status.build_number).toBeGreaterThanOrEqual(132);expect(health.build_number).toBe(status.build_number);expect(diagnostics.build_number).toBe(status.build_number);expect(status.recovery).toHaveProperty('state');
});
test('recovery endpoint requires auth and CSRF and returns bounded structured state',async()=>{
 app._setAuthForTest('test','secret');expect((await app.app.request('/api/printer/recover',{method:'POST'})).status).toBe(401);app._setAuthForTest('','');
 expect((await app.app.request('/api/printer/recover',{method:'POST'})).status).toBe(400);
 const {csrf,cookie}=await token();restores.push(spyOn(app.deviceRecovery,'tick').mockResolvedValue({state:'offline',message:'Retrying automatically',lastChecked:null,lastRecovered:null,previousAddress:null}));
 const response=await post('/api/printer/recover',csrf,cookie);expect(response.status).toBe(200);expect((await response.json() as any).state).toBe('offline');
});
test('automatic recovery updates existing queue then persistent address and identity',async()=>{
 const {writeFileSync,readFileSync}=await import('node:fs');const discovery=await import('../../src/discover.ts');
 restores.push(spyOn(discovery,'discoverAdvertisedPrinters').mockResolvedValue([]));
 writeFileSync(join(dir,'settings.json'),JSON.stringify({printer_ip:'192.0.2.10',printer_identity:{uuid:'device-123456'},printer_name:'Existing_Queue',display_name:'My Printer',share_printer:true}));app._setAppDirForTest(dir);
 restores.push(spyOn(core,'cachedPrinterReachable').mockImplementation(async ip=>ip==='192.0.2.44'));
 restores.push(spyOn(discovery,'discoverPrinters').mockResolvedValue({ok:true,printers:[{ip:'192.0.2.44',uuid:'device-123456',model:'Epson XP-2200',ports:[631],likelyEpson:true,detail:'mdns'}],subnets:[],scanned_at:''}));
 const configure=spyOn(core.cupsBackend,'configureQueue').mockResolvedValue([true,'configured']);restores.push(configure);
 const status=await app.deviceRecovery.tick(true);expect(status.state).toBe('recovered');expect(configure).toHaveBeenCalledWith('192.0.2.44',{printerName:'Existing_Queue',displayName:'My Printer',sharePrinter:true,oldPrinterName:undefined});
 const saved=JSON.parse(readFileSync(join(dir,'settings.json'),'utf8'));expect(saved.printer_ip).toBe('192.0.2.44');expect(saved.printer_identity.uuid).toBe('device-123456');expect(saved.printer_name).toBe('Existing_Queue');
});
test('a manual edit during discovery prevents stale recovery from reconfiguring CUPS',async()=>{
 const {writeFileSync}=await import('node:fs');const discovery=await import('../../src/discover.ts');
 restores.push(spyOn(discovery,'discoverAdvertisedPrinters').mockResolvedValue([]));
 writeFileSync(join(dir,'settings.json'),JSON.stringify({printer_ip:'192.0.2.10',printer_identity:{uuid:'device-123456'}}));app._setAppDirForTest(dir);
 restores.push(spyOn(core,'cachedPrinterReachable').mockImplementation(async ip=>ip!=='192.0.2.10'));
 restores.push(spyOn(discovery,'discoverPrinters').mockImplementation(async()=>{app._savePrinterIp('192.0.2.99');return {ok:true,printers:[{ip:'192.0.2.44',uuid:'device-123456',model:'Epson',ports:[631],likelyEpson:true,detail:'mdns'}],subnets:[],scanned_at:''};}));
 const configure=spyOn(core.cupsBackend,'configureQueue').mockResolvedValue([true,'configured']);restores.push(configure);
 expect((await app.deviceRecovery.tick(true)).state).toBe('waiting');expect(configure).not.toHaveBeenCalled();expect(app.currentPrinterIp()).toBe('192.0.2.99');
});
