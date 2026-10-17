import {
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  unlinkSync,
  lstatSync,
} from "node:fs";
import { join, basename } from "node:path";
import { randomBytes } from "node:crypto";

export type ScanJobState =
  "queued" | "scanning" | "converting" | "done" | "error" | "cancelled";
export interface ScanJob {
  id: string;
  state: ScanJobState;
  printerIp: string;
  dpi: number;
  mode: string;
  fmt: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  cancelRequested: boolean;
  cancelProcess?: () => void;
  resultName?: string;
  resultPath?: string;
  error?: string;
  progress: string;
  requestKey?: string;
}
export const isActiveScan = (job: ScanJob) =>
  ["queued", "scanning", "converting"].includes(job.state);
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_JOBS = 50;
const MAX_JOURNAL_BYTES = 256 * 1024;
const validResultName = (name: unknown): name is string =>
  typeof name === "string" &&
  name.length <= 150 &&
  name === basename(name) &&
  !name.startsWith(".") &&
  !name.includes("..") &&
  !/[\\/\x00-\x1f]/.test(name) &&
  /\.(pdf|png|jpe?g)$/i.test(name);

function validJobIdentity(value: any): boolean {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    /^[a-f0-9]{12}$/.test(value.id) &&
    ["queued", "scanning", "converting", "done", "error", "cancelled"].includes(
      value.state,
    )
  );
}

function validJobSettings(value: any, now: number): boolean {
  return (
    Number.isFinite(value.createdAt) &&
    value.createdAt <= now + 60_000 &&
    now - value.createdAt <= RETENTION_MS &&
    [150, 200, 300, 600].includes(value.dpi) &&
    ["Color", "Gray", "Lineart"].includes(value.mode) &&
    ["pdf", "png", "jpg", "jpeg"].includes(value.fmt) &&
    typeof value.printerIp === "string" &&
    value.printerIp.length <= 64
  );
}

function restoreOptionalMetadata(job: ScanJob, value: any, now: number) {
  for (const key of ["startedAt", "finishedAt"] as const) {
    if (
      Number.isFinite(value[key]) &&
      value[key] >= value.createdAt &&
      value[key] <= now + 60_000
    )
      job[key] = value[key];
  }
  if (typeof value.error === "string") job.error = value.error.slice(0, 800);
  if (validResultName(value.resultName)) job.resultName = value.resultName;
  if (
    typeof value.requestKey === "string" &&
    /^[A-Za-z0-9_-]{16,80}$/.test(value.requestKey)
  )
    job.requestKey = value.requestKey;
}

function restoreJob(value: any, now: number): ScanJob | null {
  if (!validJobIdentity(value) || !validJobSettings(value, now)) return null;
  const job: ScanJob = {
    id: value.id,
    state: value.state,
    createdAt: value.createdAt,
    printerIp: value.printerIp,
    dpi: value.dpi,
    mode: value.mode,
    fmt: value.fmt,
    cancelRequested: value.cancelRequested === true,
    progress:
      typeof value.progress === "string" ? value.progress.slice(0, 200) : "",
  };
  restoreOptionalMetadata(job, value, now);
  return job;
}

function recoverInterruptedJob(job: ScanJob, now: number): boolean {
  if (isActiveScan(job)) {
    job.state = "error";
    job.progress = "Interrupted by a hub restart";
    job.error =
      "The hub restarted before this scan finished. Check Saved scans before starting another scan.";
    job.finishedAt = now;
    job.cancelRequested = true;
    return true;
  }
  if (job.state === "done" && !job.resultName) {
    job.state = "error";
    job.error = "This scan has no saved result. Check Saved scans.";
  }
  return false;
}

/** Metadata only. Restored active jobs become explicit interruptions; hardware
 * work is never automatically replayed from this journal. */
export function createScanJobStore(directory: () => string, now = Date.now) {
  const jobs = new Map<string, ScanJob>();
  let loadedDirectory: string | null = null;
  let reportedWriteFailure = false;
  function prune() {
    const terminal = [...jobs.values()]
      .filter((job) => !isActiveScan(job))
      .sort((a, b) => b.createdAt - a.createdAt);
    const active = jobs.size - terminal.length;
    for (const [index, job] of terminal.entries()) {
      if (
        now() - (job.finishedAt ?? job.createdAt) > RETENTION_MS ||
        index >= Math.max(0, MAX_JOBS - active)
      )
        jobs.delete(job.id);
    }
  }
  function save() {
    prune();
    const records = [...jobs.values()].map((job) => {
      const { cancelProcess, resultPath, ...metadata } = job;
      return metadata;
    });
    const text = JSON.stringify({ version: 1, jobs: records });
    if (Buffer.byteLength(text) > MAX_JOURNAL_BYTES)
      throw new Error("Scan journal is too large");
    const path = join(directory(), "scan-jobs.json");
    const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      writeFileSync(temporary, text, { mode: 0o600 });
      renameSync(temporary, path);
    } finally {
      try {
        unlinkSync(temporary);
      } catch {}
    }
    reportedWriteFailure = false;
  }
  function checkpoint() {
    try {
      save();
    } catch (error) {
      if (!reportedWriteFailure)
        console.error("[scan] Could not save scan job metadata", error);
      reportedWriteFailure = true;
    }
  }
  function restore() {
    if (loadedDirectory === directory()) return;
    jobs.clear();
    loadedDirectory = directory();
    const path = join(directory(), "scan-jobs.json");
    let recovered = false;
    try {
      if (statSync(path).size > MAX_JOURNAL_BYTES) return;
      const journal = JSON.parse(readFileSync(path, "utf8"));
      if (
        journal.version !== 1 ||
        !Array.isArray(journal.jobs) ||
        journal.jobs.length > MAX_JOBS
      )
        return;
      for (const value of journal.jobs) {
        const job = restoreJob(value, now());
        if (!job || jobs.has(job.id)) continue;
        if (recoverInterruptedJob(job, now())) recovered = true;
        jobs.set(job.id, job);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.error("[scan] Could not restore scan job metadata", error);
    }
    prune();
    if (recovered) checkpoint();
  }
  function getJobs() {
    restore();
    return jobs;
  }
  function publicJob(job: ScanJob) {
    let resultAvailable = false;
    if (job.resultName && validResultName(job.resultName)) {
      try {
        resultAvailable = lstatSync(
          join(directory(), "scans", job.resultName),
        ).isFile();
      } catch {}
    }
    return {
      id: job.id,
      state: job.state,
      dpi: job.dpi,
      mode: job.mode,
      fmt: job.fmt,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      elapsed: job.startedAt
        ? Math.max(
            0,
            Math.floor(((job.finishedAt ?? now()) - job.startedAt) / 1000),
          )
        : 0,
      progress: job.progress,
      resultName: job.resultName,
      resultAvailable,
      error: job.error,
    };
  }
  function renameResult(oldName: string, newName: string) {
    restore();
    let changed = false;
    for (const job of jobs.values())
      if (job.resultName === oldName) {
        job.resultName = newName;
        changed = true;
      }
    if (changed) checkpoint();
  }
  return {
    getJobs,
    save,
    checkpoint,
    restore,
    publicJob,
    renameResult,
  };
}
