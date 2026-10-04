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
