import { commandResult, type CommandResult, runCommand as defaultRunner } from "../system/commands.ts";
import { ttlCached } from "../system/cache.ts";
export function createCupsBackend(runCommand: typeof defaultRunner = defaultRunner) {
async function cupsPrinterStatus(printerName: string): Promise<{ ok: boolean; state: string; detail: string }> {
  const result = await runCommand(["lpstat", "-p", printerName, "-l"], 5000);
  const text = (result.stdout || result.stderr).trim();
  if (result.ok) {
    const lower = text.toLowerCase();
    let state = "ready";
    if (lower.includes("disabled")) state = "disabled";
    else if (lower.includes("printing")) state = "printing";
    return { ok: true, state, detail: text };
  }
  return { ok: false, state: "unconfigured", detail: text || "CUPS queue not configured" };
}

const cupsStatusCache = new Map<string, { exp: number; value: any }>();
const cupsStatusInflight = new Map<string, Promise<any>>();
async function cachedCupsPrinterStatus(printerName: string) {
  return ttlCached(cupsStatusCache, cupsStatusInflight, printerName, 8_000, () => cupsPrinterStatus(printerName));
}

async function listJobs(printerName: string): Promise<Array<{ id: string; owner: string; size: string; raw: string }>> {
  const result = await runCommand(["lpstat", "-o", printerName], 5000);
  if (!result.ok || !result.stdout) return [];
  const jobs: Array<{ id: string; owner: string; size: string; raw: string }> = [];
  for (const line of result.stdout.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (!parts[0]) continue;
    const jobId = parts[0];
    const owner = parts[1] ?? "";
    const size = parts[2] ?? "";
    jobs.push({ id: jobId, owner, size, raw: line });
  }
  return jobs;
}

const jobsCache = new Map<string, { exp: number; value: any }>();
const jobsInflight = new Map<string, Promise<any>>();
async function cachedListJobs(printerName: string) {
  return ttlCached(jobsCache, jobsInflight, printerName, 4_000, () => listJobs(printerName));
}

async function submitPrint(printerName: string, path: string, opts: { copies?: number; grayscale?: boolean; title?: string } = {}): Promise<CommandResult> {
  const copies = Math.max(1, Math.min(opts.copies ?? 1, 99));
  const title = (opts.title ?? path.split("/").pop() ?? "WebUI print").slice(0, 255) || "WebUI print";
  const args = ["lp", "-U", "epson", "-d", printerName, "-t", title, "-n", String(copies)];
  if (opts.grayscale) args.push("-o", "Ink=MONO");
  args.push(path);
  return runCommand(args, 60_000);
}

async function cancelJob(jobId: string): Promise<CommandResult> {
  if (!/^[A-Za-z0-9_.-]+-\d+$/.test(jobId)) {
    return commandResult(false, "", "Invalid job id", 2);
  }
  return runCommand(["cancel", jobId], 10_000);
}

async function configureQueue(printerIp: string, opts: { printerName: string; displayName: string; sharePrinter: boolean; oldPrinterName?: string }): Promise<[boolean, string]> {
  const env:Record<string,string>={...(process.env as Record<string,string>)};
  env.PRINTER_IP=printerIp;
  env.PRINTER_NAME=opts.printerName;
  env.PRINTER_DISPLAY_NAME=opts.displayName;
  const share=opts.sharePrinter;
  env.SHARE_PRINTER=share?"true":"false";
  env.OLD_PRINTER_NAME=opts.oldPrinterName||"";
  env.PREFER_ENV_SETTINGS="true";
  try{
    const proc=Bun.spawn(["/usr/local/bin/configure-cups.sh"],{env, stdout:"pipe", stderr:"pipe"});
    const stdoutP=new Response(proc.stdout).text();
    const stderrP=new Response(proc.stderr).text();
    const TIMEOUT_MS=90_000;
    const timeoutP=new Promise<never>((_,rej)=>{ const t=setTimeout(()=>{ try{proc.kill();}catch{} rej(new Error("configure-cups timed out after 90s")); },TIMEOUT_MS); (proc.exited as Promise<number>).finally(()=>clearTimeout(t)).catch(()=>{}); });
    const [stdout,stderr,code]=await Promise.race([Promise.all([stdoutP,stderrP,proc.exited]).then(([o,e,c])=>[o,e,c] as const), timeoutP]) as unknown as [string,string,number];
    return [code===0, (stdout+"\n"+stderr).trim()];
  }catch(exc:any){ return [false,String(exc?.message ?? exc)]; }
}
return { id: "cups", getStatus: cupsPrinterStatus, cachedStatus: cachedCupsPrinterStatus,
 configureQueue, listJobs, cachedJobs: cachedListJobs, submitJob: submitPrint, cancelJob,
 clearCache() { cupsStatusCache.clear(); cupsStatusInflight.clear(); jobsCache.clear(); jobsInflight.clear(); } };
}
