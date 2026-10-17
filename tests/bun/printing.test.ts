import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { parsePrintOptions } from "../../src/printing/options.ts";
import { createPrintSubmissions } from "../../src/printing/submissions.ts";
import { createCupsBackend } from "../../src/printing/cups.ts";
import { registerPrintingApi } from "../../src/api/printing.ts";
import { commandResult } from "../../src/system/commands.ts";

const directories: string[] = [];
function directory() {
  const value = mkdtempSync(join(tmpdir(), "epson-print-"));
  directories.push(value);
  return value;
}
afterEach(() => {
  for (const value of directories.splice(0))
    rmSync(value, { recursive: true, force: true });
});
const receipt = { status: 200 as const, body: { ok: true, job_id: "home-42" } };

for (const copies of [
  "1.5",
  "2junk",
  "1e1",
  "-1",
  "0",
  "100",
  "",
  "Infinity",
]) {
  test(`rejects invalid copy count ${JSON.stringify(copies)}`, () =>
    expect(() => parsePrintOptions({ copies })).toThrow("Copies must"));
}
for (const pages of ["0", "1-0", "3-1", "1;lp", "1,,2", "100000", "1-", "-3"]) {
  test(`rejects invalid page range ${JSON.stringify(pages)}`, () =>
    expect(() => parsePrintOptions({ pages })).toThrow());
}
test("normalizes permitted print settings and page ranges", () => {
  expect(
    parsePrintOptions({
      copies: "2",
      grayscale: "on",
      paper: "Letter",
      orientation: "landscape",
      scaling: "actual",
      pages: "1-3, 5, 8-10",
    }),
  ).toEqual({
    copies: 2,
    grayscale: true,
    paper: "Letter",
    orientation: "landscape",
    scaling: "actual",
    pages: "1-3,5,8-10",
  });
  for (const options of [
    { paper: "Legal" },
    { orientation: "-o raw" },
    { scaling: "arbitrary" },
  ])
    expect(() => parsePrintOptions(options)).toThrow();
});

test("concurrent retries share one hardware submission", async () => {
  const path = directory();
  const once = createPrintSubmissions(() => path);
  let calls = 0;
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const action = async () => {
    calls++;
    await waiting;
    return receipt;
  };
  const first = once("same-key", "same-document", action);
  const second = once("same-key", "same-document", action);
  finish();
  expect(await first).toEqual(receipt);
  expect(await second).toEqual(receipt);
  expect(calls).toBe(1);
});

test("a completed receipt survives a new service instance", async () => {
  const path = directory();
  await createPrintSubmissions(() => path)(
    "key",
    "document",
    async () => receipt,
  );
  let repeated = false;
  const replay = await createPrintSubmissions(() => path)(
    "key",
    "document",
    async () => {
      repeated = true;
      return receipt;
    },
  );
  expect(repeated).toBe(false);
  expect(replay.body).toEqual({ ...receipt.body, replayed: true });
});

test("an interrupted durable claim prevents a repeat after restart", async () => {
  const path = directory();
  const submit = createPrintSubmissions(() => path);
  const logging = console.error;
  console.error = () => {};
  try {
    expect(
      (
        await submit("interrupted", "document", async () => {
          throw new Error("lost acknowledgement");
        })
      ).status,
    ).toBe(503);
  } finally {
    console.error = logging;
  }
  let calls = 0;
  const retry = await createPrintSubmissions(() => path)(
    "interrupted",
    "document",
    async () => {
      calls++;
      return receipt;
    },
  );
  expect(retry.status).toBe(409);
  expect(retry.body.error).toContain("Check the queue");
  expect(calls).toBe(0);
});

test("reusing a key for different content is rejected", async () => {
  const path = directory();
  const once = createPrintSubmissions(() => path);
  await once("key", "one", async () => receipt);
  expect(
    (
      await once("key", "two", async () => {
        throw new Error("must not run");
      })
    ).status,
  ).toBe(409);
});

test("expired receipts are pruned", async () => {
  const path = directory();
  const once = createPrintSubmissions(() => path);
  await once("expired", "old", async () => receipt);
  const db = new Database(join(path, "print-submissions.sqlite3"));
  db.run("UPDATE submissions SET created_at = 1");
  db.close();
  expect((await once("expired", "new", async () => receipt)).status).toBe(200);
});

test("CUPS receives single-sided, collated layout options and a validated range", async () => {
  let arguments_: string[] = [];
  const cups = createCupsBackend(async (args) => {
    arguments_ = args;
    return commandResult(true);
  });
  const result = await cups.submitJob("home", "/tmp/file.pdf", {
    ...parsePrintOptions({
      copies: 2,
      pages: "2-4",
      paper: "Letter",
      orientation: "landscape",
      scaling: "actual",
      grayscale: true,
    }),
    title: "Family document",
  });
  expect(result.ok).toBe(true);
  for (const option of [
    "media=Letter",
    "orientation-requested=4",
    "fit-to-page=false",
    "page-ranges=2-4",
    "sides=one-sided",
    "Collate=True",
    "Ink=MONO",
  ])
    expect(arguments_).toContain(option);
  expect(arguments_.at(-1)).toBe("/tmp/file.pdf");
  expect(
    (await cups.submitJob("home", "/tmp/file.pdf", { pages: "1;echo" })).ok,
  ).toBe(false);
});

test("a stopped queue is unhealthy and a failed queue read is not an empty queue", async () => {
  const cups = createCupsBackend(async () =>
    commandResult(true, "printer home disabled since today"),
  );
  expect(await cups.getStatus("home")).toMatchObject({
    ok: false,
    state: "disabled",
  });
  await expect(
    createCupsBackend(async () =>
      commandResult(false, "", "CUPS unavailable", 1),
    ).listJobs("home"),
  ).rejects.toThrow("temporarily unavailable");
});

function api() {
  const app = new Hono();
  const path = directory();
  const submitted: Array<{ path: string; options: unknown }> = [];
  let ready = true;
  registerPrintingApi(app, {
    auth: () => null,
    ip: () => "192.0.2.10",
    queue: () => "home",
    dataDir: () => path,
    uploadLimit: () => 128,
    csrf: (c) => c.req.header("x-csrf-token") === "valid",
    readBody: async () => ({}),
    wantsJson: () => true,
    flash: () => {},
    filename: (name) => name,
    validateUpload: () => null,
    queueStatus: async () => ({
      ok: ready,
      state: ready ? "ready" : "disabled",
      detail: "",
    }),
    submit: async (path, file, options) => {
      submitted.push({ path: file, options });
      expect(await Bun.file(file).exists()).toBe(true);
      return commandResult(true, "request id is home-42 (1 file(s))");
    },
    resume: async () => commandResult(true),
    lock: async (action) => ({ acquired: true, result: await action() }),
    invalidate: () => {},
  });
  const print = (
    fields: Record<string, string> = {},
    filename = "notes.pdf",
    token = "valid",
    text = "%PDF-1.4\n",
  ) => {
    const body = new FormData();
    body.set("file", new File([text], filename));
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    return app.request("/print", {
      method: "POST",
      headers: { "x-csrf-token": token },
      body,
    });
  };
  return {
    app,
    print,
    path,
    submitted,
    disable: () => {
      ready = false;
    },
  };
}

test("print API returns a job receipt, cleans uploads, and replays without another submission", async () => {
  const { print, submitted, path } = api();
  const fields = {
    submission_id: "browser_submission_123",
    copies: "2",
    orientation: "landscape",
    pages: "1-3",
  };
  const first = await print(fields);
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ ok: true, job_id: "home-42" });
  const retry = await print(fields);
  expect(await retry.json()).toMatchObject({
    ok: true,
    job_id: "home-42",
    replayed: true,
  });
  expect(submitted).toHaveLength(1);
  expect(submitted[0].options).toMatchObject({
    copies: 2,
    orientation: "landscape",
    pages: "1-3",
  });
  expect(readdirSync(join(path, "uploads"))).toEqual([]);
  expect((await print({ ...fields, copies: "3" })).status).toBe(409);
  expect(
    (await print(fields, "notes.pdf", "valid", "%PDF-different")).status,
  ).toBe(409);
  expect(submitted).toHaveLength(1);
});

test("invalid fields, non-PDF page ranges and CSRF fail before hardware submission", async () => {
  const { print, submitted } = api();
  for (const fields of [
    { copies: "2junk" },
    { copies: "1.5" },
    { pages: "3-1" },
    { paper: "random" },
    { submission_id: "bad" },
  ] as Record<string, string>[])
    expect((await print(fields)).status).toBe(400);
  expect((await print({ pages: "1-3" }, "notes.txt")).status).toBe(400);
  expect((await print({}, "notes.pdf", "wrong")).status).toBe(400);
  expect(submitted).toHaveLength(0);
});

test("queue rejection tells clients they can safely start a new attempt", async () => {
  const { print, submitted, disable } = api();
  disable();
  const response = await print({ submission_id: "browser_submission_123" });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ ok: false, retry_safe: true });
  expect(submitted).toHaveLength(0);
});

test("queue resume uses authentication checks and does not resubmit any document", async () => {
  const { app, submitted } = api();
  expect(
    (await app.request("/api/printer/queue/resume", { method: "POST" })).status,
  ).toBe(400);
  const resumed = await app.request("/api/printer/queue/resume", {
    method: "POST",
    headers: { "x-csrf-token": "valid" },
  });
  expect(resumed.status).toBe(200);
  expect(await resumed.json()).toMatchObject({ ok: true });
  expect(submitted).toHaveLength(0);
});
