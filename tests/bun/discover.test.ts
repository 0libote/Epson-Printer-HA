import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  parseEpsonTitle,
  rankCandidates,
  usableSubnets,
  _setScanImplForTest,
  _clearDiscoverCacheForTest,
  type DiscoveredPrinter,
} from "../../src/discover.ts";

describe("discover - title parsing", () => {
  test("epson status page yields model and epson flag", () => {
    const html = `<html><head><title>XP-2200 Series</title></head><body><img src="../../IMAGE/Ink_K.PNG" height="40"></body></html>`;
    const { model, looksEpson } = parseEpsonTitle(html);
    expect(looksEpson).toBe(true);
    expect(model).toBe("XP-2200");
  });

  test("linksys page does not look like epson", () => {
    const html = `<html><head><title>Linksys Smart Wi-Fi</title></head><body>router</body></html>`;
    const { looksEpson } = parseEpsonTitle(html);
    expect(looksEpson).toBe(false);
  });

  test("cups page is not epson", () => {
    const html = `<html><head><title>Home - CUPS 2.4</title></head></html>`;
    expect(parseEpsonTitle(html).looksEpson).toBe(false);
  });
});

describe("discover - ranking", () => {
  const mk = (ip: string, likelyEpson: boolean): DiscoveredPrinter => ({
    ip, model: null, ports: [631], likelyEpson, detail: "",
  });

  test("epson-likely first, then numeric ip order", () => {
    const ranked = rankCandidates([mk("192.168.1.50", false), mk("192.168.1.9", true), mk("192.168.1.100", false)]);
    expect(ranked.map((r) => r.ip)).toEqual(["192.168.1.9", "192.168.1.50", "192.168.1.100"]);
  });
});

describe("discover - subnets", () => {
  test("link-local subnets are skipped", () => {
    expect(usableSubnets(["192.168.1", "169.254.27", "10.0.0"])).toEqual(["192.168.1", "10.0.0"]);
  });
});

describe("discover - api", () => {
  beforeEach(() => { _clearDiscoverCacheForTest(); _setScanImplForTest(null); });
  afterEach(() => { _clearDiscoverCacheForTest(); _setScanImplForTest(null); });

  test("/api/discover returns mocked printers and caches", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmp = mkdtempSync(join(tmpdir(), "discover-api-test-"));
    process.env.APP_DATA = tmp;
    const appModule = await import("../../src/app.ts");
    const prevDir: string = (appModule as any).APP_DIR;
    let calls = 0;
    try {
      appModule._setAppDirForTest(tmp);
      writeFileSync(join(tmp, "settings.json"), JSON.stringify({ printer_ip: "192.0.2.10" }));
      _setScanImplForTest(async () => {
        calls++;
        return {
          ok: true,
          printers: [{ ip: "192.0.2.44", model: "XP-2200", ports: [631, 80], likelyEpson: true, detail: "Epson status page" }],
          subnets: ["192.0.2.0"],
          scanned_at: new Date().toISOString(),
        };
      });
      const res = await appModule.app.request(new Request("http://localhost/api/discover", { headers: { Accept: "application/json" } }));
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.ok).toBe(true);
      expect(body.printers.length).toBe(1);
      expect(body.printers[0].ip).toBe("192.0.2.44");
      // second call served from cache (no rescan)
      await appModule.app.request(new Request("http://localhost/api/discover", { headers: { Accept: "application/json" } }));
      expect(calls).toBe(1);
    } finally {
      _setScanImplForTest(null);
      _clearDiscoverCacheForTest();
      appModule._setAppDirForTest(prevDir);
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  });
});
