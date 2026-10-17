import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { PDFDocument } from "pdf-lib";
import { combineScans } from "../../src/scanning/combine.ts";
import { ScanStorageError } from "../../src/scanning/library.ts";
import { registerLibraryApi } from "../../src/api/library.ts";
const directories: string[] = [];
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), "epson-combine-"));
  directories.push(path);
  return path;
};
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
async function pdf(path: string, widths: number[]) {
  const document = await PDFDocument.create();
  for (const width of widths) document.addPage([width, 300]);
  const bytes = await document.save();
  await Bun.write(path, bytes);
  return bytes;
}

test("combines PDFs in requested order and keeps originals unchanged", async () => {
  const path = directory();
  const first = await pdf(join(path, "one.pdf"), [100, 110]);
  const second = await pdf(join(path, "two.pdf"), [200]);
  expect(
    await combineScans(path, ["two.pdf", "one.pdf"], "together.pdf"),
  ).toEqual({ name: "together.pdf", pages: 3 });
  const output = await PDFDocument.load(
    await Bun.file(join(path, "together.pdf")).arrayBuffer(),
  );
  expect(output.getPages().map((page) => page.getWidth())).toEqual([
    200, 100, 110,
  ]);
  expect([
    ...new Uint8Array(await Bun.file(join(path, "one.pdf")).arrayBuffer()),
  ]).toEqual([...first]);
  expect([
    ...new Uint8Array(await Bun.file(join(path, "two.pdf")).arrayBuffer()),
  ]).toEqual([...second]);
  expect(readdirSync(path).sort()).toEqual([
    "one.pdf",
    "together.pdf",
    "two.pdf",
  ]);
});

test("mixes image scans and PDFs in one document", async () => {
  const path = directory();
  await pdf(join(path, "one.pdf"), [100]);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=",
    "base64",
  );
  await Bun.write(join(path, "photo.png"), png);
  expect(
    (await combineScans(path, ["photo.png", "one.pdf"], "mixed.pdf")).pages,
  ).toBe(2);
  const output = await PDFDocument.load(
    await Bun.file(join(path, "mixed.pdf")).arrayBuffer(),
  );
  expect(output.getPage(0).getWidth()).toBeCloseTo(595.28);
  expect(output.getPage(1).getWidth()).toBe(100);
});

test("an existing output is never overwritten", async () => {
  const path = directory();
  await pdf(join(path, "one.pdf"), [100]);
  await pdf(join(path, "two.pdf"), [200]);
  const before = await pdf(join(path, "existing.pdf"), [500]);
  await expect(
    combineScans(path, ["one.pdf", "two.pdf"], "existing.pdf"),
  ).rejects.toThrow("already exists");
  expect([
    ...new Uint8Array(await Bun.file(join(path, "existing.pdf")).arrayBuffer()),
  ]).toEqual([...before]);
  expect(readdirSync(path).some((name) => name.startsWith("."))).toBe(false);
});

test("missing, damaged and excessive inputs never publish a partial PDF", async () => {
  const path = directory();
  await pdf(join(path, "one.pdf"), [100]);
  await Bun.write(join(path, "damaged.pdf"), "not a PDF");
  await expect(
    combineScans(path, ["one.pdf", "missing.pdf"], "output.pdf"),
  ).rejects.toThrow("no longer available");
  await expect(
    combineScans(path, ["one.pdf", "damaged.pdf"], "output.pdf"),
  ).rejects.toThrow("damaged or password protected");
  await pdf(join(path, "too-many.pdf"), Array(100).fill(100));
  await expect(
    combineScans(path, ["one.pdf", "too-many.pdf"], "output.pdf"),
  ).rejects.toThrow("100 pages");
  writeFileSync(join(path, "large.pdf"), "");
  truncateSync(join(path, "large.pdf"), 128 * 1024 * 1024 + 1);
  await expect(
    combineScans(path, ["one.pdf", "large.pdf"], "output.pdf"),
  ).rejects.toThrow("exceed 128 MB");
  expect(await Bun.file(join(path, "output.pdf")).exists()).toBe(false);
});

test("file validation prevents traversal, symlinks, duplicate sources and oversized selections", async () => {
  const path = directory();
  await pdf(join(path, "one.pdf"), [100]);
  symlinkSync(join(path, "one.pdf"), join(path, "link.pdf"));
  for (const files of [
    ["../one.pdf", "one.pdf"],
    ["one.pdf", "one.pdf"],
    ["one.pdf", "link.pdf"],
    ["one.pdf"],
    Array(51).fill("one.pdf"),
  ]) {
    await expect(combineScans(path, files, "output.pdf")).rejects.toThrow();
  }
  for (const output of ["../output.pdf", "bad.txt", ".hidden.pdf"])
    await expect(
      combineScans(path, ["one.pdf", "two.pdf"], output),
    ).rejects.toThrow();
});

test("library API checks authentication, CSRF and capacity before assembling files", async () => {
  const app = new Hono();
  const path = directory();
  let full = false;
  await pdf(join(path, "one.pdf"), [100]);
  await pdf(join(path, "two.pdf"), [200]);
  registerLibraryApi(app, {
    auth: (c) =>
      c.req.header("authorization") === "allowed"
        ? null
        : c.json({ error: "Unauthorized" }, 401),
    csrf: (c) => c.req.header("x-csrf-token") === "valid",
    readBody: (c) => c.req.json(),
    directory: () => path,
    outputName: (name) => name + ".pdf",
    reserve: () => { if(full) throw new ScanStorageError("Saved scans are full.",409); return {commit:()=>{},release:()=>{}}; },
    lock: async (action) => ({ acquired: true, result: await action() }),
    invalidate: () => {},
  });
  const request = (auth = "allowed", csrf = "valid", name = "Combined") =>
    app.request("/api/scans/combine", {
      method: "POST",
      headers: {
        authorization: auth,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({ files: ["one.pdf", "two.pdf"], name }),
    });
  expect((await request("wrong")).status).toBe(401);
  expect((await request("allowed", "wrong")).status).toBe(400);
  full = true;
  expect((await request()).status).toBe(409);
  full = false;
  const result = await request();
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({
    ok: true,
    name: "Combined.pdf",
    pages: 2,
  });
});
