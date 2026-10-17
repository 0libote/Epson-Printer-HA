import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  utimesSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createScanLibrary,
  scanRetentionPolicy,
} from "../../src/scanning/library.ts";
const directories: string[] = [];
function setup(
  limit = 2,
  policy: "keep-all" | "delete-oldest" = "keep-all",
  available = 1024 ** 3,
) {
  const directory = mkdtempSync(join(tmpdir(), "epson-storage-"));
  directories.push(directory);
  const library = createScanLibrary({
    directory: () => directory,
    limit: () => limit,
    policy,
    freeBytes: () => available,
  });
  const file = (name: string, content = name) => {
    writeFileSync(join(directory, name), content);
    library.invalidate();
  };
  return { directory, library, file };
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("preserving saved documents is the default retention policy", () => {
  expect(scanRetentionPolicy(undefined)).toBe("keep-all");
  expect(scanRetentionPolicy("delete-oldest")).toBe("delete-oldest");
  expect(() => scanRetentionPolicy("typo")).toThrow("SCAN_RETENTION_POLICY");
});

test("a full library refuses a new scan without deleting any existing file", () => {
  const { library, file, directory } = setup();
  file("first.pdf");
  file("second.png");
  expect(library.usage().full).toBe(true);
  expect(() => library.reserve(true)).toThrow("Saved scans are full");
  expect(readdirSync(directory).sort()).toEqual(["first.pdf", "second.png"]);
});

test("simultaneous publishers cannot reserve the same final slot", () => {
  const { library, file } = setup();
  file("existing.pdf");
  const pending = library.reserve(true);
  expect(library.usage()).toMatchObject({
    total: 1,
    reserved: 1,
    max: 2,
    full: true,
  });
  expect(() => library.reserve()).toThrow("Saved scans are full");
  pending.release();
  pending.release();
  expect(library.usage().reserved).toBe(0);
  const next = library.reserve();
  file("combined.pdf");
  next.commit("combined.pdf");
  expect(library.usage()).toMatchObject({ total: 2, reserved: 0, full: true });
});

test("failed acquisitions release capacity and keep originals", () => {
  const { library, file, directory } = setup();
  file("kept.pdf");
  const failed = library.reserve(true);
  failed.release();
  const next = library.reserve(true);
  next.release();
  expect(readdirSync(directory)).toEqual(["kept.pdf"]);
});

test("automatic rotation is explicit and only occurs after successful publication", () => {
  const { library, file, directory } = setup(2, "delete-oldest");
  file("old.pdf");
  file("recent.pdf");
  utimesSync(join(directory, "old.pdf"), new Date(1), new Date(1));
  const pending = library.reserve(true);
  expect(readdirSync(directory).sort()).toEqual(["old.pdf", "recent.pdf"]);
  pending.release();
  expect(readdirSync(directory)).toHaveLength(2);
  const successful = library.reserve(true);
  file("new.pdf");
  successful.commit("new.pdf");
  expect(readdirSync(directory).sort()).toEqual(["new.pdf", "recent.pdf"]);
  expect(library.usage().reserved).toBe(0);
});

test("rotation cannot remove original pages while a PDF is being assembled", () => {
  const { library, file } = setup(4, "delete-oldest");
  file("page1.pdf");
  file("page2.pdf");
  const assembly = library.reserve();
  expect(() => library.reserve(true)).toThrow(
    "Another document is being saved",
  );
  assembly.release();
  const scan = library.reserve(true);
  expect(() => library.reserve()).toThrow("Another document is being saved");
  scan.release();
});

test("PDF assembly always keeps originals even when rotation is enabled", () => {
  const { library, file, directory } = setup(2, "delete-oldest");
  file("page1.pdf");
  file("page2.pdf");
  expect(() => library.reserve()).toThrow("Saved scans are full");
  expect(readdirSync(directory).sort()).toEqual(["page1.pdf", "page2.pdf"]);
});

test("rotation refuses to prune if its promised output was not published", () => {
  const { library, file, directory } = setup(1, "delete-oldest");
  file("kept.pdf");
  const reservation = library.reserve(true);
  expect(() => reservation.commit("missing.pdf")).toThrow(
    "Existing documents were kept",
  );
  expect(library.usage().reserved).toBe(0);
  expect(readdirSync(directory)).toEqual(["kept.pdf"]);
});

test("low free space blocks an acquisition before reserving capacity", () => {
  const { library } = setup(100, "keep-all", 8 * 1024 * 1024);
  expect(() => library.reserve(true)).toThrow("less than 32 MB");
  expect(library.usage().reserved).toBe(0);
});

test("a filesystem without free-space reporting can still save scans", () => {
  const { library } = setup(100, "keep-all", -1);
  const reservation = library.reserve();
  reservation.release();
  expect(library.usage().available_bytes).toBe(-1);
});

test("hidden intermediates, unrelated files and symlinks never consume capacity or get pruned", () => {
  const { library, file, directory } = setup(1, "delete-oldest");
  file(".partial.pdf");
  file("notes.txt");
  file("existing.pdf");
  symlinkSync(join(directory, "notes.txt"), join(directory, "link.pdf"));
  expect(library.entries().map((file) => file.name)).toEqual(["existing.pdf"]);
  const reservation = library.reserve(true);
  file("new.pdf");
  reservation.commit("new.pdf");
  expect(readdirSync(directory).sort()).toEqual([
    ".partial.pdf",
    "link.pdf",
    "new.pdf",
    "notes.txt",
  ]);
});

test("an unavailable scan directory cannot be mistaken for free capacity", () => {
  const { library, directory } = setup();
  rmSync(directory, { recursive: true });
  expect(() => library.entries()).toThrow("Saved scans are unavailable");
  expect(() => library.reserve()).toThrow("Saved scans are unavailable");
});

test.skipIf(process.getuid?.() === 0)(
  "a read-only output directory is rejected before acquisition",
  () => {
    const { library, directory } = setup();
    chmodSync(directory, 0o555);
    try {
      expect(() => library.reserve()).toThrow("not writable");
      expect(library.usage().reserved).toBe(0);
    } finally {
      chmodSync(directory, 0o755);
    }
  },
);
