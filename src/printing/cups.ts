import { validateQueue, validatePrinterAddress } from "../system/validation.ts";
import { commandResult, readCommandStream, type CommandResult, runCommand as defaultRunner } from "../system/commands.ts";
import { ttlCached } from "../system/cache.ts";
import { parsePrintOptions, type PrintOptions } from "./options.ts";
export function createCupsBackend(runCommand: typeof defaultRunner = defaultRunner) {
async function cupsPrinterStatus(printerName: string): Promise<{ ok: boolean; state: string; detail: string }> {
  try { validateQueue(printerName); } catch { return { ok: false, state: "unconfigured", detail: "Invalid queue name" }; }
  const result = await runCommand(["lpstat", "-p", printerName, "-l"], 5000);
  const text = (result.stdout || result.stderr).trim().slice(0, 800);
  if (result.ok) {
    const lower = text.toLowerCase();
    let state = "ready";
    if (lower.includes("disabled")) state = "disabled";
    else if (lower.includes("printing")) state = "printing";
    return { ok: state !== "disabled", state, detail: text };
  }
  return { ok: false, state: "unconfigured", detail: text || "CUPS queue not configured" };
}

const cupsStatusCache = new Map<string, { exp: number; value: any }>();
const cupsStatusInflight = new Map<string, Promise<any>>();
async function cachedCupsPrinterStatus(printerName: string) {
  return ttlCached(cupsStatusCache, cupsStatusInflight, printerName, 8_000, () => cupsPrinterStatus(printerName));
}

async function listJobs(printerName: string): Promise<Array<{ id: string; owner: string; size: string; raw: string }>> {
  try { validateQueue(printerName); } catch { return []; }
  const result = await runCommand(["lpstat", "-o", printerName], 5000);
  if (!result.ok) throw new Error("Print queue is temporarily unavailable");
  if (!result.stdout) return [];
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
function clearCaches() { cupsStatusCache.clear(); cupsStatusInflight.clear(); jobsCache.clear(); jobsInflight.clear(); }
async function cachedListJobs(printerName: string) {
  return ttlCached(jobsCache, jobsInflight, printerName, 4_000, () => listJobs(printerName));
}

async function submitPrint(printerName: string, path: string, opts: Partial<PrintOptions> & { title?: string } = {}): Promise<CommandResult> {
  try { validateQueue(printerName); } catch { return commandResult(false, "", "Invalid queue name", 2); }
  if (opts.copies !== undefined && (!Number.isInteger(opts.copies) || opts.copies < 1 || opts.copies > 99)) return commandResult(false, "", "Invalid copy count", 2);
  let validated: PrintOptions;
  try { validated = parsePrintOptions(opts); } catch (error) { return commandResult(false, "", (error as Error).message, 2); }
  const copies = validated.copies;
  const title = (opts.title ?? path.split("/").pop() ?? "WebUI print").slice(0, 255) || "WebUI print";
  const args = ["lp", "-U", "epson", "-d", printerName, "-t", title, "-n", String(copies)];
  if (opts.grayscale) args.push("-o", "Ink=MONO");
  args.push("-o", `media=${validated.paper}`, "-o", `orientation-requested=${validated.orientation === "landscape" ? 4 : 3}`,
    "-o", `fit-to-page=${validated.scaling === "fit"}`, "-o", "sides=one-sided", "-o", "Collate=True");
  if (validated.pages) args.push("-o", `page-ranges=${validated.pages}`);
  args.push(path);
  const result = await runCommand(args, 60_000);
  clearCaches();
  return result;
}

async function cancelJob(jobId: string): Promise<CommandResult> {
  if (!/^[A-Za-z0-9_.-]+-\d+$/.test(jobId)) {
    return commandResult(false, "", "Invalid job id", 2);
  }
  const result = await runCommand(["cancel", jobId], 10_000);
  clearCaches();
  return result;
}

async function resumeQueue(printerName: string): Promise<CommandResult> {
  try { validateQueue(printerName); } catch { return commandResult(false, "", "Invalid queue name", 2); }
  const enabled = await runCommand(["cupsenable", printerName], 10_000);
  if (!enabled.ok) { clearCaches(); return enabled; }
  const accepted = await runCommand(["cupsaccept", printerName], 10_000);
  clearCaches();
  return accepted;
}

// Stop new LAN submissions before checking whether deleting the queue is safe.
async function prepareQueueRename(printerName: string): Promise<CommandResult> {
  validateQueue(printerName);
  const rejected = await runCommand(["cupsreject", printerName], 10_000);
  if (!rejected.ok) return rejected;
  try {
    if ((await listJobs(printerName)).length) {
      return commandResult(false, "", "Wait for unfinished print jobs before changing the queue name.", 1);
    }
    return commandResult(true);
  } catch {
    return commandResult(false, "", "Could not check unfinished print jobs. Try again shortly.", 1);
  }
}
async function acceptQueue(printerName: string) {
  validateQueue(printerName);
  return runCommand(["cupsaccept", printerName], 10_000);
}
async function deleteQueue(printerName: string) {
  validateQueue(printerName);
  const result = await runCommand(["lpadmin", "-x", printerName], 10_000);
  clearCaches();
  return result;
}

async function configureQueue(printerIp: string, opts: { printerName: string; displayName: string; sharePrinter: boolean; }): Promise<[boolean, string]> {
  try { validatePrinterAddress(printerIp); validateQueue(opts.printerName); } catch { return [false, "Invalid printer address or queue name"]; }
  const env:Record<string,string>={...(process.env as Record<string,string>)};
  env.PRINTER_IP=printerIp;
  env.PRINTER_NAME=opts.printerName;
  env.PRINTER_DISPLAY_NAME=opts.displayName;
  const share=opts.sharePrinter;
  env.SHARE_PRINTER=share?"true":"false";
  env.PREFER_ENV_SETTINGS="true";
  try{
    const proc=Bun.spawn(["/usr/local/bin/configure-cups.sh"],{env, stdout:"pipe", stderr:"pipe"});
    const stdoutP=readCommandStream(proc.stdout);
    const stderrP=readCommandStream(proc.stderr);
    const TIMEOUT_MS=90_000;
    const timeoutP=new Promise<never>((_,rej)=>{ const t=setTimeout(()=>{ try{proc.kill();}catch{} rej(new Error("configure-cups timed out after 90s")); },TIMEOUT_MS); (proc.exited as Promise<number>).finally(()=>clearTimeout(t)).catch(()=>{}); });
    const [stdout,stderr,code]=await Promise.race([Promise.all([stdoutP,stderrP,proc.exited]).then(([o,e,c])=>[o,e,c] as const), timeoutP]) as unknown as [string,string,number];
    return [code===0, (stdout+"\n"+stderr).trim()];
  }catch(exc:any){ return [false,String(exc?.message ?? exc)]; }
}
return { id: "cups", getStatus: cupsPrinterStatus, cachedStatus: cachedCupsPrinterStatus,
 configureQueue, prepareQueueRename, acceptQueue, deleteQueue, listJobs, cachedJobs: cachedListJobs, submitJob: submitPrint, cancelJob, resumeQueue,
 clearCache() { clearCaches(); } };
}
