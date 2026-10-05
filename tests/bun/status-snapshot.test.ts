import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStatusSnapshot } from "../../src/system/status-snapshot.ts";
function gate<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>resolve=r); return {promise,resolve}; }
test('a stalled scanner never blocks cached reads or independent print status updates',async()=>{
 const scanner=gate<string>();let calls=0;
 const cache=createStatusSnapshot({key:()=> 'printer-a',fallback:()=>({printer:'unknown',scanner:'unknown'}),loaders:{printer:async()=> 'ready',scanner:()=>{calls++;return scanner.promise;}}});
 const update=cache.refresh();await Bun.sleep(0);const start=performance.now();
 for(let i=0;i<100;i++) { const status=cache.read();expect(status.values.printer).toBe('ready');expect(status.values.scanner).toBe('unknown');expect(status.metadata.scanner.refreshing).toBe(true);cache.background(); }
 expect(performance.now()-start).toBeLessThan(100);expect(calls).toBe(1);
 scanner.resolve('ready');await update;expect(cache.read().metadata.scanner.refreshing).toBe(false);
});
test('concurrent fresh reads share probes and obey TTL',async()=>{
 let calls=0,time=100000;const command=gate<boolean>();
 const cache=createStatusSnapshot({key:()=> 'a',now:()=>time,fallback:()=>({reachable:false}),loaders:{reachable:()=>{calls++;return command.promise;}}});
 const promises=Array.from({length:20},()=>cache.refresh());await Bun.sleep(0);expect(calls).toBe(1);command.resolve(true);await Promise.all(promises);await cache.refresh();expect(calls).toBe(1);time+=15001;await cache.refresh();expect(calls).toBe(2);
});
test('IP changes discard old probe results and deduplicate replacement checks',async()=>{
 let ip='a';let calls=0;const old=gate<string>();
 const cache=createStatusSnapshot({key:()=>ip,fallback:()=>({state:'unknown'}),loaders:{state:()=>{calls++;return ip==='a'?old.promise:Promise.resolve('new ready');}}});
 const first=cache.refresh();await Bun.sleep(0);ip='b';const second=cache.refresh();expect(cache.read().values.state).toBe('unknown');old.resolve('old ready');await Promise.all([first,second]);expect(cache.read().values.state).toBe('new ready');expect(calls).toBe(2);
});
test('failed component preserves last known value with truthful metadata and backoff',async()=>{
 let time=100000,fail=false,calls=0;
 const cache=createStatusSnapshot({key:()=> 'a',now:()=>time,fallback:()=>({state:'unknown'}),loaders:{state:async()=>{calls++;if(fail)throw Error('secret stderr');return 'ready';}}});
 await cache.refresh();time+=15001;fail=true;await cache.refresh();expect(cache.read().values.state).toBe('ready');expect(cache.read().metadata.state.stale).toBe(true);expect(cache.read().metadata.state.error).not.toContain('secret');await cache.refresh();expect(calls).toBe(2);time+=30001;await cache.refresh();expect(calls).toBe(3);
});
test('explicit fresh data cannot be overwritten by an older pending check',async()=>{
 const old=gate<string>();const cache=createStatusSnapshot({key:()=> 'a',fallback:()=>({state:'unknown'}),loaders:{state:()=>old.promise}});
 const refresh=cache.refresh();await Bun.sleep(0);cache.set('state','manual fresh');old.resolve('old cached');await refresh;expect(cache.read().values.state).toBe('manual fresh');
});
test('legacy wait can exclude slow supplies while all components refresh in background',async()=>{
 const supplies=gate<string>();const cache=createStatusSnapshot({key:()=> 'a',fallback:()=>({printer:'unknown',ink:'unknown'}),loaders:{printer:async()=> 'ready',ink:()=>supplies.promise}});
 await cache.refresh(false,['printer']);expect(cache.read().values.printer).toBe('ready');expect(cache.read().metadata.ink.refreshing).toBe(true);supplies.resolve('80%');await cache.refresh();
});
test('restart snapshot is private, stale, bounded and bound to the configured identity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'epson-status-cache-'));const path=join(dir,'status-cache.json');let time=100000;
 const make=(key='a')=>createStatusSnapshot({key:()=>key,path:()=>path,now:()=>time,fallback:()=>({state:'unknown'}),loaders:{state:async()=> 'ready'}});
 const live=make();try{await live.refresh();await Bun.sleep(1100);expect(statSync(path).mode & 0o777).toBe(0o600);
 const restored=make();expect(restored.read().values.state).toBe('ready');expect(restored.read().metadata.state.stale).toBe(true);expect(make('b').read().values.state).toBe('unknown');
 time+=24*60*60*1000+1;expect(make().read().values.state).toBe('unknown');expect(JSON.parse(readFileSync(path,'utf8')).version).toBe(1);
 }finally{live.stop();rmSync(dir,{recursive:true,force:true});}
});
test('corrupt, incomplete or oversized persisted status never prevents cold startup',()=>{
 const dir=mkdtempSync(join(tmpdir(),'epson-bad-status-'));const path=join(dir,'cache.json');const make=()=>createStatusSnapshot({key:()=> 'a',path:()=>path,fallback:()=>({printer:{ok:false,state:'unknown'}}),loaders:{printer:async()=>({ok:true,state:'ready'})}});
 try { for(const data of ['{broken',JSON.stringify({version:1,key:'a',values:{printer:{ok:'yes',state:{}}},parts:{printer:{at:Date.now()}}}),' '.repeat(256*1024+1)]) {writeFileSync(path,data);expect(make().read().values.printer.state).toBe('unknown');} }finally{rmSync(dir,{recursive:true,force:true});}
});
test('invalidated TTL tasks cannot poison a replacement cache entry',async()=>{
 const {ttlCached}=await import('../../src/system/cache.ts');const cache=new Map(),inflight=new Map();const old=gate<string>(),fresh=gate<string>();
 const first=ttlCached(cache,inflight,'printer',15000,()=>old.promise);cache.clear();inflight.clear();const second=ttlCached(cache,inflight,'printer',15000,()=>fresh.promise);
 old.resolve('offline');await first;expect(inflight.has('printer')).toBe(true);expect(cache.has('printer')).toBe(false);fresh.resolve('ready');await second;expect(cache.get('printer').value).toBe('ready');
});
