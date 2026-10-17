import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOperationLocks } from "../../src/system/process-lock.ts";
import { createScanJobStore, type ScanJob } from "../../src/scanning/jobs.ts";

const directories: string[] = [];
const workers: Bun.Subprocess[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "epson-jobs-"));
  directories.push(dir);
  mkdirSync(join(dir, "scans"));
  return dir;
};
afterEach(async () => {
  for (const process of workers.splice(0)) {
    process.kill(9);
    await process.exited;
  }
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const job = (overrides: Partial<ScanJob> = {}): ScanJob => ({
  id: "abcdef123456",
  printerIp: "192.0.2.90",
  dpi: 300,
  mode: "Color",
  fmt: "pdf",
  state: "done",
  createdAt: Date.now(),
  cancelRequested: false,
  progress: "Done",
  resultName: "scan.pdf",
  ...overrides,
});

test("scan metadata survives restart without retaining runtime callbacks or paths", () => {
  const dir = temp();
  const store = createScanJobStore(() => dir);
  const record = job({ resultPath: "/private/path", cancelProcess: () => {} });
  store.getJobs().set(record.id, record);
  store.save();
  const disk = readFileSync(join(dir, "scan-jobs.json"), "utf8");
  expect(disk).not.toContain("private/path");
  expect(disk).not.toContain("cancelProcess");
  const restored = createScanJobStore(() => dir)
    .getJobs()
    .get(record.id)!;
  expect(restored.state).toBe("done");
  expect(restored.resultName).toBe("scan.pdf");
});

for (const state of ["queued", "scanning", "converting"] as const)
  test(`restored ${state} jobs become explicit interruptions`, () => {
    const dir = temp();
    const store = createScanJobStore(() => dir);
    store.getJobs().set("abcdef123456", job({ state }));
    store.save();
    const restored = createScanJobStore(() => dir)
      .getJobs()
      .get("abcdef123456")!;
    expect(restored.state).toBe("error");
    expect(restored.error).toContain("restarted");
    expect(restored.cancelRequested).toBe(true);
    expect(
      createScanJobStore(() => dir)
        .getJobs()
        .get(restored.id)?.state,
    ).toBe("error");
  });

test("renamed and removed scan outputs have accurate recovery links", () => {
  const dir = temp();
  const store = createScanJobStore(() => dir);
  const record = job();
  store.getJobs().set(record.id, record);
  writeFileSync(join(dir, "scans", "scan.pdf"), "%PDF-");
  expect(store.publicJob(record).resultAvailable).toBe(true);
  store.renameResult("scan.pdf", "renamed.pdf");
  expect(record.resultName).toBe("renamed.pdf");
  expect(store.publicJob(record).resultAvailable).toBe(false);
  expect(
    createScanJobStore(() => dir)
      .getJobs()
      .get(record.id)?.resultName,
  ).toBe("renamed.pdf");
});

test("expired and malformed journal entries are not restored", () => {
  const dir = temp();
  writeFileSync(
    join(dir, "scan-jobs.json"),
    JSON.stringify({
      version: 1,
      jobs: [
        job({ createdAt: 1 }),
        job({ id: "bad" }),
        job({ resultName: "../secret.pdf" }),
        job({ id: "111111111111", createdAt: Date.now() + 120_000 }),
        job({ id: "222222222222", dpi: 123 }),
      ],
    }),
  );
  const jobs = createScanJobStore(() => dir).getJobs();
  expect(jobs.size).toBe(1);
  expect(jobs.get("abcdef123456")?.state).toBe("error");
  expect(jobs.get("abcdef123456")?.resultName).toBeUndefined();
});

test("the metadata journal stays bounded while retaining active jobs", () => {
  const dir = temp();
  const store = createScanJobStore(() => dir);
  const records = store.getJobs();
  for (let index = 0; index < 60; index++) {
    const record = job({
      id: index.toString(16).padStart(12, "0"),
      createdAt: Date.now() - index,
    });
    records.set(record.id, record);
  }
  records.set("ffffffffffff", job({ id: "ffffffffffff", state: "scanning" }));
  store.save();
  expect(records.size).toBe(50);
  expect(records.has("ffffffffffff")).toBe(true);
  expect(
    JSON.parse(readFileSync(join(dir, "scan-jobs.json"), "utf8")).jobs,
  ).toHaveLength(50);
});

async function start(dir: string, extraEnv: Record<string, string> = {}) {
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({ printer_ip: "192.0.2.90" }),
  );
  const process = Bun.spawn(
    [
      processExec(),
      "--disallow-code-generation-from-strings",
      "tests/fixtures/scan-runtime.ts",
    ],
    {
      env: {
        ...Bun.env,
        APP_DATA: dir,
        WEB_USERNAME: "",
        WEB_PASSWORD: "",
        ...extraEnv,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  workers.push(process);
  const reader = process.stdout.getReader();
  let text = "";
  const deadline = AbortSignal.timeout(5000);
  while (!text.includes('"port"')) {
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        deadline.addEventListener(
          "abort",
          () => reject(new Error("Fixture did not start")),
          { once: true },
        ),
      ),
    ]);
    if (result.done)
      throw new Error(
        `Fixture exited: ${await new Response(process.stderr).text()}`,
      );
    text += new TextDecoder().decode(result.value);
  }
  reader.releaseLock();
  const port = JSON.parse(
    text.split("\n").find((line) => line.startsWith('{"port"'))!,
  ).port;
  const url = `http://127.0.0.1:${port}`;
  const csrfResponse = await fetch(`${url}/api/csrf`);
  const csrf = (await csrfResponse.json()).csrf_token;
  const request = (path: string, body?: unknown) =>
    fetch(`${url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        Cookie: `csrf_token=${csrf}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { process, request, url };
}
function processExec() {
  return process.execPath;
}
async function waitFor(check: () => boolean | Promise<boolean>) {
  for (let count = 0; count < 150; count++) {
    if (await check()) return;
    await Bun.sleep(15);
  }
  throw new Error("Timed out waiting for scan fixture");
}
const settings = {
  dpi: 300,
  mode: "Color",
  format: "pdf",
  submission_id: "scan_browser_request_12345",
};
const acquisitions = (dir: string) => {
  try {
    return readFileSync(join(dir, "acquisitions.log"), "utf8")
      .trim()
      .split("\n").length;
  } catch {
    return 0;
  }
};

test("scan retries and a real server restart never repeat an interrupted acquisition", async () => {
  const dir = temp();
  const first = await start(dir);
  const accepted = await first.request("/api/scan", settings);
  expect(accepted.status).toBe(202);
  const { jobId } = await accepted.json();
  await waitFor(() => acquisitions(dir) === 1);
  const duplicate = await first.request("/api/scan", settings);
  expect((await duplicate.json()).jobId).toBe(jobId);
  expect(
    (await first.request("/api/scan", { ...settings, dpi: 600 })).status,
  ).toBe(409);
  first.process.kill(9);
  await first.process.exited;
  const second = await start(dir);
  const recovered = (
    await (await second.request(`/api/scan/jobs/${jobId}`)).json()
  ).job;
  expect(recovered.state).toBe("error");
  expect(recovered.error).toContain("restarted");
  const replay = await second.request("/api/scan", settings);
  expect(replay.status).toBe(202);
  expect((await replay.json()).jobId).toBe(jobId);
  await Bun.sleep(50);
  expect(acquisitions(dir)).toBe(1);
});

test("completed scans and result renames remain recoverable after a server restart", async () => {
  const dir = temp();
  const first = await start(dir);
  const { jobId } = await (await first.request("/api/scan", settings)).json();
  await waitFor(() => acquisitions(dir) === 1);
  await first.request("/__fixture/finish");
  await waitFor(
    async () =>
      (await (await first.request(`/api/scan/jobs/${jobId}`)).json()).job
        .state === "done",
  );
  first.process.kill(9);
  await first.process.exited;
  const second = await start(dir);
  const recovered = (
    await (await second.request(`/api/scan/jobs/${jobId}`)).json()
  ).job;
  expect(recovered.state).toBe("done");
  expect(recovered.resultAvailable).toBe(true);
  expect(
    (
      await second.request(`/api/scans/${recovered.resultName}/rename`, {
        name: "Kept document",
      })
    ).status,
  ).toBe(200);
  const renamed = (
    await (await second.request(`/api/scan/jobs/${jobId}`)).json()
  ).job;
  expect(renamed.resultName).toBe("Kept document.pdf");
  expect(renamed.resultAvailable).toBe(true);
  unlinkSync(join(dir, "scans", renamed.resultName));
  expect(
    (await (await second.request(`/api/scan/jobs/${jobId}`)).json()).job
      .resultAvailable,
  ).toBe(false);
  expect(acquisitions(dir)).toBe(1);
});

test("a timed-out scan keeps ownership until its acquisition actually exits", async () => {
  const dir = temp();
  const runtime = await start(dir);
  const { jobId } = await (await runtime.request("/api/scan", settings)).json();
  await waitFor(() => acquisitions(dir) === 1);
  await runtime.request("/__fixture/timeout");
  const stopping = (
    await (await runtime.request(`/api/scan/jobs/${jobId}`)).json()
  ).job;
  expect(stopping.state).toBe("scanning");
  expect(stopping.progress).toContain("Stopping");
  expect(
    (
      await runtime.request("/api/scan", {
        ...settings,
        submission_id: "different_browser_request",
      })
    ).status,
  ).toBe(409);
  await runtime.request("/__fixture/finish");
  await waitFor(
    async () =>
      (await (await runtime.request(`/api/scan/jobs/${jobId}`)).json()).job
        .state === "error",
  );
  expect(acquisitions(dir)).toBe(1);
});

test("shutdown refuses new scans and stops the active operation", async () => {
  const dir = temp();
  const runtime = await start(dir);
  const { jobId } = await (await runtime.request("/api/scan", settings)).json();
  await waitFor(() => acquisitions(dir) === 1);
  await runtime.request("/__fixture/shutdown");
  expect(
    (
      await runtime.request("/api/scan", {
        ...settings,
        submission_id: "new_shutdown_request_123",
      })
    ).status,
  ).toBe(503);
  await waitFor(
    async () =>
      (await (await runtime.request(`/api/scan/jobs/${jobId}`)).json()).job
        .state === "cancelled",
  );
  expect(acquisitions(dir)).toBe(1);
});

test("scan journal failure rejects before acquiring the scanner", async () => {
  const dir = temp();
  const runtime = await start(dir);
  mkdirSync(join(dir, "scan-jobs.json"));
  expect((await runtime.request("/api/scan", settings)).status).toBe(503);
  await Bun.sleep(40);
  expect(acquisitions(dir)).toBe(0);
});

test("a live operation lock cannot be stolen when its timestamp becomes old", async () => {
  const dir = temp();
  const locks = createOperationLocks(() => dir);
  let finish!: () => void;
  const running = locks.withOperationLock(
    "scanner",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const holder = locks.operationLocks.get("scanner")!;
  holder.acquiredAt = Date.now() - 20 * 60 * 1000;
  let overlapped = false;
  expect(
    (
      await locks.withOperationLock("scanner", async () => {
        overlapped = true;
      })
    ).acquired,
  ).toBe(false);
  expect(overlapped).toBe(false);
  finish();
  await running;
  expect(
    (await locks.withOperationLock("scanner", async () => {})).acquired,
  ).toBe(true);
});

test("a full scan library rejects acquisition and preserves existing documents", async () => {
  const dir = temp();
  writeFileSync(join(dir, "scans", "keep.pdf"), "kept document");
  const runtime = await start(dir, {
    MAX_SCAN_FILES: "1",
    SCAN_RETENTION_POLICY: "keep-all",
  });
  const rejected = await runtime.request("/api/scan", settings);
  expect(rejected.status).toBe(409);
  expect((await rejected.json()).error).toContain("Saved scans are full");
  expect(readFileSync(join(dir, "scans", "keep.pdf"), "utf8")).toBe(
    "kept document",
  );
  expect(acquisitions(dir)).toBe(0);
});

test("an active scan reserves the last slot against simultaneous PDF assembly", async () => {
  const dir = temp();
  writeFileSync(join(dir, "scans", "page1.pdf"), "%PDF-1.4");
  writeFileSync(join(dir, "scans", "page2.pdf"), "%PDF-1.4");
  const runtime = await start(dir, {
    MAX_SCAN_FILES: "3",
    SCAN_RETENTION_POLICY: "keep-all",
  });
  const accepted = await runtime.request("/api/scan", settings);
  expect(accepted.status).toBe(202);
  await waitFor(() => acquisitions(dir) === 1);
  const response = await runtime.request("/api/scans/combine", {
    files: ["page1.pdf", "page2.pdf"],
    name: "Combined",
  });
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("Saved scans are full");
  const list = await (await runtime.request("/api/scans")).json();
  expect(list.storage.reserved).toBe(1);
});

test("a storage failure after acquisition never scans the page again", async () => {
  const dir = temp();
  const runtime = await start(dir, { SCAN_RETENTION_POLICY: "keep-all" });
  const { jobId } = await (await runtime.request("/api/scan", settings)).json();
  await waitFor(() => acquisitions(dir) === 1);
  await runtime.request("/__fixture/fail-save");
  await waitFor(
    async () =>
      (await (await runtime.request(`/api/scan/jobs/${jobId}`)).json()).job
        .state === "error",
  );
  const failed = (
    await (await runtime.request(`/api/scan/jobs/${jobId}`)).json()
  ).job;
  expect(failed.error).toContain("could not be saved");
  expect(acquisitions(dir)).toBe(1);
});
