import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearDeviceCache, scanDocument } from "../../src/core";

let dir: string;
const originalSpawn = Bun.spawn;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "epson-conversion-"));
  mkdirSync(join(dir, "out"));
  writeFileSync(join(dir, "scanimage"), `#!/bin/sh
if [ "$1" = "-L" ]; then
  echo "device 'epsonds:net:192.0.2.90' is an Epson test scanner"
else
  cat '${dir}/fixture.png'
fi
`, { mode: 0o755 });
  writeFileSync(join(dir, "fixture.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=", "base64"));
  Bun.spawn = ((args: string[], options: any) => {
    return originalSpawn(args[0] === "scanimage" ? [join(dir, "scanimage"), ...args.slice(1)] : args, options);
  }) as typeof Bun.spawn;
  clearDeviceCache();
});
afterEach(() => { Bun.spawn = originalSpawn; clearDeviceCache(); rmSync(dir, { recursive: true, force: true }); });

for (const fmt of ["png", "jpg", "pdf"]) {
  test(`scan publishes a valid ${fmt} and removes intermediate files`, async () => {
    const out = join(dir, "out");
    const [result, path] = await scanDocument("192.0.2.90", out, { fmt });
    expect(result.stderr).toBe("");
    expect(result.ok).toBe(true);
    expect(path).toEndWith(`.${fmt}`);
    expect(readdirSync(out)).toHaveLength(1);
    expect(readdirSync(out)[0]).toStartWith("scan_");
    const bytes = new Uint8Array(await Bun.file(path!).arrayBuffer());
    if (fmt === "pdf") expect(new TextDecoder().decode(bytes.slice(0,5))).toBe("%PDF-");
    else if (fmt === "jpg") expect([...bytes.slice(0,3)]).toEqual([255,216,255]);
    else expect([...bytes.slice(0,4)]).toEqual([137,80,78,71]);
  });
}

test("cancelling during conversion publishes no completed scan", async () => {
  let cancelled = false;
  const out = join(dir, "out");
  const [result, path] = await scanDocument("192.0.2.90", out, { fmt: "pdf", control: {
    isCancelled: () => cancelled,
    registerProcess: () => {}, clearProcess: () => {},
    setProgress: () => { cancelled = true; expect(readdirSync(out).every(name => name.startsWith("."))).toBe(true); },
  } });
  expect(result.ok).toBe(false);
  expect(result.stderr).toBe("scan_cancelled");
  expect(path).toBeNull();
  expect(readdirSync(out)).toEqual([]);
});
