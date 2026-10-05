import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildInfo } from "../../src/system/build-info.ts";
import scannerBuild from "../../scan-bridge/build-info.json";
test('both images share the same recorded build identity',()=>{
 expect(buildInfo).toEqual(scannerBuild);expect(buildInfo.number).toBeGreaterThanOrEqual(132);
});
test('CI build increments by exactly one per run and local release bump increments once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'epson-build-info-'));
 try {
  for(const folder of ['scripts','src','scan-bridge'])mkdirSync(join(dir,folder));
  copyFileSync('scripts/build-info.py',join(dir,'scripts/build-info.py'));
  writeFileSync(join(dir,'Dockerfile'),'FROM scratch\nARG BUILD_NUMBER=132\n');
  writeFileSync(join(dir,'scan-bridge/Dockerfile'),'FROM scratch\nARG BUILD_NUMBER=132\n');
  writeFileSync(join(dir,'src/build-info.json'),JSON.stringify({number:132}));
  const run=async(args:string[])=>{const p=Bun.spawn(['python3',join(dir,'scripts/build-info.py'),...args],{stdout:'pipe',stderr:'pipe'});expect(await p.exited).toBe(0);return JSON.parse(readFileSync(join(dir,'src/build-info.json'),'utf8'));};
  expect((await run(['--ci-run','10','--revision','abc'])).number).toBe(141);
  expect((await run(['--ci-run','11','--revision','def'])).number).toBe(142);
  expect((await run(['--bump'])).number).toBe(143);
  expect(JSON.parse(readFileSync(join(dir,'scan-bridge/build-info.json'),'utf8')).number).toBe(143);
  expect(readFileSync(join(dir,'Dockerfile'),'utf8')).toContain('ARG BUILD_NUMBER=143');
  expect(readFileSync(join(dir,'scan-bridge/Dockerfile'),'utf8')).toContain('ARG BUILD_NUMBER=143');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CI YAML keeps both build contexts and injects the shared build into every image job',async()=>{
 const workflow=Bun.YAML.parse(await Bun.file('.github/workflows/ci.yml').text()) as any;
 expect(workflow.jobs.docker.strategy.matrix.include.map((image:any)=>image.context)).toEqual(['.','./scan-bridge']);
 for(const job of ['docker','smoke','scanner-smoke']) {
  expect(workflow.jobs[job].steps.some((step:any)=>step.with?.['build-args']==='BUILD_NUMBER=${{ env.BUILD_NUMBER }}')).toBe(true);
  expect(workflow.jobs[job].steps.some((step:any)=>step.name==='Generate shared build identity')).toBe(true);
 }
});
